---
name: Incident 2026-08, email renderer leak
app: shop
---

# Incident 2026-08: the email renderer leak

## What happened

On 14 August the worker was OOMKilled four times in one afternoon. Memory grew
steadily with the number of emails sent, and was never given back.

## Cause

The email renderer kept every rendered template in a map **for the life of the
process**, to avoid rendering the same order twice. The map had no size limit and
no expiry. At about 600 emails per hour it reached the 512Mi limit in a few hours.

## Fix and lesson

The map got a limit of 1000 entries and a one-hour expiry. Lesson: **a cache
without an eviction rule is a leak waiting for traffic.** Load tests that run for
ten minutes do not show it; look at memory after an hour.

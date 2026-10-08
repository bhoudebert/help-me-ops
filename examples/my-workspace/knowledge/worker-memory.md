---
name: Worker memory and OOMKilled
app: shop
---

# Worker memory and OOMKilled

## What it looks like

`container shop-worker-1 OOMKilled (exit 137)` in the logs, restarts with a growing
backoff, and `worker_memory_mb` climbing to the container limit (512Mi today) in
the metrics. While it restarts, nobody drains the `payment-confirm` queue.

## What to check first

1. The release that went out before the memory started to climb: what changed in the worker?
2. The memory limit in `deploy/worker.yaml`: was it lowered recently?
3. Whether staging, on the same release, shows the same curve. If it does not, compare the load before blaming the code.

## Restart, then scale

Restarting the worker empties its memory and buys time. Scale to more replicas
only if the queue is long: more replicas drain it faster but each one still grows.
Neither fixes a leak; they only give a person time to find it.

## Past leaks

See [the email renderer leak of August](incidents/2026-08-email-renderer-leak.md): a cache without an eviction rule grew with traffic.

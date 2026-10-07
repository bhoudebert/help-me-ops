# Investigate a problem

Describe the problem as it was reported, with the identifiers you have: an
order number, a user, an error code, a time.

## What the assistant does

1. **Finds your playbook** for that kind of problem and follows its steps.
2. **Searches your sources** for the identifiers, narrowing the time window as
   it learns.
3. **Builds a timeline**, oldest first, each line quoting its source and time.
4. **Concludes**: the most likely cause, how sure it is and why, what is still
   unknown, and the next step for a person.

It never changes your system: a fix ("replay the payment webhook") is
proposed for you to make.

## Example

In the [demo](/demo), "client u-881 paid but cannot find order 4512" leads to
the order (`awaiting_payment` since 09:58), the payment webhook refused with a
503 at 10:00 while the provider answered 200, a queue past 1000 jobs, and the
confirmation worker OOMKilled at 10:01, after release 2.14.0. The same release
is fine in staging. Which environment a question is about is the first thing
the assistant settles (`scope`); when you do not say, it asks.

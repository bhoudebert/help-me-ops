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

With the example sources, "client u-881 paid but cannot find order 4512"
leads to the order row (`awaiting_payment` since 09:58), the log lines of the
payment webhook refused with a 503 at 10:00, and the confirmation worker
crash-looping (OOMKilled) at 10:01.

---
name: Order stuck or missing
when: a client cannot find their order, an order is stuck, paid but no order, order not confirmed
---

Fill in the blanks for your system; keep the steps in the order you would follow them.

1. **The order itself.** Search `orders-db` for the order number: its status and when it last changed.
   - Expected statuses and what each means: _TODO: e.g. awaiting_payment → paid → confirmed → shipped_
2. **Its story in the logs.** Search `app-logs` for the order number, from its creation onwards.
   - Look for: _TODO: the events that move an order forward (payment webhook, confirmation job)_
3. **What it waits for.** If it stopped at a step, search that step's service around the time it stopped:
   errors, timeouts, a queue that does not drain.
   - _TODO: name the queues, jobs and external providers involved, and the source that shows each_
4. **Others affected.** Search for the same error in the same window: one order, or all of them?
5. **Conclude** with the cause, the evidence, and the fix for a person to make
   (_TODO: who to call, the runbook to replay a webhook or a job_).

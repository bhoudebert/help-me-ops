---
name: Order stuck or missing
when: a client cannot find their order, an order is stuck, paid but no order, order not confirmed
---

How the shop's team investigates a stuck order. This one is filled in for the
demo; copy it and change the sources and the expectations for your system.

1. **The order itself.** `order.getOrder` with the number: its status and when it last changed.
   - Statuses: `awaiting_payment` → `confirmed` (the confirmation worker moves it once the payment provider's webhook is handled) → `shipped`.
2. **Its story in the logs.** Search `app-logs` for the order number from its creation: the payment session, the redirect back, the webhook.
   - The event that moves an order forward is `webhook payment.succeeded`. If it never arrives, find out who refused it.
3. **What it waits for.** The webhook goes through `/hooks/acme-pay` into the `payment-confirm` queue, drained by `shop-worker`.
   - `health.checkHealth` on `hooks` and on `provider`: is it us or the provider?
   - `metrics.queryMetric` on `payment_confirm_queue_depth`, `worker_memory_mb` and `worker_cpu_percent` around the time it stopped.
   - Search `app-logs` for `worker` and `deploy` in that window.
4. **Others affected.** `order.listOrders` with `awaiting_payment` since the time it stopped: one order, or all of them?
5. **The other environment.** Same release in staging? If staging is healthy, say what differs (load, replicas), not that it is fine.
6. **Conclude** with the cause, how sure you are, the evidence, and what is unknown. The fix is for a person: restart or scale the worker, then replay the webhook for each stuck order (runbook: _TODO: your link_).

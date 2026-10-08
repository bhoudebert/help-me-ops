---
name: The payment webhook
app: shop
---

# The payment webhook

## What the endpoint does

The payment provider (acme-pay) calls `/hooks/acme-pay` with `payment.succeeded`
when a customer has paid. The endpoint puts a job in the `payment-confirm` queue
and answers 200. The `shop-worker` drains the queue and moves the order from
`awaiting_payment` to `confirmed`.

## Why it answers 503

To protect the worker, the endpoint **refuses with a 503 when the queue holds more
than 1000 jobs**. The log line is `webhook endpoint /hooks/acme-pay returned 503 to
provider (queue full)`. The provider retries a refused webhook a few times over a
few hours, then gives up: an order can stay `awaiting_payment` although the
customer paid.

## Replay the webhooks

Only once the worker drains the queue again (see the worker memory runbook):

1. In the provider's dashboard, filter the events `payment.succeeded` that were refused (status 503) in the window.
2. Use **Resend** on each one. Do not resend twice: the worker skips duplicates, but the customer may get two emails.
3. Check that each order is `confirmed` a minute later.

## Who to call

The payments team on-call, `#payments-oncall`. Tell the customer support lead
which orders are affected.

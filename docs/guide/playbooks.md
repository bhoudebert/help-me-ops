# Write a playbook

A playbook says how your team investigates a kind of problem. It is a Markdown
file in `playbooks/`, readable by people on call as much as by the model.

```markdown
---
name: Order stuck or missing
when: a client cannot find their order, an order is stuck, paid but no order
---

1. Search `orders-db` for the order number: its status and when it last changed.
2. Search `app-logs` for the order number from its creation on …
```

- **`when`** uses the words people report the problem with: that is how a
  playbook is matched to a question.
- **Steps** name the sources to search, in the order you would.
- Start from `playbooks/order-stuck.md` and fill in its `_TODO_` blanks.

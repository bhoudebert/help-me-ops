# Playbooks

One file per kind of problem, in Markdown, so anyone on the team can write
one. The front matter says when it applies, in the words people use to report
the problem; the body lists the steps, naming the sources to search.

```markdown
---
name: Order stuck or missing
when: a client cannot find their order, an order is stuck, paid but no order
---

1. Search `orders-db` for the order number …
```

Copy `order-stuck.md` and fill in the blanks (`_TODO_`). The model follows a
matching playbook before improvising, and quotes the evidence each step finds.

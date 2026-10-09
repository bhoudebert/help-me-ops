# Which model? What was measured

help-me-ops has no favourite model. This page is what **one maintainer's machine measured**, as files in the repository that you can read and re-run, and a way to measure yours. The numbers are a snapshot of a setup, not a ranking of models.

## The latest numbers

Runs where the answer named the cause, out of the runs made, for each incident of the demo world, with the conclusion check's acceptances and the median time of a run:

<!-- bench:table:start -->

| Setting                     | missing-emails | slow-checkout | stuck-order | Accepted | Median time |
| --------------------------- | -------------: | ------------: | ----------: | -------: | ----------: |
| gpt-oss:20b · reasoning low |            3/3 |           0/3 |         3/3 |      8/9 |        30 s |
| qwen3:14b · reasoning none  |            5/5 |           0/5 |         5/5 |    15/15 |        13 s |
| qwen3:8b · reasoning none   |            0/5 |           0/5 |         4/5 |    15/15 |         6 s |

<!-- bench:table:end -->

Set up: an RTX 5080 with 16 GB, 60 GB of RAM, Ollama 0.32.14 (CUDA) with a context of 16,384 tokens, temperature 0. Qwen runs have thinking off (`--reasoning none`); gpt-oss runs at `low`. Five runs per scenario for Qwen, three for gpt-oss (a 13 GB model on a card shared with a desktop, so partly on the CPU, which is why it is slow). The table is generated from [`bench/results/`](https://github.com/bhoudebert/help-me-ops/tree/main/bench/results): each file holds every run, the commit of this repository, the machine and the date.

## How to read it

- **"Found the cause"** means the answer names the facts the scenario requires, as keywords (see [`ops eval`](/local-models#measure-it-ops-eval)). It is **not a judge of reasoning**: a right answer in other words is missed, and the right words for the wrong reason are counted.
- **"Accepted"** is the conclusion check accepting a conclusion. It proves every quote was returned by a tool, **not that the cause is right**, so on its own it says little: a model can conclude "the order is awaiting payment" and be accepted.
- **The incidents differ on purpose.** `stuck-order` has a playbook and runbooks; `missing-emails` (an expired certificate) and `slow-checkout` (a missing index under load) have none, so they have to be found from the evidence. A model that only knows the first shows.
- **Nobody found `slow-checkout`.** The best model reaches the symptom (the connection pool is full), then does not look in the logs for what changed, and says the cause of the exhaustion is unknown. That is honest, and the benchmark still has headroom.
- **Two fixes came from this, not from tuning to a scenario.** The first measurement had a model searching 2023 for "last night" because it did not know the date, and a log search that needed the exact phrase. The assistant is now told the date, and a search needs every word in any order (and says when nothing matched). Nothing in either mentions a payment, a queue or a certificate.

## Not measured

`llama3.1:8b` and `deepseek-r1` (7B, 14B) were tried on the first scenario before those two fixes: the first called one tool and then answered in words, the others never called a tool. They were not re-measured, so they are not in the table. Kimi was not tested: Ollama offers it only as a cloud model, and the open weights are far too large for a normal machine. No hosted provider has been called.

## Measure your own

```bash
npm run bench -- --machine "your GPU, your server and version" --label mybox \
  --model qwen3:14b --reasoning none --runs 5 --base-url http://localhost:11434/v1
npm run bench:table      # rewrite the table above from bench/results/
```

`npm run bench` runs `ops eval` on every scenario and writes a record to `bench/results/` with the date, the commit and your description of the machine. To add your numbers to this page, send the file in a pull request: say how the model was served (server, quantisation, context) in `--notes`, and keep it to one machine per file. Your own scenarios work the same way (see [`ops eval`](/local-models#measure-it-ops-eval)).

Nothing here costs money and none of it runs in the test suite: the tests use a scripted fake server, and one test checks that the table above is exactly what the stored files produce.

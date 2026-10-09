# Which model? What was measured

help-me-ops has no favourite model. This page is what **one maintainer's machine measured**, as files in the repository that you can read and re-run, and a way to measure yours. The numbers are a snapshot of a setup, not a ranking of models.

## The latest numbers

Runs where the answer named the cause, out of the runs made, for each incident of the demo world, with the conclusion check's acceptances and the median time of a run:

<!-- bench:table:start -->

| Setting                     | Temp | missing-emails | slow-checkout | stuck-order | Accepted | Median time |
| --------------------------- | ---: | -------------: | ------------: | ----------: | -------: | ----------: |
| gpt-oss:20b · reasoning low |  0.7 |            6/8 |           0/8 |         4/8 |    11/24 |        33 s |
| qwen3:14b · reasoning none  |  0.7 |            3/8 |           0/8 |         7/8 |    24/24 |        14 s |
| qwen3:8b · reasoning none   |  0.7 |            3/8 |           0/8 |         2/8 |    24/24 |         8 s |

<!-- bench:table:end -->

Set up: an RTX 5080 with 16 GB, 60 GB of RAM, Ollama 0.32.14 (CUDA) with a context of 16,384 tokens. Qwen runs have thinking off (`--reasoning none`), gpt-oss runs at `low`; the temperature is in the table, eight runs per scenario. gpt-oss is a 13 GB model on a card shared with a desktop, so partly on the CPU, which is why it is slow. The table is generated from [`bench/results/`](https://github.com/bhoudebert/help-me-ops/tree/main/bench/results): each file holds every run, the commit of this repository, the machine and the date.

## How to read it

- **"Found the cause"** means the answer names the facts the scenario requires, as keywords (see [`ops eval`](/local-models#measure-it-ops-eval)). It is **not a judge of reasoning**: a right answer in other words is missed, and the right words for the wrong reason are counted.
- **"Accepted"** is the conclusion check accepting a conclusion. It proves every quote was returned by a tool, **not that the cause is right**, so on its own it says little: a model can conclude "the order is awaiting payment" and be accepted. For gpt-oss it is low because it often writes a tool call the server cannot read, or answers without calling the check.
- **The temperature matters.** At temperature 0 a model answers almost the same every time, so five runs were hardly five samples: an earlier table showed `qwen3:14b` at 5/5 on two incidents, and at 0.7 (independent samples, eight runs) it is 7/8 and 3/8. Those earlier records are kept (`temp0` in their names) and are not in the table. Treat any number here as a rough measure: eight runs cannot tell 5/8 from 7/8.
- **The incidents differ on purpose.** `stuck-order` has a playbook and runbooks; `missing-emails` (an expired certificate) and `slow-checkout` (a missing index under load) have none, so they have to be found from the evidence. Size is not the whole story: the 14B finds the stuck order in 7 runs of 8 and the 8B in 2, but both find the expired certificate in 3 and gpt-oss, which is neither, in 6.
- **Nobody found `slow-checkout`.** It needs two facts: the slow query that scans the whole table, and release 2.15.0 that introduced it. Both Qwen models now find the slow query in six runs of eight, and none connects it to the release. That is as far as a symptom-to-change search goes today, and the benchmark still has headroom.

## What was tried

Each of these came from reading what a model did in a failed run, and each was measured on all three incidents before it was kept:

- **Kept: tell the assistant the date.** A model that does not know today's date searched 2023 for "last night". The assistant is now told the current date (the scenario's own in `ops eval`).
- **Kept: a log search needs every word, in any order,** and when no line has every word it returns the lines with the most of them, best first, marked as partial. Before, "slow timeout" returned nothing and a model concluded from the metrics alone; with it the slow query is found.
- **Rejected: a sentence in the method telling the model to look for what changed before a symptom began.** It made things worse (the 14B went from 5/5 to 0/5 on the certificate incident, the 8B from 4/5 to 0/5 on the stuck order, at temperature 0, five runs) and was reverted. A change to the prompt needs a measurement, and a plausible one is not enough.

None of the kept changes mentions a payment, a queue, a certificate or a release.

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

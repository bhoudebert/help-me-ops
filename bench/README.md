# Benchmark records

One JSON file per run of `npm run bench`: the date, the commit of this repository, the
machine as its owner describes it, and every run of every scenario of the demo world
(status, steps, tokens, time, which expected facts the answer named).

The table of [the guide page](../docs/guide/benchmarks.md) is made from these files
(`npm run bench:table`), and a test fails when the page and the files disagree. A file
is a measurement of one setup on one day: do not edit it, add another.

To add yours:

```bash
npm run bench -- --machine "your GPU, your server and version" --label mybox \
  --model qwen3:14b --reasoning none --runs 5 --base-url http://localhost:11434/v1 \
  --notes "how the model was served: quantisation, context"
npm run bench:table
```

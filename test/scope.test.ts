import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { describeScope, resolveScope } from "../src/scope.ts";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

/** Two apps; shop has prod and staging, each with its own log saying where it is from. */
async function twoEnvs() {
  const dir = mkdtempSync(join(tmpdir(), "ops-scope-"));
  mkdirSync(join(dir, "logs"));
  const source = (env: string) => ({
    id: "logs",
    type: "file-logs",
    path: `logs/${env}.log`,
    description: `Logs of ${env}`,
  });
  for (const env of ["prod", "staging", "billing"]) {
    writeFileSync(join(dir, "logs", `${env}.log`), `2026-10-07T10:00:00Z order=4512 seen in ${env}\n`);
  }
  writeFileSync(
    join(dir, "ops.config.json"),
    JSON.stringify({
      apps: {
        shop: {
          description: "Online shop: orders and payments",
          envs: { prod: { sources: [source("prod")] }, staging: { sources: [source("staging")] } },
        },
        billing: { description: "Invoices", envs: { prod: { sources: [source("billing")] } } },
      },
    }),
  );
  return openToolbox(dir);
}

test("scope: a lone app or environment may be left out; several must be named", async () => {
  const { apps } = await twoEnvs();
  assert.equal(resolveScope(apps, "billing").env.name, "prod");
  assert.deepEqual(
    [resolveScope(apps, "shop", "staging").app.name, resolveScope(apps, "shop", "staging").env.name],
    ["shop", "staging"],
  );
  assert.throws(() => resolveScope(apps), /Several apps \(shop, billing\): say which with "app"/);
  assert.throws(() => resolveScope(apps, "shop"), /Several envs \(prod, staging\)/);
  assert.throws(() => resolveScope(apps, "nope"), /No app "nope"\. Known: shop, billing\./);
  assert.throws(() => resolveScope(apps, "shop", "dev"), /No env "dev" in app shop\. Known: prod, staging\./);
});

test("scope: the same search reads only the environment asked for", async () => {
  const toolbox = await twoEnvs();
  const search = createToolDefinitions(toolbox).find((t) => t.name === "searchSource")!;
  const read = async (app: string, env: string) =>
    JSON.parse(await search.run({ app, env, source: "logs", query: "4512" }));
  const prod = await read("shop", "prod");
  const staging = await read("shop", "staging");
  assert.deepEqual([prod.env, staging.env], ["prod", "staging"]);
  assert.match(prod.evidence[0].summary, /seen in prod/);
  assert.match(staging.evidence[0].summary, /seen in staging/);
  assert.doesNotMatch(JSON.stringify(prod), /staging/);
});

test("scope: a question points at an app and an environment, with the reason, or asks", async () => {
  const { apps } = await twoEnvs();
  const likely = (q?: string) => describeScope(apps, q);

  const prod = likely("orders are stuck in production");
  assert.deepEqual([prod.likely.app, prod.likely.env, prod.ask], ["shop", "prod", []]);
  assert.match(prod.likely.reasons.join(" "), /mentions orders/);
  assert.match(prod.likely.reasons.join(" "), /mentions production/);

  assert.equal(likely("the invoices are wrong").likely.app, "billing");
  assert.equal(likely("the invoices are wrong").likely.env, "prod");
  assert.equal(likely("payments fail on stage").likely.env, "staging");

  const vague = likely("something is slow");
  assert.deepEqual([vague.likely.app, vague.likely.env], [null, null]);
  assert.match(vague.ask[0]!, /which app \(shop, billing\)/);

  const noEnv = likely("the shop is slow");
  assert.equal(noEnv.likely.app, "shop");
  assert.equal(noEnv.likely.env, null);
  assert.match(noEnv.ask[0]!, /which environment of shop \(prod, staging\)/);

  assert.deepEqual(
    likely().apps.map((a) => [a.name, a.envs.map((e) => e.name)]),
    [
      ["shop", ["prod", "staging"]],
      ["billing", ["prod"]],
    ],
  );
});

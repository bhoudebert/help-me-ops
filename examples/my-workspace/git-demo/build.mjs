// Builds the demo's source repository: the shop's code and the changes that led
// to the incident, as a real git repository you can point the git addon at.
//
//   node examples/my-workspace/git-demo/build.mjs [folder]     (default: .demo-repo, next to ops.config.json)
//
// A repository cannot live inside this one as files, so it is made on demand,
// the same way every time (fixed authors and dates). Nothing here is real code.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const AUTHORS = {
  alice: ["Alice Martin", "alice@shop.example"],
  bob: ["Bob Keller", "bob@shop.example"],
  carol: ["Carol Diaz", "carol@shop.example"],
};

const WEBHOOK = `// The provider's payment.succeeded webhook. The queue protects the worker:
// above QUEUE_LIMIT jobs the endpoint refuses (503) and the provider retries.
const QUEUE_LIMIT = 1000;

export async function handleWebhook(event, queue) {
  if (queue.depth() > QUEUE_LIMIT) {
    log.error("webhook endpoint /hooks/acme-pay returned 503 to provider (queue full)");
    return { status: 503 };
  }
  await queue.push({ type: "payment-confirm", order: event.order });
  return { status: 200 };
}
`;

const CONFIRM_V1 = `// The confirmation worker: moves an order from awaiting_payment to confirmed.
// One job at a time.
export async function run(queue, orders) {
  for await (const job of queue) {
    await orders.confirm(job.order);
    await queue.ack(job);
  }
}
`;

const CONFIRM_V2 = `// The confirmation worker: moves an order from awaiting_payment to confirmed.
// Batches of 500 jobs, and every confirmation is kept to skip duplicates.
const BATCH = 500;
const confirmed = new Map(); // order -> confirmation, kept for the life of the process

export async function run(queue, orders) {
  for await (const jobs of queue.batches(BATCH)) {
    for (const job of jobs) {
      if (confirmed.has(job.order)) continue;
      confirmed.set(job.order, await orders.confirm(job.order));
    }
    await queue.ackAll(jobs);
  }
}
`;

const DEPLOY = (memory) => `# shop-worker deployment
replicas: 2
resources:
  limits:
    memory: ${memory}
`;

/** Creates the repository in \`dir\` (which must not hold one yet) and returns the commits made, newest last. */
export function buildDemoRepo(dir) {
  if (existsSync(join(dir, ".git"))) throw new Error(`${dir} already holds a git repository`);
  mkdirSync(dir, { recursive: true });
  const git = (args, env = {}) =>
    execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    })
      .toString()
      .trim();
  const write = (path, content) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  const commits = [];
  const commit = (who, at, subject, body, files) => {
    for (const [path, content] of Object.entries(files)) write(path, content);
    const [name, email] = AUTHORS[who];
    const env = {
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: email,
      GIT_AUTHOR_DATE: at,
      GIT_COMMITTER_DATE: at,
    };
    git(["add", "-A"], env);
    git(["commit", "-m", subject, ...(body ? ["-m", body] : [])], env);
    commits.push(git(["rev-parse", "HEAD"]));
    return env;
  };
  const tag = (name, env) => git(["tag", "-a", name, "-m", `Release ${name.slice(1)}`], env);

  git(["init", "-b", "main"]);
  commit(
    "alice",
    "2026-09-20T10:00:00Z",
    "Add the payment webhook endpoint",
    "Refuse above 1000 queued jobs so the worker is not flooded.",
    {
      "src/api/webhook.js": WEBHOOK,
      "README.md": "# shop (demo)\n\nNot real code: the repository the git addon reads in the help-me-ops demo.\n",
      "package.json": '{ "name": "shop", "version": "2.13.0" }\n',
    },
  );
  let env = commit("alice", "2026-09-25T15:30:00Z", "Confirm payments one job at a time", "", {
    "src/worker/confirm.js": CONFIRM_V1,
    "deploy/worker.yaml": DEPLOY("1Gi"),
  });
  tag("v2.13.0", env);
  env = commit("carol", "2026-10-02T09:10:00Z", "Fix the typo in the confirmation email", "", {
    "src/api/webhook.js": WEBHOOK.replace("flooded", "flooded."),
    "package.json": '{ "name": "shop", "version": "2.13.2" }\n',
  });
  tag("v2.13.2", env);
  commit(
    "bob",
    "2026-10-05T16:20:00Z",
    "Speed up confirmations: batches of 500 and a cache of confirmed orders",
    "Throughput is 4x on the load test. The cache skips duplicate webhooks.",
    { "src/worker/confirm.js": CONFIRM_V2 },
  );
  commit("carol", "2026-10-06T11:00:00Z", "Lower the worker memory limit to 512Mi", "Free some room on the nodes.", {
    "deploy/worker.yaml": DEPLOY("512Mi"),
  });
  env = commit("bob", "2026-10-07T09:20:00Z", "Release 2.14.0", "", {
    "package.json": '{ "name": "shop", "version": "2.14.0" }\n',
  });
  tag("v2.14.0", { ...env, GIT_COMMITTER_DATE: "2026-10-07T09:30:00Z" });
  return commits;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = resolve(process.argv[2] ?? join(import.meta.dirname, "..", ".demo-repo"));
  buildDemoRepo(dir);
  console.log(`Demo repository in ${dir} (tags v2.13.0, v2.13.2, v2.14.0).`);
}

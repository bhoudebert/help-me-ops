// `ops setup`: the configuration that connects each client, with the real paths,
// checked by really starting the server; and the write that never replaces.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { claudeCommand, claudeJson, codexToml, command, copilotJson, runSetup, writeJson } from "../src/setup.ts";

const clone = resolve(".");
const workspace = resolve("examples/my-workspace");
const temp = () => mkdtempSync(join(tmpdir(), "ops-setup-"));

test("setup: what each client is given, with absolute paths and the workspace", () => {
  const spaced = { clone: "/home/me/my tools/help-me-ops", workspace: "/home/me/it's ops" };
  assert.deepEqual(command(spaced), {
    command: "node",
    args: [
      "--env-file-if-exists=/home/me/my tools/help-me-ops/.env",
      "/home/me/my tools/help-me-ops/src/mcp.ts",
      "--workspace",
      "/home/me/it's ops",
    ],
  });
  assert.deepEqual(claudeJson(spaced).mcpServers["help-me-ops"].args.at(-1), "/home/me/it's ops");
  assert.equal(
    claudeCommand(spaced),
    "claude mcp add help-me-ops --scope user -- node '--env-file-if-exists=/home/me/my tools/help-me-ops/.env' '/home/me/my tools/help-me-ops/src/mcp.ts' --workspace '/home/me/it'\\''s ops'",
  );
  assert.equal(
    claudeCommand({ clone: "/c", workspace: "/w" }),
    "claude mcp add help-me-ops --scope user -- node --env-file-if-exists=/c/.env /c/src/mcp.ts --workspace /w",
  );
  assert.equal(
    codexToml({ clone: "/c", workspace: "/w" }),
    '[mcp_servers.help-me-ops]\ncommand = "node"\nargs = ["--env-file-if-exists=/c/.env", "/c/src/mcp.ts", "--workspace", "/w"]',
  );
  assert.deepEqual(copilotJson({ clone: "/c", workspace: "/w" }), {
    servers: {
      "help-me-ops": {
        type: "stdio",
        command: "node",
        args: ["/c/src/mcp.ts", "--workspace", "/w"],
        envFile: "/c/.env",
      },
    },
  });
});

test("setup: checks node and the workspace, starts the server as a client would, then prints all three clients", async () => {
  const { ok, text } = await runSetup([], { clone, workspace, defaulted: true });
  assert.equal(ok, true, text);
  assert.match(text, /ok {4}node 24\./);
  assert.match(
    text,
    /ok {4}workspace .*my-workspace: 1 app\(s\) \(shop\), the shipped demo: pass --workspace <dir> for yours/,
  );
  assert.match(
    text,
    /ok {4}the server started as a client will start it and answered over MCP: \d+ tools, with its method/,
  );
  for (const heading of ["Claude Code", "Codex", "Copilot (VS Code)"])
    assert.match(text, new RegExp(`^${heading.replace(/[()]/g, "\\$&")}$`, "m"));
  assert.ok(text.includes(`claude mcp add help-me-ops --scope user -- node --env-file-if-exists=${clone}/.env`));
  assert.ok(text.includes(`[mcp_servers.help-me-ops]`) && text.includes(`"envFile": "${clone}/.env"`));
  const only = await runSetup(["codex"], { clone, workspace, defaulted: false });
  assert.doesNotMatch(only.text, /Claude Code|Copilot \(VS Code\)/);
  assert.doesNotMatch(only.text, /the shipped demo/);
  assert.doesNotMatch(
    (await runSetup(["claude", "--no-verify"], { clone, workspace, defaulted: false })).text,
    /answered over MCP/,
  );
});

test("setup: a workspace that does not load fails the setup, and says why, with no server started", async () => {
  const { ok, text } = await runSetup([], { clone, workspace: temp(), defaulted: false });
  assert.equal(ok, false);
  assert.match(text, /FAIL {2}workspace .*: No ops.config.json in /);
  assert.doesNotMatch(text, /answered over MCP/);
  await assert.rejects(
    runSetup(["emacs"], { clone, workspace, defaulted: false }),
    /Unknown client "emacs"\.\n\nUsage: npm run ops -- setup/,
  );
  await assert.rejects(runSetup(["--write"], { clone, workspace, defaulted: false }), /--write needs --into <project>/);
});

test("setup --write: adds the server to .mcp.json and .vscode/mcp.json, keeps the rest, never replaces", async () => {
  const project = temp();
  mkdirSync(join(project, ".vscode"));
  writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } }, keep: true }));
  const { ok, text } = await runSetup(["all", "--into", project, "--write", "--no-verify"], {
    clone,
    workspace,
    defaulted: false,
  });
  assert.equal(ok, true, text);
  const claude = JSON.parse(readFileSync(join(project, ".mcp.json"), "utf8"));
  assert.deepEqual(Object.keys(claude.mcpServers), ["other", "help-me-ops"]);
  assert.equal(claude.keep, true);
  assert.equal(claude.mcpServers["help-me-ops"].args.at(-1), workspace);
  const copilot = JSON.parse(readFileSync(join(project, ".vscode/mcp.json"), "utf8"));
  assert.equal(copilot.servers["help-me-ops"].envFile, join(clone, ".env"));
  assert.match(text, /wrote .*\.mcp\.json/);
  assert.match(text, /codex: ~\/\.codex\/config\.toml is yours, so it is not written/);

  const before = readFileSync(join(project, ".mcp.json"), "utf8");
  await assert.rejects(
    writeJson(join(project, ".mcp.json"), "mcpServers", { command: "y" }),
    /already has a help-me-ops server: nothing was written/,
  );
  assert.equal(readFileSync(join(project, ".mcp.json"), "utf8"), before);
  writeFileSync(join(project, "bad.json"), "{ nope");
  await assert.rejects(
    writeJson(join(project, "bad.json"), "mcpServers", {}),
    /is not valid JSON.*nothing was written/,
  );
  const fresh = join(temp(), "deep/new.json");
  await writeJson(fresh, "servers", { a: 1 });
  assert.deepEqual(JSON.parse(readFileSync(fresh, "utf8")), { servers: { "help-me-ops": { a: 1 } } });
  // a failed check writes nothing
  const refused = temp();
  await assert.rejects(
    runSetup(["claude", "--into", refused, "--write"], { clone, workspace: temp(), defaulted: false }),
    /Not writing: a check failed above/,
  );
});

test("setup: the command, with no setup, prints the configuration and exits 0; a bad workspace exits 1", () => {
  const run = (args: string[]) =>
    spawnSync("node", ["src/cli.ts", "setup", ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH!, HOME: process.env.HOME! },
    });
  const ok = run(["copilot"]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /Copilot \(VS Code\)/);
  const bad = run(["--workspace", temp()]);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /FAIL {2}workspace/);
});

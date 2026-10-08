// The ready-made addons are documented, and the documentation keeps up: each
// addon's page names every tool, setting and variable of its manifest, the
// catalog lists every addon, and every addon folder has a README.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const shipped = readdirSync("addons", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

type Manifest = {
  settings?: Record<string, { env?: string } | string>;
  tools?: Record<string, { params?: Record<string, unknown> }>;
};

test("docs: there is a page, a README and a catalog row for every shipped addon", () => {
  assert.ok(shipped.length >= 5, `found ${shipped.join(", ")}`);
  const catalog = read("docs/guide/ready-made/index.md");
  const sidebar = read("docs/guide/.vitepress/config.mts");
  for (const name of shipped) {
    assert.ok(existsSync(join("docs/guide/ready-made", `${name}.md`)), `${name}: page`);
    assert.ok(existsSync(join("addons", name, "README.md")), `${name}: README in the addon folder`);
    // plain text, not a pattern built from a folder name
    assert.ok(catalog.includes(`](/ready-made/${name})`), `${name}: catalog row`);
    assert.ok(sidebar.includes(`/ready-made/${name}"`), `${name}: sidebar`);
    assert.ok(read(join("addons", name, "README.md")).includes(`ready-made/${name}`), `${name}: README links its page`);
  }
});

test("docs: each page names every tool, parameter, setting and variable of its manifest, on the one pattern", () => {
  const sections = [
    "## What you need",
    "## Set it up",
    "### Settings",
    "## What it can do",
    "## Ask it",
    "## Safety",
    "## Data it can return",
    "## Try it without an account",
    "## If it does not work",
    "## Limits",
  ];
  for (const name of shipped.filter((n) => existsSync(join("addons", n, "addon.json")))) {
    const page = read(join("docs/guide/ready-made", `${name}.md`));
    const manifest = JSON.parse(read(join("addons", name, "addon.json"))) as Manifest;
    for (const heading of sections) assert.ok(page.includes(heading), `${name}: section "${heading}"`);
    assert.match(page, /\*\*Status:\*\*/, `${name}: status`);
    for (const [tool, definition] of Object.entries(manifest.tools ?? {})) {
      assert.ok(page.includes(`${name}.${tool}`), `${name}: tool ${tool}`);
      for (const param of Object.keys(definition.params ?? {}))
        assert.ok(page.includes(`\`${param}`), `${name}: ${tool} parameter ${param}`);
    }
    for (const [setting, spec] of Object.entries(manifest.settings ?? {})) {
      assert.ok(page.includes(`\`${setting}\``), `${name}: setting ${setting}`);
      const env = typeof spec === "object" ? spec.env : undefined;
      if (env) assert.ok(page.includes(`\`${env}\``), `${name}: variable ${env}`);
    }
  }
});

test("docs: experimental addons say so in the manifest, the page, the catalog and the README", () => {
  for (const name of shipped.filter((n) => existsSync(join("addons", n, "addon.json")))) {
    const manifest = read(join("addons", name, "addon.json"));
    const experimental = /^\s*"description":\s*"EXPERIMENTAL/m.test(manifest);
    const page = read(join("docs/guide/ready-made", `${name}.md`));
    assert.equal(/\*\*Status:\*\* \*\*experimental\*\*/.test(page), experimental, `${name}: page status`);
    assert.equal(
      /\*\*experimental\*\*/.test(
        read("docs/guide/ready-made/index.md")
          .split("\n")
          .find((l) => l.includes(`/ready-made/${name})`)) ?? "",
      ),
      experimental,
      `${name}: catalog status`,
    );
    assert.equal(
      /\*\*experimental\*\*/.test(read(join("addons", name, "README.md"))),
      experimental,
      `${name}: README status`,
    );
  }
});

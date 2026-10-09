import { defineConfig } from "vitepress";

// The guide, published under the project site at /help-me-ops/guide/.
// Pages are plain Markdown in docs/guide/, readable on GitHub as they are.
export default defineConfig({
  base: "/help-me-ops/guide/",
  title: "help-me-ops",
  titleTemplate: ":title · help-me-ops guide",
  description: "Investigate a running system from its logs, metrics and database, with Claude Code, Codex or Copilot.",
  lang: "en",
  cleanUrls: true,
  lastUpdated: true,
  // Light only, like the project site; the blue is the site's.
  appearance: false,
  head: [
    ["meta", { name: "color-scheme", content: "light" }],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap", rel: "stylesheet" }],
    [
      "style",
      {},
      ":root{--vp-font-family-base:Inter,system-ui,sans-serif;--vp-font-family-mono:'JetBrains Mono',ui-monospace,monospace;--vp-c-brand-1:#1d4ed8;--vp-c-brand-2:#2563eb;--vp-c-brand-3:#2563eb;--vp-c-brand-soft:rgba(37,99,235,.12);--vp-button-brand-bg:#2563eb;--vp-button-brand-hover-bg:#1d4ed8}",
    ],
  ],
  themeConfig: {
    siteTitle: "help-me-ops · guide",
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "Project site", link: "https://bhoudebert.github.io/help-me-ops/" },
    ],
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Getting started", link: "/getting-started" },
          { text: "Claude Code, Codex and Copilot", link: "/clients" },
          { text: "One server for the team", link: "/team-server" },
          { text: "Try the demo", link: "/demo" },
          { text: "…with a real database", link: "/database" },
          { text: "Investigate a problem", link: "/investigate" },
          { text: "Without an AI client: your own model", link: "/local-models" },
          { text: "Which model? What was measured", link: "/benchmarks" },
          { text: "Personal data", link: "/privacy" },
          { text: "Independence and no warranty", link: "/legal" },
        ],
      },
      {
        text: "Ready-made addons",
        items: [
          { text: "Catalog: what each needs", link: "/ready-made/" },
          { text: "logs", link: "/ready-made/logs" },
          { text: "rest", link: "/ready-made/rest" },
          { text: "git", link: "/ready-made/git" },
          { text: "PostgreSQL", link: "/ready-made/postgres" },
          { text: "datadog (experimental)", link: "/ready-made/datadog" },
          { text: "github (experimental)", link: "/ready-made/github" },
          { text: "prometheus (experimental)", link: "/ready-made/prometheus" },
          { text: "loki (experimental)", link: "/ready-made/loki" },
          { text: "elasticsearch (experimental)", link: "/ready-made/elasticsearch" },
        ],
      },
      {
        text: "Fill in the blanks",
        items: [
          { text: "What is in a workspace", link: "/workspace" },
          { text: "Connect your sources", link: "/connectors" },
          { text: "Write a playbook", link: "/playbooks" },
          { text: "Write down what you know", link: "/knowledge" },
          { text: "Write an addon", link: "/addons" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/bhoudebert/help-me-ops" }],
    editLink: {
      pattern: "https://github.com/bhoudebert/help-me-ops/edit/main/docs/guide/:path",
      text: "Improve this page",
    },
    search: { provider: "local" },
    outline: { level: [2, 3], label: "On this page" },
  },
});

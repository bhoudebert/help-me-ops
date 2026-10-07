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
          { text: "Investigate a problem", link: "/investigate" },
        ],
      },
      {
        text: "Fill in the blanks",
        items: [
          { text: "Connect your sources", link: "/connectors" },
          { text: "Write a playbook", link: "/playbooks" },
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

import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["node_modules/", "cases/", "coverage/", "docs/guide/.vitepress/dist/", "docs/guide/.vitepress/cache/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // Tests poke at fixtures and protocol payloads; strict typing there adds nothing.
    files: ["test/**", "scripts/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  prettier,
);

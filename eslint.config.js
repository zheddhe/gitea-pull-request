// @ts-check
const eslint = require("@eslint/js");
const tseslint = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");

/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  eslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        fetch: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
        global: "readonly",
        NodeJS: "readonly",
        suite: "readonly",
        test: "readonly",
        require: "readonly",
        module: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // Disable core rules that don't understand TypeScript.
      "no-unused-vars": "off",
      "no-undef": "off",
      // Use TypeScript-aware replacements.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^(_|auth$)",
          // Transitional Phase 0 baseline: these variables are pre-existing
          // legacy webview/tree locals. They are intentionally isolated here
          // so --max-warnings=0 catches every new warning introduced by the
          // Gitea Pull Request migration. Remove entries as the legacy views
          // are decomposed during the sidebar-first phases.
          varsIgnorePattern:
            "^(repoInfo|titleJson|baseJson|headJson|branchOptsJson|filesJson|reviewCommentsJson|isOpenJson)$",
        },
      ],
      "no-console": "off",
    },
  },
];

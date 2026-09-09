import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "coverage/**", "dist/**"],
  },
  js.configs.recommended,
  {
    files: [
      "js/**/*.js",
      "tests/**/*.js",
      "eslint.config.js",
      "vite.config.js",
      "vitest.config.js",
    ],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        auth0: "readonly",
        Chart: "readonly",
        Tabulator: "readonly",
      },
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["tests/**/*.js", "vite.config.js", "vitest.config.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];

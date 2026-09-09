// Production build.
//
// Bundles each page's module graph into content-hashed chunks under dist/assets/ and rewrites
// the script and stylesheet tags to match. Local development serves this directory unbuilt.

import { readdirSync } from "node:fs";

import { defineConfig } from "vite";

// Every HTML entry point. Root-absolute srcs inside them resolve against this directory, and
// the output tree mirrors the input tree, which the root-relative nav links need.
const PAGES = [
  "index.html",
  ...readdirSync("html", { recursive: true })
    .filter((path) => path.endsWith(".html"))
    .map((path) => `html/${path}`),
];

export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: { input: PAGES },
  },
});

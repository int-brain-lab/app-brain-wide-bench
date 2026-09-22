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

// Analytics, added to every entry below rather than to each page's markup: a new page is
// discovered, not listed, and a tag written per page would miss it.
//
// `domains` reports from production only, leaving a local preview build silent. `exclude-search`
// drops record ids and one-shot flags from the reported URL, and leaves the in-page `?view=`
// pageviews to core/router.js — see js/core/analytics.js.
const UMAMI_TAG = `<script
      defer
      src="https://cloud.umami.is/script.js"
      data-website-id="6acf9769-434a-410e-9102-7946d698dd13"
      data-domains="bwb.iblcore.org"
      data-exclude-search="true"
    ></script>`;

export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: { input: PAGES },
  },

  plugins: [
    {
      name: "umami-tag",
      transformIndexHtml: (html) => html.replace("</head>", `  ${UMAMI_TAG}\n  </head>`),
    },
  ],
});

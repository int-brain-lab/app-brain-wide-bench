// Site footer: who made it, and the ways off the page.
//
// Self-mounting into #page-footer, as navTop.js is into #top-nav, and silent on a page
// without one — the landing page is the only one carrying it so far.
//
// Docs and Get help are Lucide placeholders, filled by the createIcons pass renderHtml makes.
// GitHub is an inline SVG: Lucide carries no brand icons, so there is no name for it.

import { renderHtml } from "../core/render.js";
import { getIcon } from "../components/icons.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const REPO_HREF = "https://github.com/int-brain-lab/app-brain-wide-bench";

// The repo's issues: a question belongs there as much as a bug report does.
const HELP_HREF = `${REPO_HREF}/issues`;

const AUTHOR = "IBL Core";

// Both placeholders on the landing page say this, so the footer says it the same way.
const DOCS_PENDING = "Documentation link not yet available";

// ─── ICONS ───────────────────────────────────────────────────────────────────

// A logo, so it is its own filled path — and the one icon here Lucide has no name for.
const GITHUB_ICON = `
  <svg class="footer-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577
      0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633
      17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809
      1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93
      0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267
      1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24
      2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81
      2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24
      12.297c0-6.627-5.373-12-12-12" />
  </svg>
`;

// Sized by `.footer-icon`, which createIcons carries onto the svg it swaps in.
const DOCS_ICON = `<i class="footer-icon" data-lucide="${getIcon("docs")}"></i>`;

const HELP_ICON = `<i class="footer-icon" data-lucide="${getIcon("help")}"></i>`;

// ─── RENDERING ───────────────────────────────────────────────────────────────

// `_blank` on every one of them: all three leave the site, and a reader clicking through
// from the footer has not finished with the page they were on.
function buildFooterLink({ href, icon, label }) {
  return `
    <a class="link icon-link" href="${href}" target="_blank" rel="noopener noreferrer">
      ${icon}
      <span>${label}</span>
    </a>
  `;
}

// The same greyed placeholder the hero's Docs button is, one row down.
function buildPendingLink({ icon, label, title }) {
  return `
    <span class="link disabled-link icon-link" aria-disabled="true" title="${title}">
      ${icon}
      <span>${label}</span>
    </span>
  `;
}

// Read from the clock rather than written in: a hard-coded year is wrong every January.
function buildCredit() {
  return `
    <p class="metadata">© ${new Date().getFullYear()} · by ${AUTHOR}</p>
  `;
}

function buildFooter() {
  return `
    ${buildCredit()}

    <div class="row left gap-xl">
      ${buildFooterLink({ href: REPO_HREF, icon: GITHUB_ICON, label: "GitHub" })}
      ${buildPendingLink({ icon: DOCS_ICON, label: "Docs coming soon", title: DOCS_PENDING })}
      ${buildFooterLink({ href: HELP_HREF, icon: HELP_ICON, label: "Get help" })}
    </div>
  `;
}

// ─── INITIALISATION ──────────────────────────────────────────────────────────

function getFooter() {
  return document.getElementById("page-footer");
}

function initialiseFooter() {
  const footer = getFooter();

  if (!footer) {
    return;
  }

  renderHtml(footer, buildFooter(), { refresh: true });
}

initialiseFooter();

export { buildFooter };

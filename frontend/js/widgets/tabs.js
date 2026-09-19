// A group of panels shown one at a time, at a width where they no longer fit side by side.
//
// Above the width this adds nothing: the panels are the row they were written as, and the
// strip is not in the document at all. Below it, one strip of titles and one panel.
//
// The markup declares the group and the labels — `data-tabs` on the container and
// `data-tab="<label>"` on each panel — so a page adds a tab group without naming it here.
// A panel may also carry `data-tab-ink`, the colour its tab is marked in, and a
// `data-tab-badge`, `data-tab-number` and `data-tab-icon` shown before the label. All of them
// are the markup's words; what they look like is style.css's.

import { escapeHtml } from "../core/html.js";
import { renderHtml } from "../core/render.js";
import { buildIcon } from "../components/icons.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const GROUP = "data-tabs";
const PANEL = "data-tab";

// What a panel may say about how its own tab is drawn.
const INK = "tabInk";
const NUMBER = "tabNumber";
const BADGE = "tabBadge";
const ICON = "tabIcon";

// ─── MARKUP ──────────────────────────────────────────────────────────────────

// `aria-label` as well as the label in the markup: the narrowest tier hides the text and
// leaves the badge or number, and the button still has to say what it opens.
function buildTab({ panel, index, selected, name }) {
  const ink = panel.dataset[INK];
  const number = panel.dataset[NUMBER];
  const badge = panel.dataset[BADGE];
  const icon = panel.dataset[ICON];

  return `
    <button
      class="tab"
      type="button"
      role="tab"
      id="${name}-tab-${index}"
      aria-controls="${panel.id}"
      aria-label="${escapeHtml(panel.dataset.tab)}"
      aria-selected="${selected}"
      tabindex="${selected ? 0 : -1}"
      ${ink ? `data-tab-ink="${escapeHtml(ink)}"` : ""}
    >
      ${number ? `<span class="tab-number">${escapeHtml(number)}</span>` : ""}
      ${badge ? `<span class="tab-badge">${escapeHtml(badge)}</span>` : ""}
      ${icon ? `<span class="tab-icon">${buildIcon(icon)}</span>` : ""}
      <span class="tab-label">${escapeHtml(panel.dataset.tab)}</span>
    </button>
  `;
}

// ─── WIDGET ──────────────────────────────────────────────────────────────────

/**
 * One of a group's panels at a time, while `query` matches.
 *
 * @param group the element holding the panels, each carrying `data-tab="<label>"`.
 * @param query a media query string. The tabs exist only while it matches, and the group is
 *              put back as written when it stops.
 *
 * @returns { destroy }, which takes the tabs off and stops listening.
 */
function createTabs({ group, query }) {
  const panels = [...group.querySelectorAll(`[${PANEL}]`)];

  if (panels.length < 2) return { destroy() {} };

  const name = group.getAttribute(GROUP) || "tabs";
  const strip = document.createElement("div");

  strip.className = "tab-strip";
  strip.setAttribute("role", "tablist");

  let at = 0;

  // ─── RENDERING ─────────────────────────────────────────────────────────────

  // Refreshed: a tab may carry a glyph, and the strip is written after the page drew its own.
  function renderStrip() {
    renderHtml(
      strip,
      panels
        .map((panel, index) => buildTab({ panel, index, selected: index === at, name }))
        .join(""),
      { refresh: true },
    );
  }

  function show(index) {
    at = index;

    for (const [i, panel] of panels.entries()) {
      panel.hidden = i !== index;
    }

    for (const [i, button] of [...strip.children].entries()) {
      button.setAttribute("aria-selected", String(i === index));
      button.tabIndex = i === index ? 0 : -1;
    }
  }

  // Each panel needs an id for its button to name, and its own role while it is a panel.
  function markPanels(on) {
    for (const [index, panel] of panels.entries()) {
      if (on) {
        panel.id ||= `${name}-panel-${index}`;
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", `${name}-tab-${index}`);
        continue;
      }

      panel.removeAttribute("role");
      panel.removeAttribute("aria-labelledby");
      panel.hidden = false;
    }
  }

  function apply(on) {
    markPanels(on);

    if (!on) {
      strip.remove();
      return;
    }

    group.before(strip);
    at = Math.min(at, panels.length - 1);
    renderStrip();
    show(at);
  }

  // ─── EVENTS ────────────────────────────────────────────────────────────────

  strip.addEventListener("click", (event) => {
    const button = event.target.closest("button");

    if (button) show([...strip.children].indexOf(button));
  });

  // The arrow keys are how a tablist is walked; Tab leaves it, which is what the `tabindex`
  // on the others is for.
  strip.addEventListener("keydown", (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];

    if (!step) return;

    event.preventDefault();

    const next = (at + step + panels.length) % panels.length;

    show(next);
    strip.children[next].focus();
  });

  const media = matchMedia(query);
  const onChange = (event) => apply(event.matches);

  media.addEventListener("change", onChange);
  apply(media.matches);

  // ─── LIFECYCLE ─────────────────────────────────────────────────────────────

  function destroy() {
    media.removeEventListener("change", onChange);
    apply(false);
  }

  return { destroy };
}

/**
 * Every tab group a page declares.
 *
 * @param query the width below which each group becomes tabs.
 *
 * @returns the handles, for a caller that tears its page down.
 */
function attachTabGroups(query) {
  return [...document.querySelectorAll(`[${GROUP}]`)].map((group) => createTabs({ group, query }));
}

export { attachTabGroups, createTabs };

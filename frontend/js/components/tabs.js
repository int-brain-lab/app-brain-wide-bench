// One thing at a time, chosen by name: a strip of tabs over the sections they show.
//
// The sections are the panels. A tab's value is the id of the section it opens, so the strip
// and the panels cannot drift apart, and hiding all but one is the same `hidden` a caller
// already sets by hand — nothing here holds a panel or its contents.
//
// No state of its own, like the controls in components/filters.js: which tab is lit is set by
// `markTabs` from whatever the caller holds. Same three calls as those — build it, mark it,
// read a press off an event — because a caller wiring one should not have to learn a second
// shape.

import { escapeHtml } from "../core/html.js";

// The strip's name, on every tab in it.
const TAB = "tab";

/**
 * The strip, all unlit — call markTabs to light one.
 *
 * @param name what a listener finds them by, on every tab in the strip.
 * @param tabs [{ value, label, control }] in the order they read. `value` is the id of the
 *             section the tab opens. `control` is markup put beside that tab — for something
 *             the reader does *to* the panel rather than to reach it, like sending it out of
 *             the rotation to sit under another. Beside and not inside, because a button
 *             cannot hold a button.
 * @returns the markup.
 */
function buildTabs({ name, tabs }) {
  return `
    <div class="tabs" role="tablist">
      ${tabs
        .map(
          ({ value, label, control = "" }) => `
        <span class="tab-slot">
          <button
            type="button"
            class="tab"
            role="tab"
            data-${TAB}="${escapeHtml(name)}"
            value="${escapeHtml(value)}"
            aria-selected="false"
          >${escapeHtml(label)}</button>
          ${control}
        </span>`,
        )
        .join("")}
    </div>`;
}

/**
 * Light the open tab, and shut the ones with nothing behind them.
 *
 * @param selected the value of the open panel.
 * @param canOpen  (value) => whether that panel has anything to show. A tab it says no to is
 *                 disabled rather than dropped: the strip keeps its shape as a comparison
 *                 fills up, so a reader is not offered a moving row of tabs.
 */
function markTabs(root, name, selected, canOpen = () => true) {
  for (const tab of root.querySelectorAll(`[data-${TAB}="${name}"]`)) {
    const open = tab.value === selected;

    tab.classList.toggle("on", open);
    tab.disabled = !canOpen(tab.value);
    tab.setAttribute("aria-selected", String(open));
  }
}

/**
 * Which tab was just pressed.
 *
 * @returns { name, value }, or null for a click that wasn't a tab's — which is most of them,
 *          since the strip and its panels are usually under one listener.
 */
function tabFromEvent(event) {
  const tab = event.target?.closest?.(`[data-${TAB}]`);

  if (!tab) return null;

  return { name: tab.dataset[TAB], value: tab.value };
}

export { buildTabs, markTabs, tabFromEvent };

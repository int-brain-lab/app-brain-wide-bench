// Tab strip for switching between sections, with optional pinning of sections below the active
// section.
//
// A tab's value is the id of the section it controls. The dock owns only the navigation state:
// which section is selected and which sections are pinned. Section contents remain the host's
// responsibility and are supplied through onChange.

import { resolveContainer } from "../core/dom.js";
import { escapeHtml } from "../core/html.js";
import { getElement, refreshIcons } from "../core/render.js";
import { buildButton, setButtonLabel } from "./buttons.js";
import { getIcon } from "./icons.js";
import { getSection } from "./sections.js";

const TAB_DATA = "tab";

// ─── TABS ─────────────────────────────────────────────────────────────────────

/**
 * Build a tab strip.
 *
 * @param {string} name - Unique name used to identify this tab group.
 * @param {Array<{value: string, label: string, control?: string}>} tabs
 * @returns {string} Tab strip markup.
 */
function buildTabHtml({ noun, tabs }) {
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
            data-tab-${noun}="${escapeHtml(value)}"
            value="${escapeHtml(value)}"
            aria-selected="false"
          >${escapeHtml(label)}</button>
          ${control}
        </span>`,
        )
        .join("")}
    </div>`;
}


// ─── TAB DOCK ────────────────────────────────────────────────────────────────

/**
 * Manage a set of sections controlled by tabs.
 *
 * The first tab is the base section. All other sections can be pinned below the active section.
 *
 * @param {string} name - Unique name for this tab group.
 * @param {Array<{value: string, label: string}>} tabs
 * @param {Element|string} container
 * @param {(value: string) => boolean} hasContent
 * @param {(visibleTabs: Set<string>) => void} onChange
 */
function createTabDock({ noun, tabs, container, hasContent, onChange }) {
  const root = resolveContainer(container);

  const baseTab = tabs[0]?.value;
  const pinnableTabs = tabs.filter((tab) => tab.value !== baseTab);

  let selectedTab = baseTab;
  const pinnedTabs = new Set();

  function getPinButtonId(value) {
    return `${noun}-pin-${value}`;
  }

  // The section a tab controls, or the element by that id where the tab stands for more than
  // one section and the host wrapped them.
  function getPanel(value) {
    return getSection(value) ?? getElement(value);
  }

  // ─── STATE ─────────────────────────────────────────────────────────────────

  function isPinned(tab) {
    return tab !== baseTab && pinnedTabs.has(tab) && hasContent(baseTab);
  }

  function getPinnedTabs() {
    return tabs.map(({ value }) => value).filter(isPinned);
  }

  function canSelect(tab) {
    return !isPinned(tab) && hasContent(tab);
  }

  // Keep the user's selection when possible. If it is unavailable, select the first
  // section that currently has content.
  function getActiveTab() {
    if (canSelect(selectedTab)) return selectedTab;

    return tabs.map(({ value }) => value).find(canSelect) ?? "";
  }

  function getVisibleTabs() {
    return new Set([getActiveTab(), ...getPinnedTabs()].filter(Boolean));
  }

  // ─── RENDER ────────────────────────────────────────────────────────────────

  function updatePanelVisibility() {
    const activeTab = getActiveTab();

    for (const { value } of tabs) {
      const section = getPanel(value);

      if (!section) continue;

      section.hidden = !isPinned(value) && value !== activeTab;
    }

    updateTabState(activeTab);
  }

  // Lit for the section on screen rather than for the one last pressed: a selection that
  // cannot be shown — its section pinned, or nothing in it yet — falls back to another.
  function updateTabState(activeTab) {
    for (const tab of root.querySelectorAll(`[data-tab-${noun}]`)) {
      const selected = tab.value === activeTab;

      tab.classList.toggle("on", selected);
      tab.disabled = !canSelect(tab.value);
      tab.setAttribute("aria-selected", String(selected));
    }
  }


  function orderSections() {
    const activeTab = getActiveTab();
    const pinned = getPinnedTabs();

    const visibleOrder = [activeTab, ...pinned];

    const remaining = tabs
      .map(({ value }) => value)
      .filter((value) => !visibleOrder.includes(value));

    let previousSection = null;

    for (const value of [...visibleOrder, ...remaining]) {
      const section = getPanel(value);

      if (!section) continue;

      if (previousSection) {
        previousSection.after(section);
      }

      previousSection = section;
    }
  }

  function updatePinButtons() {
    for (const { value, label } of pinnableTabs) {
      const pinned = isPinned(value);
      const button = getElement(getPinButtonId(value));

      setButtonLabel(button, {
        label: `${pinned ? "Unpin" : "Pin"} ${label.toLowerCase()}`,
        icon: getIcon(pinned ? "up" : "down"),
      });

      button?.classList.toggle("primary-inv", pinned);
    }

    refreshIcons();
  }

  function render() {
    updatePanelVisibility();
    orderSections();
    updatePinButtons();
  }

  function update() {
    render();
    onChange?.(getVisibleTabs());
  }

  // ─── MARKUP ────────────────────────────────────────────────────────────────

  function buildTabs() {
    return buildTabHtml({
      noun,
      tabs: tabs.map((tab) => ({
        ...tab,
        control:
          tab.value === baseTab
            ? ""
            : buildButton({
                id: getPinButtonId(tab.value),
                label: `Pin ${tab.label.toLowerCase()}`,
                icon: getIcon("down"),
                className: "tab-control",
              }),
      })),
    });
  }

  // ─── EVENTS ────────────────────────────────────────────────────────────────

  function attachTabEvents() {
    root.addEventListener("click", (event) => {

      const tab = event.target?.closest?.(`[data-tab-${noun}]`);


      if (!tab || tab.value === getActiveTab()) {
        return;
      }

      selectedTab = tab.value;
      update();
    });

    for (const { value } of pinnableTabs) {
      getElement(getPinButtonId(value))?.addEventListener("click", () => {
        if (pinnedTabs.has(value)) {
          pinnedTabs.delete(value);
        } else {
          pinnedTabs.add(value);
        }

        update();
      });
    }

    render();
  }

  return {
    buildTabs,
    attachTabEvents,
    render,
    getVisibleTabs,
  };
}

export {
  createTabDock,
};


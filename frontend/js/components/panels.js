// Several panels in one place, one shown at a time.
//
// A panel is a section, or any element the host wrapped several of them in. This owns only
// which one is shown; what is in them is the host's, and so is the control that switches them.

import { getElement } from "../core/render.js";
import { getSection } from "./sections.js";

/**
 * The panels a host switches between.
 *
 * @param panels     the panel ids, in the order they read. The first is what is shown until
 *                   something else is chosen.
 * @param hasContent (id) => whether that panel has anything to show.
 * @param isVisible  (id) => whether it can be reached at all. Omit for always.
 *
 * @returns { active, render, select }. `render()` after anything that changes what a panel
 *          holds; `select(id)` for a control that says where to go, and `active()` for one
 *          that says where it would go next.
 */
function createPanels({ panels, hasContent, isVisible = () => true }) {
  let selected = panels[0];

  // A section, or the element by that id where a panel is more than one section and the host
  // wrapped them.
  function getPanel(id) {
    return getSection(id) ?? getElement(id);
  }

  function canShow(id) {
    return isVisible(id) && hasContent(id);
  }

  // The reader's choice while it can be shown, and the first that can otherwise.
  function getActive() {
    if (canShow(selected)) return selected;

    return panels.find(canShow) ?? "";
  }

  function render() {
    const active = getActive();

    for (const id of panels) {
      const panel = getPanel(id);

      if (panel) panel.hidden = id !== active;
    }
  }

  // Nothing here is drawn, so every choice comes from the host's own control.
  function select(id) {
    if (!canShow(id)) return;

    selected = id;
    render();
  }

  return { active: getActive, render, select };
}

export { createPanels };

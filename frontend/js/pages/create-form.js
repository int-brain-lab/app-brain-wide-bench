// A create form: locked panels, a submit button that arms itself, and the submit lifecycle.
//
// The page's markup needs a `#gate` card and a `#container`, same as every other page;
// everything below is rendered.
//
// Two phases, and the split is load-bearing. `mount()` builds every fieldset once — that's
// when a panel's own content appears and when the components inside it can be constructed.
// `render()` refills only the schema-driven panels, so a re-render can never destroy
// listeners a component attached to markup it built.

import {
  attachFieldEvents,
  createFieldState,
  panelGroups,
  renderFields,
  renderGroups,
} from "../utils/form-fields.js";
import { showError, showMessage } from "../utils.js";
import {
  buildExitLink,
  buildFormFooter,
  buildHeader,
  buildMessage,
  buildPage,
  pageMessage,
  renderHeader,
  renderPage,
  submitButton,
} from "./record-page.js";

const PANELS_ID = "panels";

function hasDependentFields(fields) {
  return Object.values(fields).some(
    field => field.disabledWhen || field.disabledOptionsWhen,
  );
}

// Empty strings, null and empty arrays are unset. `false` and `0` are valid values.
function isFilled(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;

  return true;
}

/**
 * @param panels        [{ panel, required: [key], build }] — one entry per fieldset, in
 *                      order. `build` returns the panel's markup and marks it as the page's
 *                      own: it is built once and never re-rendered. A panel without it is
 *                      filled from `schemaPanels`.
 * @param schemaPanels  XXX_PANELS, for the layout of the schema-driven panels.
 * @param alsoRequires  optional () => boolean, ANDed with panel completeness to enable
 *                      submit — for a control the schema doesn't know about.
 * @param onChange      optional async (key, value, cleared) => void, run before the form
 *                      re-renders, for a field whose change has to fetch something.
 * @param submit        async (state) => destination URL. Returning a URL navigates;
 *                      returning nothing leaves the page up, for a partial success only the
 *                      page can describe. Errors are caught, reported and the form re-armed.
 */
function createPanelForm({
  title,
  description = "",
  backTo,
  panels,
  schemaPanels,
  fields,
  cancelHref,
  submitLabel,
  submitIcon = "plus",
  submitError,
  alsoRequires,
  onChange,
  submit,
}) {
  const byNumber = new Map(panels.map(panel => [panel.panel, panel]));
  const state = createFieldState(fields);

  // A property of the schema, not of any one change: with no field depending on another,
  // nothing can be cleared and no re-render can change what is disabled. Currently false
  // for all three create schemas, so the re-render below never runs — kept because the next
  // schema to grow a `disabledWhen` needs it, and a stale disabled state would be silent.
  const dependent = hasDependentFields(fields);

  // The panels this form fills. A panel with its own `build` is excluded: refilling it would
  // replace the very elements its components are listening to.
  const filled = schemaPanels.filter(panel => !byNumber.get(panel.panel)?.build);

  function panelsContainer() {
    return document.getElementById(PANELS_ID);
  }

  function getPanel(panelNumber) {
    return panelsContainer().querySelector(`[data-panel="${panelNumber}"]`);
  }

  function isPanelComplete(panelNumber) {
    return (byNumber.get(panelNumber)?.required ?? []).every(key => isFilled(state[key]));
  }

  // A panel opens only when every preceding panel is complete, so clearing a value in an
  // earlier panel also closes everything below it.
  function isPanelOpen(panelNumber) {
    return panels
      .filter(panel => panel.panel < panelNumber)
      .every(panel => isPanelComplete(panel.panel));
  }

  function buildGroups(panel) {
    return panelGroups(fields, [panel], { editableOnly: true, columns: 1 });
  }

  function mount() {
    renderPage(
      buildPage({
        header: buildHeader(),
        body: `
          ${backTo ? buildExitLink(backTo) : ""}
          <div class="column gap-lg">
            <div class="column gap-lg" id="${PANELS_ID}"></div>
            ${buildMessage()}
            ${buildFormFooter({ cancelHref, submitLabel, submitIcon })}
          </div>
        `,
      }),
    );

    renderHeader(title, description);

    panelsContainer().innerHTML = panels
      .map(panel => `
        <fieldset class="form-panel" data-panel="${panel.panel}">
          ${panel.build?.() ?? ""}
        </fieldset>
      `)
      .join("");

    globalThis.lucide?.createIcons?.();
  }

  function render() {
    for (const panel of filled) {
      const element = getPanel(panel.panel);

      if (!element) continue;

      element.innerHTML = renderGroups(buildGroups(panel), state, fields, renderFields);
    }

    globalThis.lucide?.createIcons?.();
  }

  function applyLocks() {
    for (const panel of panels) {
      const element = getPanel(panel.panel);

      if (element) element.disabled = !isPanelOpen(panel.panel);
    }
  }

  function refresh() {
    applyLocks();

    const complete = panels.every(panel => isPanelComplete(panel.panel));

    submitButton().disabled = !(complete && (alsoRequires?.() ?? true));
  }

  function handleFieldChange(cleared) {
    if (cleared.length) {
      const labels = cleared.map(key => fields[key].label).join(", ");

      showError(pageMessage(), `Cleared (no longer valid): ${labels}`);
    }

    if (cleared.length || dependent) render();

    refresh();
  }

  async function handleSubmit() {
    submitButton().disabled = true;
    showMessage(pageMessage(), "");

    try {
      const destination = await submit(state);

      if (destination) {
        window.location.href = destination;
        return;
      }

      // No destination: the page reported something it needs to stay put for. Re-arm from
      // the current state rather than blindly re-enabling.
      refresh();
    } catch (error) {
      console.error(error);

      showError(pageMessage(), submitError ? `${submitError}: ${error.message}` : error.message);
      refresh();
    }
  }

  // Bound per filled panel rather than to the container: those fieldsets survive every
  // render, and binding this narrowly keeps the listener off the panels a component owns.
  function attach() {
    for (const panel of filled) {
      const element = getPanel(panel.panel);

      if (!element) continue;

      attachFieldEvents(element, state, fields, async (key, value, cleared) => {
        await onChange?.(key, value, cleared);

        handleFieldChange(cleared);
      });
    }

    if (submit) submitButton().addEventListener("click", handleSubmit);
  }

  return { mount, render, refresh, attach, state };
}


export { createPanelForm };

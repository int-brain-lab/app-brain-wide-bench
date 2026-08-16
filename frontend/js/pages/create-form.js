// Template for a create form
//
// The page markup needs a `#gate` card and a `#container`, same as every other page;
// everything below is rendered.
//
// The form contains fields that are grouped into panels. Subsequent panels are locked until
// all required fields in the previous panel are filled.
//
// Panels can be schema-driven or component-driven. Schema-driven panels are built from the
// field definitions and while component-driven panels are built using the build function
// supplied in the panel definition.
//
// Component-driven panels are never re-rendered after the initial mount, so they can maintain
// their own state and event listeners.

// Schema-driven panels are re-rendered when hasDependentFields is true. These dependencies
// are defined in the disabledWhen or disabledOptionsWhen keys of the schema.
// When a field changes, the form re-renders all schema-driven panels to update the state of dependent fields.
//
// The form is created in two phases. `initialise()` builds every fieldset once, including panels
// owned by components. `render()` only updates schema-driven panels, so component
// listeners are never destroyed by a form re-render.
//
// The page builds its components between the two, so the lifecycle is:
//
//   initialise()  → build the fieldsets and fill the schema-driven ones
//   …             → construct the components that own the remaining panels
//   attach()      → bind the listeners, then refresh for the first time

import {
  attachFieldEvents,
  createFieldState,
  panelGroups,
  renderFields,
  renderGroups,
} from "../components/form-fields.js";
import { showError, showMessage, refreshIcons } from "../utils.js";
import {
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

// Empty strings, null and empty arrays are unset.
// `false` and `0` are valid values.
function isFilled(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;

  return true;
}


/**
 * @param noun          The object being created, e.g "model" or "team". Used to label messages and buttons.
 *
 * @param header        { title, description }, for the page header. Optional; if not supplied
 *                      a default header will be built using the noun.
 *
 * @param backTo        { href, text }, for the back link in the header. href is also used for
 *                      the cancel button in the footer.
 *
 * @param panels        [{ panel, required, complete, build, title }] — one entry per panel.
 *                      The order in the list defines the order on the page.
 *                      `panel` is a number, `required` is an array of field keys that must
 *                      be filled for the panel to be considered complete, `title` is an
 *                      optional string to display above the panel, and `build` is an optional
 *                      function that returns HTML to insert into the panel.
 *
 *                      `complete` is an optional () => boolean, ANDed with the required keys.
 *                      It is how a component-driven panel reports completeness the schema
 *                      can't see — and because the panels below it stay locked until it
 *                      passes, it is also how a panel refuses to let the user move on.
 *
 * @param fields        The field definitions, defined in the schema. The form uses these
 *                      to build schema-driven panels and to determine which fields are required for each panel.
 *
 * @param submit        async (state) => destination URL. The function to call to submit the form.
 *                      It should return a URL to navigate to on success, or null to stay on the page.
 *
 * @param onChange      async (key, value, cleared) => void. Called when a field changes. Optional.
 *                     `key` is the field key, `value` is the new value, and `cleared` is an array of
 *                     field keys that were cleared as a result of the change. This is useful for re-rendering
 *                     dependent fields.
 */
function createPanelForm({
  noun,
  header,
  backTo,
  panels,
  fields,
  submit,
  onChange,
}) {

  const state = createFieldState(fields);
  const hasDependencies = hasDependentFields(fields);

  const panelsByNumber = new Map(
    panels.map(panel => [panel.panel, panel]),
  );

  // Panels with their own build function are owned by components and must not
  // be re-rendered after mount.
  const renderedPanels = panels.filter(panel => !panel.build);

  let panelElements = new Map();

  function getPanel(panelNumber) {
    return panelElements.get(panelNumber);
  }

  function isPanelComplete(panelNumber) {
    const panel = panelsByNumber.get(panelNumber);

    return (panel?.required ?? []).every(key => isFilled(state[key]))
      && (panel?.complete?.() ?? true);
  }

  // A panel opens when every preceding panel is complete.
  function isPanelOpen(panelNumber) {
    return panels
      .filter(panel => panel.panel < panelNumber)
      .every(panel => isPanelComplete(panel.panel));
  }

  function buildGroups(panel) {
    return panelGroups(
      fields,
      [panel],
      {
        editableOnly: true,
        columns: 1,
      },
    );
  }

  function initialise() {
    renderPage(
      buildPage({
        back: backTo,
        header: buildHeader(),
        body: `
          <div class="column gap-lg">
            <div class="column gap-lg" id="${PANELS_ID}"></div>
            ${buildMessage()}
            ${buildFormFooter({
              cancelHref: backTo.href ?? "",
              submitLabel: `Create ${noun}`
            })}
          </div>
        `,
      }),
    );

    renderHeader(header ? header.title : `Create new ${noun}`, header ? header.description : "");

    const container = document.getElementById(PANELS_ID);

    container.innerHTML = panels
      .map(
        ({ panel, build }) => `
          <fieldset class="form-panel" data-panel="${panel}">
            ${build?.() ?? ""}
          </fieldset>
        `,
      )
      .join("");

    // Store the panels so they can be easily accessed without querying the DOM each time.
    panelElements = new Map(
      [...container.querySelectorAll("[data-panel]")].map(element => [
        Number(element.dataset.panel),
        element,
      ]),
    );

    render();
  }

  function render() {
    for (const panel of renderedPanels) {
      const element = getPanel(panel.panel);

      if (!element) continue;

      element.innerHTML = renderGroups(
        buildGroups(panel),
        state,
        fields,
        renderFields,
      );
    }

    refreshIcons();
  }

  function applyLocks() {
    for (const panel of panels) {
      const element = getPanel(panel.panel);

      if (element) {
        element.disabled = !isPanelOpen(panel.panel);
      }
    }
  }

  function isComplete() {
    return panels.every(panel =>
      isPanelComplete(panel.panel),
    );
  }

  function canSubmit() {
    return isComplete();
  }

  function refresh() {
    applyLocks();
    submitButton().disabled = !canSubmit();
  }

  function handleFieldChange(cleared) {
    if (cleared.length) {
      const labels = cleared
        .map(key => fields[key].label)
        .join(", ");

      showError(
        pageMessage(),
        `Cleared (no longer valid): ${labels}`,
      );
    } else {
      // Clear stale messages from a previous change
      showMessage(pageMessage(), "");
    }

    if (cleared.length || hasDependencies) {
      render();
    }

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

      refresh();
    } catch (error) {
      console.error(error);

      const message = `Failed to create new ${noun}: ${error.message}`;

      showError(pageMessage(), message);
      refresh();
    }
  }

  function attach() {
    for (const panel of renderedPanels) {
      const element = getPanel(panel.panel);

      if (!element) continue;

      attachFieldEvents(
        element,
        state,
        fields,
        async (key, value, cleared) => {
          await onChange?.(key, value, cleared);
          handleFieldChange(cleared);
        },
      );
    }

    if (submit) {
      submitButton().addEventListener(
        "click",
        handleSubmit,
      );
    }

    // Last, not in `initialise`: a panel's `complete` may ask a component the page builds
    // between the two calls, and until this runs nothing has questioned it.
    refresh();
  }

  return {
    initialise,
    render,
    refresh,
    attach,
    state,
  };
}

export { createPanelForm };
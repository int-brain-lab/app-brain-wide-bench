// A form whose fields are grouped into panels, where each panel is locked until the one
// above it is complete.
//
// It knows one element, the container it is given: no page, no buttons, no messages. What a
// change invalidated comes back through `onCleared` and completeness through `onRefresh`,
// for the owner to show however its page is built (see create-page.js).
//
// A panel is either schema-driven, built from the field definitions, or component-driven,
// built by the `build` function in its definition. Component-driven panels are never
// re-rendered after mount, so they can keep their own state and listeners. The rest go to
// one createFieldForm as its sections, so a change in any panel redraws all of them — a
// `disabledWhen` can name a value set in an earlier panel.
//
// Hence two phases, with the page building its components in between:
//
//   initialise()  → build the fieldsets and fill the schema-driven ones
//   …             → construct the components that own the remaining panels
//   attach()      → bind the listeners, then refresh for the first time

import { createFieldState, panelGroups } from "../schemas/schema.js";
import { buildFields, buildGroupCards } from "./fields.js";
import { createFieldForm } from "./form.js";

// Empty strings, null and empty arrays are unset.
// `false` and `0` are valid values.
function isFilled(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;

  return true;
}


/**
 * @param container     Element — the fieldsets are rendered into it. The only part of the
 *                      document this form knows about.
 *
 * @param panels        [{ panel, complete, build, title }], in page order. `build` returns
 *                      markup for a component-driven panel.
 *
 *                      `complete` is an optional () => boolean, ANDed with the panel's
 *                      required fields. It is how a component-driven panel reports what the
 *                      schema can't see — a file chosen, tasks confirmed — and since the
 *                      panels below stay locked until it passes, how it refuses to let the
 *                      user move on.
 *
 * @param fields        the schema. A panel's required fields are read from it: the ones
 *                      marked `required` and declared in that panel.
 *
 * @param onChange      optional async (key, value, cleared) => void, on every field change.
 *
 * @param onCleared     optional (labels: string) => void, when a change invalidated other
 *                      fields. The labels are joined ready to show; where they are shown is
 *                      the owner's business.
 *
 * @param onRefresh     optional (complete: boolean) => void, after every re-evaluation of
 *                      the panel locks — on a field change, on `refresh()`, and once when
 *                      `attach()` runs. How the owner keeps its submit button in step.
 */
function createPanelForm({
  container,
  panels,
  fields,
  onChange,
  onCleared,
  onRefresh,
}) {

  const state = createFieldState(fields);

  const panelsByNumber = new Map(
    panels.map(panel => [panel.panel, panel]),
  );

  // A panel with its own build function is a component's, and must not be re-rendered.
  const renderedPanels = panels.filter(panel => !panel.build);

  let panelElements = new Map();

  // Built in `initialise`, once the fieldsets its sections render into exist.
  let panelForm = null;

  function getPanel(panelNumber) {
    return panelElements.get(panelNumber);
  }

  // From the schema, not from the panel: `required` is a property of the field, and the
  // asterisk beside it and the lock below it have to be the same fact. What the schema
  // can't know — a file, a set of confirmed tasks — is the panel's own `complete`.
  function requiredKeys(panelNumber) {
    return Object.entries(fields)
      .filter(([, field]) => field.required && field.panel === panelNumber)
      .map(([key]) => key);
  }

  function isPanelComplete(panelNumber) {
    const panel = panelsByNumber.get(panelNumber);

    return requiredKeys(panelNumber).every(key => isFilled(state[key]))
      && (panel?.complete?.() ?? true);
  }

  // A panel opens when every preceding panel is complete.
  function isPanelOpen(panelNumber) {
    return panels
      .filter(panel => panel.panel < panelNumber)
      .every(panel => isPanelComplete(panel.panel));
  }

  // Group descriptors, not markup — hence not a `build*` name, which here means HTML.
  function groupsFor(panel) {
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
    container.innerHTML = panels
      .map(
        ({ panel, build }) => `
          <fieldset class="form-panel" data-panel="${panel}">
            ${build?.() ?? ""}
          </fieldset>
        `,
      )
      .join("");

    // Held so later lookups don't go back to the DOM.
    panelElements = new Map(
      [...container.querySelectorAll("[data-panel]")].map(element => [
        Number(element.dataset.panel),
        element,
      ]),
    );

    panelForm = createFieldForm({
      fields,
      getState: () => state,

      sections: renderedPanels
        .filter(panel => getPanel(panel.panel))
        .map(panel => ({
          container: getPanel(panel.panel),
          draw: values => buildGroupCards(
            groupsFor(panel),
            values,
            fields,
            buildFields,
          ),
        })),

      onChange: async (key, value, cleared) => {
        await onChange?.(key, value, cleared);
        handleFieldChange(cleared);
      },
    });

    render();
  }

  function render() {
    panelForm.render();
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

  function refresh() {
    applyLocks();

    onRefresh?.(isComplete());
  }

  // The panels have already been redrawn if the schema needed it, so all this owes the
  // change is the locks and the labels of whatever it invalidated. `onCleared` is called
  // with an empty string when nothing was cleared, which is how the owner knows to drop a
  // message left from an earlier change.
  function handleFieldChange(cleared) {
    onCleared?.(
      cleared
        .map(key => fields[key].label)
        .join(", "),
    );

    refresh();
  }

  function attach() {
    panelForm.attach();

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

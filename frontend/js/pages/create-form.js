// A form whose fields are grouped into panels, where each panel is locked until the one
// above it is complete.
//
// Knows one element: the container it is given. It renders no page, owns no buttons and
// writes no messages — a change worth reporting is handed back through `onCleared`, and
// completeness through `onRefresh`, for the owner to show however its page is built. The
// submit button, the message region and the navigation on success all belong to whatever
// put this on a page (see create-page.js). Same arrangement as editor.js, which is handed
// its container and its buttons for the same reason.
//
// Panels can be schema-driven or component-driven. Schema-driven panels are built from the
// field definitions, while component-driven panels are built using the build function
// supplied in the panel definition.
//
// Component-driven panels are never re-rendered after the initial mount, so they can maintain
// their own state and event listeners.
//
// The schema-driven panels are handed to one createFieldForm as its sections, so a change
// in any of them re-renders all of them: a field's disabledWhen or disabledOptionsWhen can
// name a value set in an earlier panel, and a dependent field only picks that up on a
// redraw. A schema with no such rules is never redrawn at all — see form.js.
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

import { createFieldState } from "../fields/state.js";
import { renderFields } from "../fields/render.js";
import { panelGroups, renderGroups } from "../fields/groups.js";
import { createFieldForm } from "../fields/form.js";

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
 * @param onChange      async (key, value, cleared) => void. Called when a field changes. Optional.
 *                     `key` is the field key, `value` is the new value, and `cleared` is an array of
 *                     field keys that were cleared as a result of the change. This is useful for re-rendering
 *                     dependent fields.
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

  // Panels with their own build function are owned by components and must not
  // be re-rendered after mount.
  const renderedPanels = panels.filter(panel => !panel.build);

  let panelElements = new Map();

  // Built in `initialise`, once the fieldsets its sections render into exist.
  let panelForm = null;

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

    panelForm = createFieldForm({
      fields,
      getState: () => state,

      sections: renderedPanels
        .filter(panel => getPanel(panel.panel))
        .map(panel => ({
          container: getPanel(panel.panel),
          draw: values => renderGroups(
            buildGroups(panel),
            values,
            fields,
            renderFields,
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

  // The panels have already been redrawn by the time this runs, if the schema needed it —
  // all this owes the change is the locks, and the labels of anything the change
  // invalidated. The locks are unconditional: `required` decides those, not the schema's
  // rules. `onCleared` is called with nothing to say when nothing was cleared, which is how
  // the owner knows it can drop a message left over from an earlier change.
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

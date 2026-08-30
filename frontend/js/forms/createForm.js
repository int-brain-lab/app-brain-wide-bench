// A form whose fields are grouped into panels, where each panel is locked until all
// preceding panels are complete.
//
// The form only owns the supplied container. It does not know about the page, buttons,
// or messages. Changes and completeness are reported through callbacks.
//
// Field-driven panels are rendered by one createFieldForm. Component-driven panels
// provide their own markup through `build()` and are not re-rendered after mounting,
// allowing them to keep their own state and listeners.

import { toPanelGroup } from "../schemas/schemaPanels.js";
import { buildFields, buildPanelCard } from "./fields.js";
import { clearedLabels, createFieldForm, createFieldState } from "./form.js";
import { escapeHtml } from "../core/html.js";
import { renderHtml } from "../core/render.js";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

// Empty strings, null and empty arrays are unset.
// `false` and `0` are valid values.
function isFilled(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;

  return true;
}

// ─── PANEL FORM ──────────────────────────────────────────────────────────────

/**
 * A form in panels, each locked until the ones before it are complete.
 *
 * @param container   element that receives the panel fieldsets.
 * @param panels      panel definitions in display order, keyed by panel name. A field joins
 *                    the panel it names as `field.panel`. Every panel declares a `type` —
 *                    "fields" or "component" — and a `title`. A "fields" panel is filled
 *                    from the schema and is complete when its required fields are; a
 *                    "component" panel declares `build()` for markup drawn once and never
 *                    redrawn, and `complete()`, which only it can answer.
 * @param fields      field definitions, keyed by field name — the schema the "fields"
 *                    panels are built from.
 * @param submit      async (state) => result. Run by `submit()`, with the form locked until
 *                    it settles.
 * @param onChange    async (key, value, cleared) => void, after a field changes. Omit for
 *                    no per-change hook.
 * @param onCleared   (labels) => void, when a change invalidates other fields. Omit for no
 *                    notice.
 * @param onRefresh   (complete) => void, whenever completeness is recalculated. Omit for a
 *                    form with nothing to enable.
 * @param onSubmitted async (result) => void, after `submit` resolves. Omit for none.
 * @param onError     (error) => void, when `submit` throws. Omit to fail silently.
 *
 * @returns `{ initialise, attach, submit, refresh, render, state }`. Call `initialise()`
 *          for the schema-driven panels, then `attach()` to wire listeners and refresh
 *          once; the caller wires `submit` to its own button.
 */
function createForm({
  container,
  panels,
  fields,

  submit,

  onChange,
  onCleared,
  onRefresh,
  onSubmitted,
  onError,
}) {
  const state = createFieldState(fields);

  // Object declaration order determines both display order and unlock order.
  const panelNames = Object.keys(panels);

  // Only schema-driven panels are managed by createFieldForm.
  const fieldPanelNames = panelNames.filter(
    (name) => panels[name].type === "fields",
  );

  // Required fields never change, so calculate them once. A component panel has none,
  // which is why it declares `complete()` instead.
  const requiredFields = new Map(
    panelNames.map((name) => [
      name,
      Object.entries(fields)
        .filter(([, field]) => field.required && field.panel === name)
        .map(([key]) => key),
    ]),
  );

  // Populated during initialise() so later lookups do not query the DOM.
  let panelElements = new Map();

  // Created during initialise().
  let form = null;

  // ─── PANEL STATE ───────────────────────────────────────────────────────────

  function isPanelComplete(name) {
    return (
      requiredFields.get(name).every((key) => isFilled(state[key])) &&
      (panels[name].complete?.() ?? true)
    );
  }

  // A panel opens when every preceding panel is complete, so one pass down the panels
  // carries the answer: `open` after the last one is every panel complete.
  function updatePanelState() {
    let open = true;

    for (const name of panelNames) {
      const element = panelElements.get(name);

      if (element) {
        element.disabled = !open;
      }

      open = open && isPanelComplete(name);
    }

    onRefresh?.(open);
  }

  // ─── SUBMITTING ────────────────────────────────────────────────────────────

  async function submitForm() {
    // Locked for the round trip, then recalculated: a second click while the first is in
    // flight would submit the same state twice.
    onRefresh?.(false);

    try {
      const result = await submit(state);

      await onSubmitted?.(result);
    } catch (error) {
      console.error(error);
      onError?.(error);
    } finally {
      updatePanelState();
    }
  }

  // ─── FIELD PANELS ──────────────────────────────────────────────────────────

  // The group for one panel, without its title — the fieldset carries that, so that every
  // panel wears it the same way.
  function groupForPanel(name) {
    const { title, ...layout } = panels[name];

    return toPanelGroup(fields, name, layout, {
      editableOnly: true,
      columns: 1,
    });
  }

  // The title is the fieldset's, so every panel wears it the same way. The body below it
  // is what a field panel redraws — drawing into the fieldset would take the title with it.
  function buildPanels() {
    return panelNames
      .map((name) => {
        const { title, build } = panels[name];

        return `
          <fieldset
            class="form-panel column gap-md"
            data-panel="${name}"
          >
            ${title ? `<p class="title muted">${escapeHtml(title)}</p>` : ""}
            <div data-panel-body>${build?.() ?? ""}</div>
          </fieldset>
        `;
      })
      .join("");
  }

  function getFieldSections() {
    return fieldPanelNames.map((name) => ({
      container: panelElements.get(name).querySelector("[data-panel-body]"),

      draw: (values) =>
        buildPanelCard(groupForPanel(name), values, fields, buildFields),
    }));
  }

  // ─── LIFECYCLE ─────────────────────────────────────────────────────────────

  function initialise() {
    renderHtml(container, buildPanels());

    // Cache the fieldsets so subsequent updates do not query the DOM.
    panelElements = new Map(
      [...container.querySelectorAll("[data-panel]")].map((element) => [
        element.dataset.panel,
        element,
      ]),
    );

    form = createFieldForm({
      fields,
      getState: () => state,

      sections: getFieldSections(),

      onChange: async (key, value, cleared) => {
        await onChange?.(key, value, cleared);

        onCleared?.(clearedLabels(fields, cleared));

        updatePanelState();
      },
    });

    form.render();
  }

  function attach() {
    form.attach();

    // Component-driven panels may only exist after initialise(), so the first
    // completeness check happens here.
    updatePanelState();
  }

  return {
    initialise,
    attach,
    submit: submitForm,
    refresh: updatePanelState,
    render: () => form.render(),
    state,
  };
}

export { createForm };

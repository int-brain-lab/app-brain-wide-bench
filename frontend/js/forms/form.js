// Field form: keeps field state, applies schema rules and wires the rendered
// `[data-field]` controls back to that state.
//
// `fields.js` owns the markup. This module owns the live behaviour:
//   control change → state update → validation → redraw
//
// State is supplied through `getState`, rather than directly. This lets an
// editor replace its draft while keeping the form's delegated event listener.
// Returning null means the form is currently inactive.

import { refreshIcons, renderHtml } from "../core/render.js";

// ─── SCHEMA RULES ────────────────────────────────────────────────────────────

const CLEARED_MESSAGE =
  "That change ruled out choices you had already made, so they have been cleared.";

function clearedLabels(fields, cleared) {
  return cleared.map((key) => fields[key].label).join(", ");
}

function isDisabled(field, state) {
  return typeof field.disabledWhen === "function" && field.disabledWhen(state);
}

// Disabled options remain visible but cannot be selected.
function disabledOptionValues(field, state) {
  return typeof field.disabledOptionsWhen === "function"
    ? field.disabledOptionsWhen(state)
    : [];
}

function hasDependentFields(fields) {
  return Object.values(fields).some(
    (field) => field.disabledWhen || field.disabledOptionsWhen,
  );
}

// ─── HELP TEXT ───────────────────────────────────────────────────────────────

// Help that the user has explicitly pinned open.
//
// Stored by field key rather than DOM element so the state survives a redraw.
const pinnedHelp = new Set();

function isHelpPinned(key) {
  return pinnedHelp.has(key);
}

function toggleHelpPin(key) {
  if (pinnedHelp.has(key)) {
    pinnedHelp.delete(key);
  } else {
    pinnedHelp.add(key);
  }

  return pinnedHelp.has(key);
}

// ─── VALUES ──────────────────────────────────────────────────────────────────

// The state a form starts from: the editable fields, taken from `source` where it has
// them and from each field's default where it doesn't. Arrays are copied, so editing a
// draft never reaches the record behind it.
function createFieldState(fields, source = {}) {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, field]) => field.editable !== false)
      .map(([key, field]) => {
        const value = source[key] ?? field.default ?? null;
        return [key, Array.isArray(value) ? [...value] : value];
      }),
  );
}

function parseFieldValue(field, value) {
  if (value === "") return null;

  switch (field.input) {
    case "number":
      return Number(value);

    default:
      return value;
  }
}

function getFieldValue(field, key, input, container) {
  switch (field.input) {
    case "checkbox-list":
      return Array.from(
        container.querySelectorAll(`[data-field="${key}"]:checked`),
      ).map((box) => box.value);

    case "checkbox":
      return input.checked;

    default:
      return parseFieldValue(field, input.value);
  }
}

// ─── VALIDATION ──────────────────────────────────────────────────────────────

function revalidateFields(state, fields) {
  const cleared = [];

  for (const [key, field] of Object.entries(fields)) {
    const value = state[key];

    if (value == null) continue;

    if (isDisabled(field, state)) {
      state[key] = null;
      cleared.push(key);
      continue;
    }

    if (typeof field.disabledOptionsWhen !== "function") {
      continue;
    }

    const disabledOptions = field.disabledOptionsWhen(state);

    if (Array.isArray(value)) {
      const validValues = value.filter(
        (item) => !disabledOptions.includes(item),
      );

      if (validValues.length !== value.length) {
        cleared.push(key);
      }

      state[key] = validValues;
      continue;
    }

    if (disabledOptions.includes(value)) {
      state[key] = null;
      cleared.push(key);
    }
  }

  return cleared;
}

// Update one field and immediately bring the rest of the state back into
// agreement with the schema.
function setFieldValue(state, fields, key, value) {
  state[key] = value;

  return revalidateFields(state, fields).filter(
    (clearedKey) => clearedKey !== key,
  );
}

// ─── RENDERING ───────────────────────────────────────────────────────────────

// Redraw a section while keeping the field that currently has focus.
//
// Dependent fields may be replaced by the redraw, so restoring focus prevents
// a select or checkbox change from unexpectedly moving focus to the page.
function renderPreservingFocus(container, render) {
  const active = document.activeElement;

  const fieldKey = container.contains(active)
    ? active.closest("[data-field]")?.dataset.field
    : null;

  render();

  if (!fieldKey) return;

  const field = container.querySelector(`[data-field="${fieldKey}"]`);

  if (!field) return;

  const control = field.matches("input, select, textarea")
    ? field
    : field.querySelector("input, select, textarea");

  control?.focus();
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────

// One delegated listener survives every redraw of the fields inside the
// container.
function attachFieldEvents(container, getState, fields, onChange) {
  container.addEventListener("change", (event) => {
    const state = getState();

    // The form may still be attached while an editor has no active draft.
    if (!state) return;

    const input = event.target.closest("[data-field]");
    if (!input) return;

    const key = input.dataset.field;
    const field = fields[key];

    // Ignore controls belonging to another schema nested inside this one.
    if (!field) return;

    const value = getFieldValue(field, key, input, container);

    const cleared = setFieldValue(state, fields, key, value);

    onChange?.(key, value, cleared);
  });

  container.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-help-for]");

    if (!trigger || !container.contains(trigger)) return;

    const key = trigger.dataset.helpFor;
    const pinned = toggleHelpPin(key);

    trigger.setAttribute("aria-expanded", String(pinned));

    const text = container.querySelector(`[data-help-text="${key}"]`);

    if (text) {
      text.hidden = !pinned;
    }
  });
}

// ─── FORM ────────────────────────────────────────────────────────────────────

/**
 * A live form over one or more field containers.
 *
 * @param fields   the field definitions. Schema rules such as `disabledWhen` and
 *                 `disabledOptionsWhen` are evaluated against the current state.
 * @param getState () => state | null. The object that receives changes; null makes the
 *                 form inactive without removing its listeners.
 * @param sections [{ container, draw }] — the containers whose fields share one state.
 *                 `draw(state)` returns the markup for that section.
 * @param onChange (key, value, cleared) => void, after the state has been updated,
 *                 revalidated and, where needed, redrawn. Omit for no per-change hook.
 *
 * @returns `{ attach, render }`.
 */
function createFieldForm({ fields, getState, sections, onChange }) {
  const hasDependencies = hasDependentFields(fields);

  function render() {
    const state = getState();

    if (!state) return;

    for (const { container, draw } of sections) {
      renderPreservingFocus(container, () => {
        renderHtml(container, draw(state));
      });
    }

    refreshIcons();
  }

  function handleFieldChange(key, value, cleared) {
    // A dependent field may have changed even when nothing was cleared, so
    // schemas with dependencies always get a redraw.
    if (hasDependencies || cleared.length) {
      render();
    }

    onChange?.(key, value, cleared);
  }

  function attach() {
    for (const { container } of sections) {
      attachFieldEvents(container, getState, fields, handleFieldChange);
    }
  }

  return {
    attach,
    render,
  };
}

export {
  CLEARED_MESSAGE,
  attachFieldEvents,
  clearedLabels,
  createFieldForm,
  createFieldState,
  disabledOptionValues,
  isDisabled,
  isHelpPinned,
  renderPreservingFocus,
  revalidateFields,
  setFieldValue,
};

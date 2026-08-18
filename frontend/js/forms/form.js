// A live form: the working copy of its values, the schema rules that keep that copy valid,
// and the `[data-field]` controls the two are wired to. fields.js turns a state and a
// schema into markup; this is where a change event becomes a state write, and a state write
// becomes new markup. The `disabledWhen` readers live here so revalidation and rendering
// answer the same question the same way.
//
// State arrives as `getState`, a thunk rather than the object: an editor's draft is thrown
// away and rebuilt on every Edit click while its listener is attached once, so a listener
// bound to an object would keep writing to a draft nobody is looking at. Returning null
// also says "not live", which is how an editor ignores changes between Save and Edit.

import { refreshIcons } from "../core/utils.js";


// ─── SCHEMA RULES ───────────────────────────────────────────────────────────

function isDisabled(field, state) {
  return typeof field.disabledWhen === "function" && field.disabledWhen(state);
}

// Disabled options stay in the list, unselectable rather than removed, so a user can see
// what exists instead of watching a choice disappear.
function disabledOptionValues(field, state) {
  return typeof field.disabledOptionsWhen === "function"
    ? field.disabledOptionsWhen(state)
    : [];
}

// A schema with no such rule draws the same fields for every state it can hold, which is
// what lets `handleChange` know a redraw would change nothing.
function hasDependentFields(fields) {
  return Object.values(fields).some(
    field => field.disabledWhen || field.disabledOptionsWhen,
  );
}


// ─── VALUES ─────────────────────────────────────────────────────────────────

function parseFieldValue(field, value) {
  if (value === "") {
    return null;
  }

  switch (field.input) {
    case "number":
      return Number(value);

    default:
      return value;
  }
}

// The rules only stop *new* invalid selections; a value already set when its dependency
// changes stays until something clears it. Returns the keys it cleared, so a caller can
// say what went away rather than leaving it to vanish unexplained.
function revalidateFields(state, fields) {
  const cleared = [];

  for (const [key, field] of Object.entries(fields)) {
    if (state[key] == null) continue;

    if (isDisabled(field, state)) {
      state[key] = null;
      cleared.push(key);
      continue;
    }

    if (typeof field.disabledOptionsWhen !== "function") continue;
    const disabledOptions = field.disabledOptionsWhen(state);

    // A checkbox-list drops just the now-invalid values, not the whole selection.
    if (Array.isArray(state[key])) {
      const filtered = state[key].filter(value => !disabledOptions.includes(value));
      if (filtered.length !== state[key].length) {
        cleared.push(key);
      }
      state[key] = filtered;
    } else if (disabledOptions.includes(state[key])) {
      state[key] = null;
      cleared.push(key);
    }
  }

  return cleared;
}

// One step, so a call site can't write to the state and forget to revalidate. `key` is
// excluded from the result: it was deliberately set, not silently cleared.
function setFieldValue(state, fields, key, value) {
  state[key] = value;
  return revalidateFields(state, fields).filter(clearedKey => clearedKey !== key);
}


// ─── READING CONTROLS ───────────────────────────────────────────────────────

function getFieldValue(field, key, input, container) {
  switch (field.input) {
    case "checkbox-list":
      return Array.from(
        container.querySelectorAll(`[data-field="${key}"]:checked`)
      ).map(box => box.value);

    case "checkbox":
      return input.checked;

    default:
      return parseFieldValue(field, input.value);
  }
}


// Writes through setFieldValue, so a change can't land without the rest of the schema being
// revalidated against it. One delegated listener on `container`, which is why it survives
// every re-render of the fields inside it.
function attachFieldEvents(container, getState, fields, onFieldChange) {
  container.addEventListener("change", event => {
    const state = getState();

    // Nothing is being edited — the editor between Save and the next Edit click.
    if (!state) return;

    const input = event.target.closest("[data-field]");
    if (!input) return;

    const key = input.dataset.field;
    const field = fields[key];

    // Not this schema's field — a nested schema's control bubbling up. Leave it alone.
    if (!field) return;

    const value = getFieldValue(field, key, input, container);
    const cleared = setFieldValue(state, fields, key, value);

    if (onFieldChange) {
      onFieldChange(key, value, cleared);
    }
  });
}


// Re-rendering replaces the inputs, destroying whichever had focus. Text inputs are safe —
// `change` fires on blur — but a select or checkbox fires it while still focused, which is
// exactly when a dependent-field redraw happens: without this, choosing from a dropdown
// drops the caret to the body.
//
// For a checkbox-list `[data-field]` is a wrapper rather than a control, so its first
// focusable descendant stands in.
function withPreservedFocus(container, render) {
  const active = document.activeElement;
  const key = container.contains(active) ? active.closest("[data-field]")?.dataset.field : null;

  render();

  if (!key) return;

  const restored = container.querySelector(`[data-field="${key}"]`);

  if (!restored) return;

  const control = restored.matches("input, select, textarea")
    ? restored
    : restored.querySelector("input, select, textarea");

  control?.focus();
}


// ─── THE FORM ───────────────────────────────────────────────────────────────

/**
 * One state object and every container that displays it.
 *
 * @param fields    the schema (MODEL_FIELDS, SUBMISSION_FIELDS, ...).
 *
 * @param getState  () => state | null. The object changes are written to; null means the
 *                  form isn't live, and both `render` and the change handler do nothing.
 *
 * @param sections  [{ container, draw }] — one entry per container of fields, all bound to
 *                  that one state. `container` has to outlive the fields inside it, since
 *                  its `change` events are what this listens to; `draw(state)` returns its
 *                  markup. More than one because a change in one panel can invalidate a
 *                  field in another, and the redraw has to cover both.
 *
 * @param onChange  optional (key, value, cleared) => void, called once the state has been
 *                  written, revalidated and — if the schema called for it — redrawn. A
 *                  handler that mutates the state has to call `render` again itself.
 */
function createFieldForm({
  fields,
  getState,
  sections,
  onChange,
}) {
  const hasDependencies = hasDependentFields(fields);

  function render() {
    const state = getState();

    if (!state) return;

    // Focus is preserved per section: it can only be inside one of them, and the calls on
    // the rest are no-ops.
    for (const { container, draw } of sections) {
      withPreservedFocus(container, () => {
        container.innerHTML = draw(state);
      });
    }

    // `editable: false` keys render as display rows, which carry `icon` placeholders — so
    // an edit form needs this too, not just the read-only views.
    refreshIcons();
  }

  // Redrawn whenever the schema has dependent fields, not only when something was cleared:
  // a change can re-enable a field as easily as invalidate one.
  //
  // Skipped for a schema with no such rules, which is not just an optimisation. Blur fires
  // on mousedown, so a redraw on leaving a text input replaces the control the user is
  // halfway through clicking — the click lands on a detached node and the checkbox never
  // ticks. Redraw only where there is something new to show.
  //
  // Before `onChange`, so a handler reporting what happened describes what is on screen.
  function handleChange(key, value, cleared) {
    if (cleared.length || hasDependencies) {
      render();
    }

    onChange?.(key, value, cleared);
  }

  function attach() {
    for (const { container } of sections) {
      attachFieldEvents(container, getState, fields, handleChange);
    }
  }

  return { attach, render };
}


// `getFieldValue` and `parseFieldValue` stay private: reading a control is only correct as
// part of writing the state through setFieldValue, which attachFieldEvents does.
export {
  attachFieldEvents,
  createFieldForm,
  disabledOptionValues,
  isDisabled,
  revalidateFields,
  setFieldValue,
  withPreservedFocus,
};

// A live form: a state object on one side, the `[data-field]` controls on the other, and
// the wiring that keeps them in step.
//
// The only part of a field that touches the document. render.js writes markup and
// state.js holds values; this is where a real `change` event on a real element becomes
// a state write, and where a state write becomes new markup.
//
// State arrives as `getState`, a thunk, not the object — the two forms in this codebase
// need that for different reasons. A create form's state lives as long as the page, so a
// thunk costs it nothing. An editor's draft is thrown away and rebuilt on every Edit
// click, while its listener is attached once for the page's lifetime: bound to an object,
// the listener would keep writing to the draft that existed when it was attached. A thunk
// returning null also says "not live", which is how an editor ignores changes arriving
// while nothing is being edited.

import { refreshIcons } from "../../utils.js";
import {
  hasDependentFields,
  parseFieldValue,
  setFieldValue,
} from "./state.js";


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


// Goes through setFieldValue rather than assigning `state[key]` directly, so a
// change can never land without the rest of the schema being revalidated against
// it. Previously each caller had to remember to call revalidateFields itself —
// models/create and models/edit never did, so a `disabledWhen` rule added to
// MODEL_FIELDS would have silently kept an invalid value on those two forms.
//
// One delegated listener on `container`, which is why it survives every re-render of the
// fields inside it.
//
// `cleared` (the other keys this change invalidated, never `key` itself) is
// passed on so callers can tell the user what just went away instead of leaving
// a value to vanish unexplained.
function attachFieldEvents(container, getState, fields, onFieldChange) {
  container.addEventListener("change", event => {
    const state = getState();

    // Nothing is being edited — the editor between Save and the next Edit click.
    if (!state) return;

    const input = event.target.closest("[data-field]");
    if (!input) return;

    const key = input.dataset.field;
    const field = fields[key];

    // Not this schema's field — e.g. a nested schema (task methodology
    // fields inside the wizard form) bubbling a "change" up to this
    // container's own listener. Let it fall through untouched.
    if (!field) return;

    const value = getFieldValue(field, key, input, container);
    const cleared = setFieldValue(state, fields, key, value);

    if (onFieldChange) {
      onFieldChange(key, value, cleared);
    }
  });
}


// Re-rendering a form replaces its inputs, so whichever one had focus is destroyed. Text
// inputs are safe — `change` fires on blur, so focus has already left — but a select or a
// checkbox fires `change` while still focused, and that is exactly when a dependent-field
// re-render happens. Without this, choosing from a dropdown drops the caret to the body.
//
// The key is read off `[data-field]`, which is the element the change handlers already
// match on; for a checkbox-list that is a wrapper rather than a control, so the first
// focusable descendant stands in for it.
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
 *                  that one state. `container` is an Element the fields are drawn into and
 *                  whose `change` events this listens to, so it has to outlive the fields
 *                  inside it. `draw(state)` returns its markup, and is given the same state
 *                  changes are written to — a caller that displays more than it edits (an
 *                  editor showing read-only context rows) merges the extra in there.
 *
 *                  More than one, because a create form puts its fields in a fieldset per
 *                  panel: a change in one panel can invalidate a field in another, so a
 *                  redraw has to cover all of them. Handing the form every container is
 *                  what lets it do that itself instead of each caller remembering to.
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

    // `editable: false` keys render as display rows, which carry the `icon`
    // placeholders — so an edit form needs createIcons() too, or a read-only field with
    // an icon would show an empty <i> here while looking right on the read-only view.
    refreshIcons();
  }

  // Redrawn whenever the schema has dependent fields, not only when something was cleared:
  // a change can *re-enable* a field or an option as easily as invalidate one, and that
  // only shows up on a redraw.
  //
  // Skipped entirely for a schema with no such rules, and that is not just an
  // optimisation — the markup would come back identical, and redrawing is not free. Blur
  // happens on mousedown, so a redraw triggered by leaving a text input replaces the
  // control the user is halfway through clicking: the click lands on a detached node and
  // the checkbox never ticks, the select never opens. Only a schema that has something new
  // to show is worth that.
  //
  // Before `onChange`, so a handler that reports what happened is describing fields the
  // user can already see.
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


// `getFieldValue` stays private: reading a control is only correct as part of writing the
// state through setFieldValue, which is what attachFieldEvents does. Every caller that used
// to do the two by hand now goes through that.
export {
  attachFieldEvents,
  createFieldForm,
  withPreservedFocus,
};

// Reading live controls: what the user did, and keeping the caret where they left it.
//
// The only part of a field that touches the document. render.js writes markup and
// state.js holds values; this is where a real `change` event on a real element becomes
// a state write.

import { parseFieldValue, setFieldValue } from "./state.js";


// Goes through setFieldValue rather than assigning `state[key]` directly, so a
// change can never land without the rest of the schema being revalidated against
// it. Previously each caller had to remember to call revalidateFields itself —
// models/create and models/edit never did, so a `disabledWhen` rule added to
// MODEL_FIELDS would have silently kept an invalid value on those two forms.
//
// `cleared` (the other keys this change invalidated, never `key` itself) is
// passed on so callers can tell the user what just went away instead of leaving
// a value to vanish unexplained.
function attachFieldEvents(container, state, fields, onFieldChange) {
  container.addEventListener("change", event => {
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


export {
  attachFieldEvents,
  getFieldValue,
  withPreservedFocus,
};

// One field, as markup — an input for an edit form or a label/value row for a
// read-only view.
//
// Every function here returns an HTML string and reads nothing from the document, so
// the caller decides where the result is injected. Anything that has to touch a live
// control belongs in events.js instead.
//
// Every interpolation below goes through escapeHtml. Field keys/labels come from
// our own schemas and are effectively trusted, but the *values* and the dynamic
// `options` (team names, model names — straight off the API) are not. Escaping
// uniformly means no future reader has to work out which slot is which.

import { escapeHtml, formatDate } from "../utils.js";
import { disabledOptionValues, isDisabled } from "./state.js";


function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}


// ─── DISPLAY ────────────────────────────────────────────────────────────────

// checkbox-list values are arrays; joined for display so they don't render as
// the bare "a,b" of String(array). An empty array reads as unset, not "".
function displayValue(field, raw) {
  if (field.input === "datetime-local") return formatDate(raw);
  if (Array.isArray(raw)) return raw.length ? raw.join(", ") : null;
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  return raw;
}

// A textarea's value is prose, so its display row takes the whole width whatever
// the card's `columns` is — half a row is the one place it can't afford. Any field
// can opt in the same way with `fullRow: true` in its schema, for a long joined
// checkbox list say.
//
// Safe to emit unconditionally: `.span-all` is a grid-column rule, so it does
// nothing to a flex child in a single-column card.
function fullRowClass(field) {
  return field.fullRow || field.input === "textarea" ? " span-all" : "";
}


// A field's optional `icon` is a Lucide name, rendered only on display rows —
// an edit form's labels stay plain, since there the input itself carries the
// meaning. The `<i>` is a placeholder: lucide.createIcons() replaces it with an
// <svg>, so whatever injects this HTML has to call that afterwards (renderDetails
// and createFieldForm's render both do).
//
// The row/gap utilities go on the label only when there's an icon to space, so
// `.field-label` keeps its default inline layout everywhere else.
function renderFieldLabel(field) {
  if (!field.icon) {
    return `<label class="field-label">${escapeHtml(field.label)}</label>`;
  }

  return `
    <label class="field-label row left gap-xs">
      <i class="field-icon" data-lucide="${escapeHtml(field.icon)}"></i>
      ${escapeHtml(field.label)}
    </label>
  `;
}


function renderDisplayField(key, state, fields, inline=false) {
  const field = fields[key];
  const value = displayValue(field, state[key]);

  if (inline) {
    return `
      <div class="row${fullRowClass(field)}">
        ${renderFieldLabel(field)}
        <p class="field-value">${value == null || value === "" ? "—" : escapeHtml(value)}</p>
      </div>
    `;
  }

  return `
    <div class="column gap-xs${fullRowClass(field)}">
      ${renderFieldLabel(field)}
      <p class="field-value">${value == null || value === "" ? "—" : escapeHtml(value)}</p>
    </div>
  `;
}


// ─── INPUTS ─────────────────────────────────────────────────────────────────

// A textarea holds its value as element *content*, not a `value` attribute, so
// it can't share renderInputField. The closing `>` must sit tight against the
// value: HTML strips one newline directly after the open tag, which would
// silently eat a leading blank line in a saved narrative.
function renderTextareaField(key, state, fields) {
  const value = state[key];
  const field = fields[key];

  return `
    <div class="column gap-xs">
      <label class="field-label" for="${escapeHtml(key)}">${escapeHtml(field.label)}</label>
      <textarea
        id="${escapeHtml(key)}"
        class="field-input field-textarea"
        placeholder="${escapeHtml(field.placeholder)}"
        data-field="${escapeHtml(key)}"
        ${isDisabled(field, state) ? "disabled" : ""}
      >${escapeHtml(value)}</textarea>
    </div>
  `;
}


// Used for text, url and number
function renderInputField(key, state, fields) {
  const value = state[key];
  const field = fields[key];

  return `
    <div class="column gap-xs">
      <label class="field-label" for="${escapeHtml(key)}">${escapeHtml(field.label)}</label>
      <input
        id="${escapeHtml(key)}"
        class="field-input"
        type="${escapeHtml(field.input)}"
        placeholder="${escapeHtml(field.placeholder)}"
        data-field="${escapeHtml(key)}"
        ${isDisabled(field, state) ? "disabled" : ""}
        value="${escapeHtml(value)}">
    </div>
  `;
}


// Options are either plain scalars (e.g. is_pretrained's [true, false], where
// the value and its label are the same) or {value, label} pairs (e.g. teams,
// where the id must be sent but the name is what's shown).
function normalizeOption(option) {
  if (typeof option === "object" && option !== null) return option;
  return { value: option, label: option };
}

function renderSelectField(key, state, fields) {
  const value = state[key];
  const field = fields[key];
  const options = field.options.map(normalizeOption);
  const disabledOptions = disabledOptionValues(field, state);

  return `
    <div class="column gap-xs">
      <label class="field-label" for="${escapeHtml(key)}">${escapeHtml(field.label)}</label>

      <select
        id="${escapeHtml(key)}"
        class="input-select"
        data-field="${escapeHtml(key)}"
        ${isDisabled(field, state) ? "disabled" : ""}>

        <option value="" disabled ${value == null ? "selected" : ""}>
          ${escapeHtml(field.placeholder ?? "Select an option...")}
        </option>

        ${options.map(({ value: optionValue, label: optionLabel }) => `
          <option
            value="${escapeHtml(optionValue)}"
            ${String(optionValue) === String(value) ? "selected" : ""}
            ${disabledOptions.includes(optionValue) ? "disabled" : ""}>
            ${escapeHtml(optionLabel)}
          </option>
        `).join("")}

      </select>
    </div>
  `;
}


function renderCheckboxListField(key, state, fields) {
  const value = toArray(state[key]);
  const field = fields[key];
  const disabledOptions = disabledOptionValues(field, state);
  const fieldDisabled = isDisabled(field, state);

  return `
    <div class="column gap-xs">
      <label class="field-label">${escapeHtml(field.label)}</label>

      <div class="column gap-sm">
        ${field.options.map(option => `
          <label class="value row left gap-sm">
            <input
              class="field-checkbox"
              type="checkbox"
              data-field="${escapeHtml(key)}"
              value="${escapeHtml(option)}"
              ${value.includes(option) ? "checked" : ""}
              ${fieldDisabled || disabledOptions.includes(option) ? "disabled" : ""}>
            ${escapeHtml(option)}
          </label>
        `).join("")}
      </div>
    </div>
  `;
}


function renderCheckboxField(key, state, fields) {
  const value = Boolean(state[key]);
  const field = fields[key];

  return `
    <div class="row left gap-sm">
      <label
        class="field-label"
        for="${escapeHtml(key)}">
        ${escapeHtml(field.label)}
      </label>

      <input
        id="${escapeHtml(key)}"
        class="field-checkbox"
        type="checkbox"
        data-field="${escapeHtml(key)}"
        ${isDisabled(field, state) ? "disabled" : ""}
        ${value ? "checked" : ""}>
    </div>
  `;
}


function renderField(key, state, fields) {
  const field = fields[key];

  if (field.editable === false) {
    return renderDisplayField(key, state, fields);
  }

  switch (field.input) {
    case "checkbox-list":
      return renderCheckboxListField(key, state, fields);

    case "checkbox":
      return renderCheckboxField(key, state, fields);

    case "select":
      return renderSelectField(key, state, fields);

    case "textarea":
      return renderTextareaField(key, state, fields);

    default:
      return renderInputField(key, state, fields);
  }
}


// ─── RUNS OF FIELDS ─────────────────────────────────────────────────────────

// Both take (keys, state, fields, inline) so either can be handed to
// renderGroups as its per-group renderer.

function renderFields(keys, state, fields) {
  return keys
    .map(key => renderField(key, state, fields))
    .join("");
}


function renderDisplayFields(keys, state, fields, inline=false) {
    return keys
    .map(key => renderDisplayField(key, state, fields, inline))
    .join("");
}


export {
  renderDisplayFields,
  renderFields,
};

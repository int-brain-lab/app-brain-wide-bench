// Fields as markup — an input for an edit form or a label/value row for a read-only view,
// and the cards and grids a run of them sits in.
//
// Everything here returns an HTML string and reads nothing from the document; anything that
// touches a live control belongs in form.js, which is where the disabled-rule readers come
// from too.
//
// Every interpolation goes through escapeHtml. Keys and labels are our own schemas', but
// values and dynamic `options` (team and model names, straight off the API) are not, and
// escaping uniformly means no reader has to work out which slot is which.

import { escapeHtml, formatDate } from "../core/utils.js";
import { disabledOptionValues, isDisabled } from "./form.js";


function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}


// ─── DISPLAY ────────────────────────────────────────────────────────────────

// A checkbox-list's array is joined rather than left to String(array), and an empty one
// reads as unset rather than "".
function displayValue(field, raw) {
  if (field.input === "datetime-local") return formatDate(raw);
  if (Array.isArray(raw)) return raw.length ? raw.join(", ") : null;
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  return raw;
}

// A textarea's value is prose, so its row takes the whole width whatever the card's
// `columns` says; any field can opt in with `fullRow: true`. Safe to emit unconditionally —
// `.span-all` is a grid rule, so it does nothing to a flex child in a one-column card.
function fullRowClass(field) {
  return field.fullRow || field.input === "textarea" ? " span-all" : "";
}


// `icon` is a Lucide name, and the `<i>` is a placeholder — whatever injects this markup
// has to run createIcons() afterwards. The row/gap utilities go on only when there is an
// icon to space, so `.field-label` keeps its default layout everywhere else.
function buildFieldLabel(field) {
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


function buildDisplayField(key, state, fields, inline=false) {
  const field = fields[key];
  const value = displayValue(field, state[key]);

  if (inline) {
    return `
      <div class="row${fullRowClass(field)}">
        ${buildFieldLabel(field)}
        <p class="field-value">${value == null || value === "" ? "—" : escapeHtml(value)}</p>
      </div>
    `;
  }

  return `
    <div class="column gap-xs${fullRowClass(field)}">
      ${buildFieldLabel(field)}
      <p class="field-value">${value == null || value === "" ? "—" : escapeHtml(value)}</p>
    </div>
  `;
}


// ─── INPUTS ─────────────────────────────────────────────────────────────────

// Shown on inputs only, never on a display row — a read-only value can't be filled in.
// aria-hidden because the control itself carries the `required` attribute, which is what a
// screen reader announces; the asterisk would otherwise be read out as punctuation.
const REQUIRED_MARKER = `<span class="required-marker" aria-hidden="true">*</span>`;

// `htmlFor` off for a checkbox-list, whose label heads a group of checkboxes rather than
// naming one control — there is no id for it to point at.
function buildInputLabel(key, field, { htmlFor = true } = {}) {
  return `
    <label class="field-label"${htmlFor ? ` for="${escapeHtml(key)}"` : ""}>
      ${escapeHtml(field.label)}${field.required ? REQUIRED_MARKER : ""}
    </label>
  `;
}

// A textarea holds its value as element content, not an attribute, so it can't share
// buildInputField. The closing `>` must sit tight against the value: HTML strips one
// newline after the open tag, which would eat a leading blank line in a saved narrative.
function buildTextareaField(key, state, fields) {
  const value = state[key];
  const field = fields[key];

  return `
    <div class="column gap-xs">
      ${buildInputLabel(key, field)}
      <textarea
        id="${escapeHtml(key)}"
        class="field-input field-textarea"
        placeholder="${escapeHtml(field.placeholder)}"
        data-field="${escapeHtml(key)}"
        ${field.required ? "required" : ""}
        ${isDisabled(field, state) ? "disabled" : ""}
      >${escapeHtml(value)}</textarea>
    </div>
  `;
}


// Used for text, url and number
function buildInputField(key, state, fields) {
  const value = state[key];
  const field = fields[key];

  return `
    <div class="column gap-xs">
      ${buildInputLabel(key, field)}
      <input
        id="${escapeHtml(key)}"
        class="field-input"
        type="${escapeHtml(field.input)}"
        placeholder="${escapeHtml(field.placeholder)}"
        data-field="${escapeHtml(key)}"
        ${field.required ? "required" : ""}
        ${isDisabled(field, state) ? "disabled" : ""}
        value="${escapeHtml(value)}">
    </div>
  `;
}


// Options are either scalars, where the value is its own label, or {value, label} pairs —
// a team, whose id is sent but whose name is shown.
function normalizeOption(option) {
  if (typeof option === "object" && option !== null) return option;
  return { value: option, label: option };
}

function buildSelectField(key, state, fields) {
  const value = state[key];
  const field = fields[key];
  const options = field.options.map(normalizeOption);
  const disabledOptions = disabledOptionValues(field, state);

  return `
    <div class="column gap-xs">
      ${buildInputLabel(key, field)}

      <select
        id="${escapeHtml(key)}"
        class="input-select"
        data-field="${escapeHtml(key)}"
        ${field.required ? "required" : ""}
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


function buildCheckboxListField(key, state, fields) {
  const value = toArray(state[key]);
  const field = fields[key];
  const disabledOptions = disabledOptionValues(field, state);
  const fieldDisabled = isDisabled(field, state);

  return `
    <div class="column gap-xs">
      ${buildInputLabel(key, field, { htmlFor: false })}

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


function buildCheckboxField(key, state, fields) {
  const value = Boolean(state[key]);
  const field = fields[key];

  return `
    <div class="row left gap-sm">
      ${buildInputLabel(key, field)}

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


function buildField(key, state, fields) {
  const field = fields[key];

  if (field.editable === false) {
    return buildDisplayField(key, state, fields);
  }

  switch (field.input) {
    case "checkbox-list":
      return buildCheckboxListField(key, state, fields);

    case "checkbox":
      return buildCheckboxField(key, state, fields);

    case "select":
      return buildSelectField(key, state, fields);

    case "textarea":
      return buildTextareaField(key, state, fields);

    default:
      return buildInputField(key, state, fields);
  }
}


// ─── RUNS OF FIELDS ─────────────────────────────────────────────────────────

// Both take (keys, state, fields, inline), so either can be buildGroupCards' renderer.

function buildFields(keys, state, fields) {
  return keys
    .map(key => buildField(key, state, fields))
    .join("");
}


function buildDisplayFields(keys, state, fields, inline=false) {
    return keys
    .map(key => buildDisplayField(key, state, fields, inline))
    .join("");
}


// ─── CARDS AND GRIDS ────────────────────────────────────────────────────────

// A `columns` value with no class here falls back to the card's own flex column, rather
// than emitting a class style.css has no rule for.
const GRID_CLASS = { 2: "grid-2", 3: "grid-3", 4: "grid-4" };


// Fields arrive as a flat run of siblings, so the container decides how they flow: one
// column needs no wrapper, more than one needs a grid.
function wrapColumns(html, columns) {
  const gridClass = GRID_CLASS[columns];
  return gridClass ? `<div class="${gridClass}">${html}</div>` : html;
}


// One card per group, so a read-only view and its edit form share one layout definition.
//
// A group is just `{title, keys, inline, columns}` — nothing here knows about `panel`, so a
// caller is free to group by something else; schema.js's panelGroups is only the usual way.
// `render` is the per-group renderer: buildFields to edit, buildDisplayFields to display.
//
// `columns` lays fields out N-up. Mostly for a read-only view, where a label/value pair per
// line wastes the card's width; inputs want the full width, so an edit form overrides it.
function buildGroupCards(groups, state, fields, render) {
  return `
    <div class="column gap-lg">
      ${groups.map(group => `
        <div class="card column gap-md">
          ${group.title ? `<p class="title muted">${escapeHtml(group.title)}</p>` : ""}
          ${wrapColumns(render(group.keys, state, fields, group.inline), group.columns)}
        </div>
      `).join("")}
    </div>
  `;
}


export {
  REQUIRED_MARKER,
  buildDisplayFields,
  buildFields,
  buildGroupCards,
};

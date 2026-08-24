// Fields as markup — an input for an edit form or a label/value row for a read-only view,
// and the cards and grids a run of them sits in.
//
// Every function here returns an HTML string and reads nothing from the document; anything
// that touches a live control belongs in form.js, which is where the disabled-rule readers
// come from too. The one exception is the installFieldHelp() call below, which is a side
// effect of loading this module rather than of calling anything in it.
//
// Every interpolation goes through escapeHtml. Keys and labels are our own schemas', but
// values and dynamic `options` (team and model names, straight off the API) are not, and
// escaping uniformly means no reader has to work out which slot is which.

import { installFieldHelp } from "../components/fieldHelp.js";
import { escapeHtml, formatDate } from "../core/utils.js";
import { disabledOptionValues, isDisabled, isHelpPinned } from "./form.js";


// Positioning a help popover so it stays on screen needs measurements, so it is document
// work and lives in its own module. Asked for here because this is the module that emits the
// popovers: a page that renders no fields loads neither, and a page that renders fields
// can't forget to. There is no page-wide bootstrap to hang it off — the create pages don't
// even load the nav.
installFieldHelp();


function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}


// ─── HELP TEXT ──────────────────────────────────────────────────────────────

// The "?" beside a label, and the description it shows. Emitted wherever a field has a
// `description` — which is filled from /api/meta, so what it says is a change to models.py
// and nothing here.
//
// Hovering shows the text as a popover. On an input, clicking pins it instead: the same text
// is written out between the label and the control and stays there, which is what long
// descriptions want — a paragraph you have to keep hovering to read is a paragraph you read
// twice. The popover is CSS-only; the pin is one delegated listener in form.js, which is
// also where the pinned set lives.
//
// The popover being CSS-only is why it is anchored under the trigger and centred rather than
// flipped to fit — nothing here measures the viewport — and why style.css lifts
// `overflow: hidden` on a card that contains one, or it would be clipped.
//
// A literal "?" and not a Lucide placeholder: an `<i data-lucide>` only becomes a glyph once
// someone calls createIcons(), which is the caller's job here and is done in nine different
// places — a render path that forgot would leave an invisible trigger.
//
// The trigger sits beside the `<label>` rather than inside it, since a click on a label is
// forwarded to its control and a button in that path is its own bug.
//
// `pinnable` is off for a read-only row, which has no gap between a label and a control to
// write into — it keeps the hover popover and loses only the click. It is also what styles
// the cursor, so a "?" that does nothing on click doesn't claim otherwise.
function buildHelp(key, text, { label = "", pinnable = false } = {}) {
  if (!text) return "";

  const id = `${key}-help`;
  const pinned = pinnable && isHelpPinned(key);

  return `
    <span class="field-help">
      <button
        type="button"
        class="field-help-trigger"
        ${pinnable ? `data-help-for="${escapeHtml(key)}"` : ""}
        aria-label="About ${escapeHtml(label)}"
        aria-expanded="${pinned ? "true" : "false"}"
        aria-describedby="${escapeHtml(id)}">?</button>
      <span class="field-help-text" role="tooltip" id="${escapeHtml(id)}">${escapeHtml(text)}</span>
    </span>
  `;
}


// The pinned copy of the same text, as a block between the label and the control. Always
// rendered when there is text to show and hidden until pinned, so the click listener has an
// element to reveal without knowing how to build one — and so a re-render of an already
// pinned field brings it back open.
function buildHelpText(key, text) {
  if (!text) return "";

  // The text sits tight against both tags: `.field-help-inline` is `white-space: pre-line`
  // so a select's option lines keep their breaks, which means the template's own
  // indentation would show up as a blank first and last line.
  const attributes = `data-help-text="${escapeHtml(key)}"${isHelpPinned(key) ? "" : " hidden"}`;

  return `<p class="field-help-inline" ${attributes}>${escapeHtml(text)}</p>`;
}


// A label and its "?" as one row. Returns the label untouched when there is nothing to
// explain, so a field with no description renders exactly the markup it did before.
function withHelp(labelHtml, helpHtml) {
  if (!helpHtml) return labelHtml;

  return `<span class="field-label-row row left gap-sm">${labelHtml}${helpHtml}</span>`;
}


// What the "?" says for a field whose options are described too — a select or a
// checkbox-list. The option descriptions join the field's own, so one "?" in the header
// explains the field and every choice in it, rather than a row of them down the options.
//
// For a select there is no alternative: a native `<option>` can't carry a trigger. A
// checkbox-list could have had one per row, and did, but a column of "?"s beside the boxes
// is noise where a single pinned block reads as one explanation.
function optionsHelpText(field) {
  const described = (field.options ?? []).filter(option => option?.description);

  if (!described.length) return field.description ?? "";

  const options = described.map(({ label, value, description }) => `${label ?? value} — ${description}`);

  return [field.description, ...options].filter(Boolean).join("\n\n");
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
function buildFieldLabel(key, field) {
  const help = buildHelp(key, field.description, { label: field.label });

  if (!field.icon) {
    return withHelp(`<label class="field-label">${escapeHtml(field.label)}</label>`, help);
  }

  return withHelp(`
    <label class="field-label row left gap-xs">
      <i class="field-icon" data-lucide="${escapeHtml(field.icon)}"></i>
      ${escapeHtml(field.label)}
    </label>
  `, help);
}


function buildDisplayField(key, state, fields, inline=false) {
  const field = fields[key];
  const value = displayValue(field, state[key]);

  if (inline) {
    return `
      <div class="row${fullRowClass(field)}">
        ${buildFieldLabel(key, field)}
        <p class="field-value">${value == null || value === "" ? "—" : escapeHtml(value)}</p>
      </div>
    `;
  }

  return `
    <div class="column gap-xs${fullRowClass(field)}">
      ${buildFieldLabel(key, field)}
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
// Returns the label row *and* the pinned help block, in that order, because every caller
// puts the result immediately before its control — which is exactly where the pinned text
// belongs, with no caller needing to place it.
function buildInputLabel(key, field, { htmlFor = true, help = field.description } = {}) {
  const labelRow = withHelp(`
    <label class="field-label"${htmlFor ? ` for="${escapeHtml(key)}"` : ""}>
      ${escapeHtml(field.label)}${field.required ? REQUIRED_MARKER : ""}
    </label>
  `, buildHelp(key, help, { label: field.label, pinnable: true }));

  return labelRow + buildHelpText(key, help);
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
      ${buildInputLabel(key, field, { help: optionsHelpText(field) })}

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


// Through normalizeOption like a select's, because an options list off /api/meta is
// {value, label, description} objects — it used to be bare strings, and the `disabledWhen`
// rules and the stored state are still the values, never the objects.
//
// The options' own descriptions go into the field's "?" via optionsHelpText, the same as a
// select's.
function buildCheckboxListField(key, state, fields) {
  const value = toArray(state[key]);
  const field = fields[key];
  const options = field.options.map(normalizeOption);
  const disabledOptions = disabledOptionValues(field, state);
  const fieldDisabled = isDisabled(field, state);

  return `
    <div class="column gap-xs">
      ${buildInputLabel(key, field, { htmlFor: false, help: optionsHelpText(field) })}

      <div class="column gap-sm">
        ${options.map(({ value: optionValue, label: optionLabel }) => `
          <label class="value row left gap-sm">
            <input
              class="field-checkbox"
              type="checkbox"
              data-field="${escapeHtml(key)}"
              value="${escapeHtml(optionValue)}"
              ${value.includes(optionValue) ? "checked" : ""}
              ${fieldDisabled || disabledOptions.includes(optionValue) ? "disabled" : ""}>
            ${escapeHtml(optionLabel)}
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

import {escapeHtml, formatDate} from "../utils.js";

// Every interpolation below goes through escapeHtml. Field keys/labels come from
// our own schemas and are effectively trusted, but the *values* and the dynamic
// `options` (team names, model names — straight off the API) are not. Escaping
// uniformly means no future reader has to work out which slot is which.

// ─── HELPERS ────────────────────────────────────────────────────────────────

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}


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

function fieldsForPanel(fields, panel, editableOnly=true) {
  return Object.keys(fields)
    .filter(key => fields[key].panel === panel && (!editableOnly || fields[key].editable !== false));
}


// Build a working copy of the editable fields, seeded from `source` (e.g. a
// fetched record, for editing) or field defaults (for creating). Arrays are
// always cloned so two state objects never alias the same `field.default`
// (or the same source) array.
function createFieldState(fields, source = {}) {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, field]) => field.editable !== false)
      .map(([key, field]) => {
        const value = source[key] ?? field.default ?? null;
        return [key, Array.isArray(value) ? [...value] : value];
      })
  );
}

// `disabledWhen`/`disabledOptionsWhen` only stop *new* invalid selections —
// they don't retroactively clear a value that's already set when whatever it
// depends on (another field, or external context like the selected model)
// changes later. Call this after any change that could invalidate other
// fields' current values, so stale selections don't silently persist.
// Returns the keys it actually cleared, so callers can tell the user what
// just happened instead of a value silently vanishing.
function revalidateFields(state, fields) {
  const cleared = [];

  for (const [key, field] of Object.entries(fields)) {
    if (state[key] == null) continue;

    if (typeof field.disabledWhen === "function" && field.disabledWhen(state)) {
      state[key] = null;
      cleared.push(key);
      continue;
    }

    if (typeof field.disabledOptionsWhen !== "function") continue;
    const disabledOptions = field.disabledOptionsWhen(state);

    // Multi-value (checkbox-list) fields: drop just the now-invalid values
    // rather than nulling the whole selection.
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

// Sets one field then revalidates the rest of the schema against it in one
// step, so a call site can't mutate state and forget to revalidate — returns
// the cleared keys, excluding `key` itself (that one was deliberately set,
// not "silently cleared").
function setFieldValue(state, fields, key, value) {
  state[key] = value;
  return revalidateFields(state, fields).filter(clearedKey => clearedKey !== key);
}


// ─── RENDERING ──────────────────────────────────────────────────────────────

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
// and the editor's renderDraft both do).
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




function isDisabled(field, state) {
  return typeof field.disabledWhen === "function" && field.disabledWhen(state);
}


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

// Options disabled by `disabledOptionsWhen` stay in the list (visible, but
// unselectable) rather than being removed — so users can see what exists and
// why a choice isn't available, instead of it silently disappearing.
function disabledOptionValues(field, state) {
  return typeof field.disabledOptionsWhen === "function"
    ? field.disabledOptionsWhen(state)
    : [];
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


// The grid utilities that exist in style.css. A `columns` value with no class
// here (1, undefined, or something nobody wrote a rule for) falls back to the
// card's own single flex column rather than emitting a class that does nothing.
const GRID_CLASS = { 2: "grid-2", 3: "grid-3", 4: "grid-4" };


// Fields arrive as a flat run of sibling divs, so it's the container that decides
// how they flow: one column needs no wrapper (the card is already a flex column),
// more than one needs a grid around them.
function wrapColumns(html, columns) {
  const gridClass = GRID_CLASS[columns];
  return gridClass ? `<div class="${gridClass}">${html}</div>` : html;
}


// Renders one card per group, so a read-only view and its edit form can share a
// single layout definition instead of each hardcoding the same card titles.
//
// Deliberately knows nothing about `panel`: a group is just `{title, keys,
// inline, columns}`, which leaves callers free to group by something else
// entirely. `render` is the per-group field renderer — renderFields for an edit
// form, renderDisplayFields for a read-only view; both take (keys, state,
// fields, inline), so either can be passed straight in.
//
// `columns` lays a group's fields out N-up instead of stacked. Mostly useful on a
// read-only view, where a row is a short label/value pair and one per line wastes
// most of the card's width; inputs and textareas usually want the full width, so
// an edit form tends to override it back to 1 (see panelGroups).
function renderGroups(groups, state, fields, render) {
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


// Builds renderGroups' groups from a panel layout — declared alongside the schema
// it describes as [{panel, title, inline, columns}].
//
// `editableOnly` mirrors fieldsForPanel's third argument inverted: false (the
// default) keeps `editable: false` keys, which an edit form still wants as
// read-only context rows. A panel whose keys all filter out is dropped rather
// than rendering an empty card.
//
// `columns`, if given, overrides every panel's own value — this is how one layout
// serves both modes: the display view takes the panels as declared, and the edit
// form passes `{columns: 1}` so inputs get the card's full width.
function panelGroups(fields, panels, { editableOnly = false, columns } = {}) {
  return panels
    .map(({ panel, title, inline, columns: panelColumns }) => ({
      title,
      inline,
      columns: columns ?? panelColumns,
      keys: fieldsForPanel(fields, panel, editableOnly),
    }))
    .filter(group => group.keys.length);
}


// ─── EVENTS ─────────────────────────────────────────────────────────────────

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


export {
  renderFields,
  renderDisplayFields,
  renderGroups,
  panelGroups,
  attachFieldEvents,
  fieldsForPanel,
  createFieldState,
  revalidateFields,
  setFieldValue,
  getFieldValue,
};
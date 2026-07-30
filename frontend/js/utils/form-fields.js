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

function fieldsForPanel(fields, panel) {
  return Object.keys(fields)
    .filter(key => fields[key].panel === panel);
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

function renderDisplayField(key, state, fields) {
  const field = fields[key];
  const value = displayValue(field, state[key]);

  return `
    <div class="column gap-xs">
      <label class="field-label">${escapeHtml(field.label)}</label>
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


function renderDisplayFields(keys, state, fields) {
    return keys
    .map(key => renderDisplayField(key, state, fields))
    .join("");
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
  attachFieldEvents,
  fieldsForPanel,
  createFieldState,
  revalidateFields,
  setFieldValue,
  getFieldValue,
};
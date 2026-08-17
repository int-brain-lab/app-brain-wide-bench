// A form's working copy of its values, and the schema rules that keep it valid.
//
// Nothing here touches the DOM: this is the value model that render.js draws and
// events.js writes to. The `disabledWhen`/`disabledOptionsWhen` readers live here
// rather than beside the markup because revalidation and rendering must answer the
// same question the same way — a field drawn as disabled and a value cleared as
// invalid are two views of one rule.

// ─── SCHEMA RULES ───────────────────────────────────────────────────────────

function isDisabled(field, state) {
  return typeof field.disabledWhen === "function" && field.disabledWhen(state);
}

// Options disabled by `disabledOptionsWhen` stay in the list (visible, but
// unselectable) rather than being removed — so users can see what exists and
// why a choice isn't available, instead of it silently disappearing.
function disabledOptionValues(field, state) {
  return typeof field.disabledOptionsWhen === "function"
    ? field.disabledOptionsWhen(state)
    : [];
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

    if (isDisabled(field, state)) {
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


export {
  createFieldState,
  disabledOptionValues,
  isDisabled,
  parseFieldValue,
  revalidateFields,
  setFieldValue,
};

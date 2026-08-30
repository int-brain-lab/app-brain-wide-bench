import { apiFetch } from "./client.js";

// ─── API ─────────────────────────────────────────────────────────────────────

// Everything the forms need that isn't anyone's data: dropdown options, help text, the task
// table, what each suite predicts. Public — a create page draws its dropdowns signed out.

// Memoised per page load only: every link is a full navigation, which discards this module.
// Across navigations the repeat is answered 304 off the endpoint's ETag.
//
// `inflight` as well as `cached`: two concurrent callers would both miss an unresolved
// `cached` and fetch twice.
let cached = null;
let inflight = null;

async function getMeta() {
  cached ??= await (inflight ??= apiFetch("/api/meta"));

  return cached;
}

// ─── SCHEMAS ─────────────────────────────────────────────────────────────────

// A schema declares what it wants, not what the answer is: `enum: "modality"` names a list
// on this document, `record: "model"` names whose field descriptions to read.

// One field's options, in the {value, label, description} shape fields.js draws.
function optionsFor(field, meta) {
  return (meta.enums[field.enum] ?? []).map(({ value, description }) => ({
    value,
    label: value,
    description,
  }));
}

/**
 * Fill a schema's blanks from the meta document, in place — the schemas are module
 * singletons, read directly by whoever awaited the loader.
 *
 * @param fields the field definitions to fill (MODEL_FIELDS, TASK_FIELDS, ...).
 * @param meta   the /api/meta document.
 * @param record whose field descriptions to read — "model", "submission",
 *               "task_submission". Omit for a schema the API has no descriptions for.
 *
 * @returns the same `fields`, now filled.
 */
function applyFieldMeta(fields, meta, record) {
  const descriptions = record ? (meta.fields[record] ?? {}) : {};

  for (const [key, field] of Object.entries(fields)) {
    // `??=` so a schema may spell out its own options, and so a second call doesn't
    // overwrite the per-user lists the loaders fetch separately.
    if (field.enum) field.options ??= optionsFor(field, meta);

    // An absent key leaves `description` undefined, which is what fields.js tests.
    if (descriptions[key]) field.description = descriptions[key];
  }

  return fields;
}

export { applyFieldMeta, getMeta };

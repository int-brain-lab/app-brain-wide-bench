// Filling a schema's blanks from /api/meta — the options a dropdown offers, and the help
// text shown against a field or one of its options.
//
// A schema declares what it wants and not what the answer is: `enum: "modality"` names a
// list on the meta document, and `record: "model"` names whose field descriptions to read.
// That is the point of the whole arrangement — rewording a description, or adding a
// modality, is a change to models.py and nothing else. Before this, the model form carried
// its own hardcoded modality list that had quietly drifted from the enum by two members.
//
// It mutates the schema in place, which is not what a function like this should do; see the
// note on applyFieldMeta.

// The options for one field: its named enum from the meta document, mapped to the
// {value, label, description} shape fields.js draws. `label` is the value, which is what
// the forms already showed — naming the members nicely is a separate decision, and
// inventing wording here would have quietly changed every dropdown.
function optionsFor(field, meta) {
  return (meta.enums[field.enum] ?? []).map(({ value, description }) => ({
    value,
    label: value,
    description,
  }));
}


/**
 * Fill `fields` from the meta document, in place.
 *
 * In place, and not returning a new schema, because the schemas are imported as module
 * singletons — TASK_FIELDS is read directly by the task panel, the task table and the task
 * submission view, all of which rely on whoever awaited the loader having filled it. Making
 * this pure is the right end state and is what the TODO in taskSubmissionSchema asked for,
 * but it means threading a resolved copy through the submit wizard, which is a change to
 * that page rather than to this one. Filling from one document instead of three at least
 * makes it happen once.
 *
 * @param fields  the schema to fill (MODEL_FIELDS, TASK_FIELDS, ...).
 * @param meta    the /api/meta document.
 * @param record  which record's field descriptions to read — "model", "submission",
 *                "task_submission". Omitted for a schema the API has no descriptions for.
 */
function applyFieldMeta(fields, meta, record) {
  const descriptions = record ? meta.fields[record] ?? {} : {};

  for (const [key, field] of Object.entries(fields)) {
    // `??=` so a schema may still spell out its own options — `is_pretrained` is [true,
    // false], which is not an enum on the server — and so the per-user lists the loaders
    // fetch separately (teams, models) are not overwritten on a second call.
    if (field.enum) field.options ??= optionsFor(field, meta);

    // Only when the server has something to say. An absent key leaves `description`
    // undefined, which is what fields.js tests to decide whether a field gets a help
    // affordance at all.
    if (descriptions[key]) field.description = descriptions[key];
  }

  return fields;
}


export { applyFieldMeta };

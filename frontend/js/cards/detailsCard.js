// The summary card a record dashboard shows: a few of a record's fields. The way to the rest
// is the section's own footer button — see buildSectionFooter in components/sections.js.

import { buildDisplayFields } from "../forms/fields.js";

function toColumns(keys, columns) {
  const height = Math.ceil(keys.length / columns);

  return Array.from({ length: columns }, (_, index) =>
    keys.slice(index * height, (index + 1) * height),
  );
}

/**
 * A record's summary card.
 *
 * @param record  the record the fields are read from.
 * @param fields  the field definitions (MODEL_FIELDS, SUBMISSION_FIELDS, ...). Keys they
 *                don't describe are dropped.
 * @param keys    which fields to show, in order.
 * @param columns how many columns to lay them out in.
 *
 * @returns the markup.
 */
function buildDetailsCard({ record, fields, keys, columns = 1 }) {
  const shown = keys.filter((key) => key in fields);

  const stacks = toColumns(shown, columns)
    .map(
      (columnKeys) => `
        <span class="column gap-lg">
          ${buildDisplayFields(columnKeys, record, fields)}
        </span>
      `,
    )
    .join("");

  const layout = columns > 1 ? ` class="grid-${columns}"` : "";

  return `
    <div class="card secondary">
      <div${layout}>
        ${stacks}
      </div>
    </div>
  `;
}

export { buildDetailsCard };

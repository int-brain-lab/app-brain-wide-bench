// The summary card a record dashboard shows: a few fields, and the link to the rest.

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
 * @param view    the router view the footer link goes to.
 *
 * @returns the markup.
 */
function buildDetailsCard({
  record,
  fields,
  keys,
  columns = 1,
  view = "details",
}) {
  const shown = keys.filter((key) => key in fields);

  const stacks = toColumns(shown, columns)
    .map(
      (columnKeys) => `
        <span class="column gap-md">
          ${buildDisplayFields(columnKeys, record, fields)}
        </span>
      `,
    )
    .join("");

  const layout = columns > 1 ? ` class="grid-${columns}"` : "";

  return `
    <div class="card corner-link">
      <div${layout}>
        ${stacks}
      </div>

      <a class="link" href="#" data-view="${view}">View all details →</a>
    </div>
  `;
}

export { buildDetailsCard };

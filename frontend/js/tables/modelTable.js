// Filterable models table.
//
// The table allows you to search by model name and filter by team or suite.
//
// The columns only. Rows and filters are in utils/modelUtils.js, and the table
// infrastructure in table.js.

import { getModelFilters } from "../utils/modelUtils.js";
import { createFilterableTable } from "./table.js";
import {
  dateFormatter,
  dateSorter,
  metadataFormatter,
  buildModelNameFormatter,
  suiteBadgesFormatter,
} from "./formatters.js";

// ─── COLUMNS ─────────────────────────────────────────────────────────────────

// `showMine` on marks the rows on the viewer's own teams, for the public listing that mixes
// them with everyone else's. Off by default: on a listing that is all theirs it says nothing.
function getModelColumns({ showMine = false } = {}) {
  return [
    {
      title: "Model",
      field: "name",
      formatter: buildModelNameFormatter("/html/models/models.html", {
        showMine,
      }),
      widthGrow: 2,
    },
    {
      title: "Team",
      field: "team_name",
      formatter: metadataFormatter,
    },
    {
      title: "Suites",
      field: "suites",
      formatter: suiteBadgesFormatter,
      headerSort: false,
    },
    {
      title: "Created",
      field: "created_at",
      formatter: dateFormatter,
      sorter: dateSorter,
    },
    {
      title: "Submissions",
      field: "n_submissions",
      width: 130,
    },
  ];
}

// ─── TABLE ───────────────────────────────────────────────────────────────────

/**
 * The live models table, filterable above the grid.
 *
 * @param rows            rows from toModelRows.
 * @param showMine        mark the rows on the viewer's own teams — see getModelColumns.
 * @param showSuiteFilter keep the suite select — see getModelFilters.
 * @param showFilters     keep the filter bar above the grid. False for a caller with a bar
 *                        of its own over both its views — see templates/listPage.js.
 * @param selection       as createFilterableTable. Keyed on the model id, so a caller
 *                        holding one can select or deselect its row without a lookup.
 *
 * @returns { element, table } — the caller mounts the element where it wants it, and keeps
 *          the instance. Handing it back rather than filling a container is what lets a page
 *          build the table once and attach it to a slot it shares with another view.
 */
function createModelsTable({
  rows,
  showMine = false,
  showSuiteFilter = true,
  showFilters = true,
  selection,
}) {
  return createFilterableTable({
    rows,
    columns: getModelColumns({ showMine }),
    controls: showFilters ? getModelFilters(rows, { showSuiteFilter }) : [],
    noun: "model",
    initialSort: [{ column: "created_at", dir: "desc" }],
    index: "id",
    selection,
  });
}

export { createModelsTable };

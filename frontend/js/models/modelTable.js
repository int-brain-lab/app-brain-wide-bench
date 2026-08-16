// Filterable models table
//
// The table allows you to search by model name and filter by team or suite
//
// This code just defines the columns, rows and controls. Table infrastructure lives in utils/tables.js

import {
  SUITE_OPTIONS,
  createFilterableTable,
  dateFormatter,
  dateSorter,
  linkFormatter,
  matchEquals,
  matchInArray,
  matchIncludes,
  metadataFormatter,
  optionsFromRows,
  suiteBadgesFormatter,
} from "../components/table.js";

// ─── ROWS ───────────────────────────────────────────────────────────────────

function toRow(model) {
  return {
    id: model.id,
    name: model.name,
    team_name: model.team_name ?? null,
    created_at: model.created_at,
    n_submissions: model.n_submissions ?? 0,
    suites: model.task_suites
  };
}

// ─── COLUMNS ────────────────────────────────────────────────────────────────

function buildColumns() {
  return [
    {
      title: "Model",
      field: "name",
      formatter: linkFormatter(
        "/html/models/models.html",
        "name",
      ),
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

// ─── FILTERS ────────────────────────────────────────────────────────────────

function buildControls(rows) {
  return [
    {
      type: "search",
      name: "name",
      placeholder: "Search models...",
      match: matchIncludes("name"),
    },
    {
      type: "select",
      name: "team_name",
      placeholder: "All teams",
      options: optionsFromRows(rows, "team_name"),
      match: matchEquals("team_name"),
    },
    {
      type: "select",
      name: "suite",
      placeholder: "All suites",
      options: SUITE_OPTIONS,
      match: matchInArray("suites"),
    },
  ];
}

// ─── TABLE ─────────────────────────────────────────────────────────────

/**
 * Render a filterable models table.
 * /**
 *  * @param container   element, or the id of one. Its contents are replaced.
 *  * @param models list of models with taskSuites attached. Each model is mapped to a row with toRow().
 *  * @returns the Tabulator instance.
 *  */
function renderModelsTable({ container, models }) {
  const rows = models.map(toRow);

  return createFilterableTable({
    container,
    rows,
    columns: buildColumns(),
    controls: buildControls(rows),
    noun: "models",
    initialSort: [
      { column: "created_at", dir: "desc" },
    ],
    caller: "renderModelsTable",
  });
}

export { renderModelsTable, toRow };



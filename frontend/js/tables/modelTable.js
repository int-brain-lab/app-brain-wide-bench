// Filterable models table
//
// The table allows you to search by model name and filter by team or suite

import {
  SUITE_OPTIONS,
  createFilterableTable,
  previewRows,
  renderStaticTable,
  resolveContainer,
  matchEquals,
  matchInArray,
  matchIncludes,
  optionsFromRows,
} from "./table.js";
import {
  dateFormatter,
  dateSorter,
  metadataFormatter,
  modelNameFormatter,
  suiteBadgesFormatter,
} from "./formatters.js";


// ─── ROWS ───────────────────────────────────────────────────────────────────

function toModelRow(model) {
  return {
    id: model.id,
    name: model.name,
    team_name: model.team_name ?? null,
    created_at: model.created_at,
    n_submissions: model.n_submissions ?? 0,
    suites: model.task_suites,
    // Both carried so modelNameFormatter can put a pill beside the name; nothing filters
    // or sorts on either.
    is_pretrained: model.is_pretrained ?? null,
    is_mine: model.is_mine ?? false,
  };
}

function toModelRows(models) {
  return models.map(toModelRow);
}


// ─── COLUMNS ────────────────────────────────────────────────────────────────

// `showTeam` off drops the Team column, for a caller already scoped to one — a team's own
// page, where it would repeat the page's heading down every row.
//
// `showMine` on marks the rows on the viewer's own teams, for the public listing that mixes
// them with everyone else's. Off by default: on a listing that is all theirs it says nothing.
function getModelColumns({ showTeam = true, showMine = false } = {}) {
  const teamColumn = showTeam
    ? [{
        title: "Team",
        field: "team_name",
        formatter: metadataFormatter,
      }]
    : [];

  return [
    {
      title: "Model",
      field: "name",
      formatter: modelNameFormatter("/html/models/models.html", { showMine }),
      widthGrow: 2,
    },
    ...teamColumn,
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


// ─── CONTROLS ───────────────────────────────────────────────────────────────

function getModelControls(rows) {
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


// ─── TABLE ──────────────────────────────────────────────────────────────────

/**
 * @param container element, or the id of one. Its contents are replaced.
 * @param models    list of models with task suites attached, mapped to rows by toModelRows().
 * @param showMine  mark the rows on the viewer's own teams — see getModelColumns.
 * @returns the Tabulator instance.
 */
function renderModelsTable({ container, models, showMine = false }) {
  const rows = toModelRows(models);

  return createFilterableTable({
    container,
    rows,
    columns: getModelColumns({ showMine }),
    controls: getModelControls(rows),
    noun: "model",
    initialSort: [
      { column: "created_at", dir: "desc" },
    ],
    caller: "renderModelsTable",
  });
}


// ─── STATIC TABLE ───────────────────────────────────────────────────────────

/**
 * Plain-markup counterpart to renderModelsTable, for a fixed preview — no filters, no
 * paging, and no Tabulator needed on the page.
 *
 * @param container element, or the id of one. Its contents are replaced.
 * @param models    as renderModelsTable.
 * @param showTeam  keep the Team column. Pass false when every row is one team's.
 * @param limit     how many rows to show. Omit for all of them.
 * @param viewAll     as renderStaticTable — where the footer's "View all" link goes.
 * @returns every row it built, not just the slice it rendered. The total is already in
 *          the footer; this is for a caller that needs the rows themselves.
 */
function renderStaticModelsTable({ container, models, showTeam = true, limit, viewAll }) {
  const rows = toModelRows(models);

  const shown = previewRows(rows, (a, b) => dateSorter(b.created_at, a.created_at), limit);

  resolveContainer(container, "renderStaticModelsTable").innerHTML = renderStaticTable({
    columns: getModelColumns({ showTeam }),
    rows: shown,
    noun: "model",
    total: rows.length,
    viewAll,
  });

  return rows;
}


export { renderModelsTable, renderStaticModelsTable };



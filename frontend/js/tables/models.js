// Filterable models table: a name search plus a team select above a Tabulator
// grid. All the table plumbing lives in tables/utils.js — this module is just the
// rows, the columns and the two controls.
//
// The columns follow the table that buildModelTable rendered in
// js/models/list/list-view.js, which this replaces.

import { submissionSuites } from "../scores.js";
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
  sortSuites,
  suiteBadgesFormatter,
} from "./utils.js";


// ─── ROWS ───────────────────────────────────────────────────────────────────

// `task_suites` comes straight off ModelList, already visibility-scoped and already
// in suite order, and covers only suites with an actual score. The fallback derives
// the same thing from an embedded `submissions` list, so this also works when handed
// a model detail response — sortSuites because that path has no guaranteed order.
function modelSuites(model) {
  if (model.task_suites?.length) {
    return model.task_suites;
  }

  const submissions = model.submissions ?? [];

  return sortSuites([...new Set(submissions.flatMap(submissionSuites))]);
}

function toRow(model) {
  return {
    id: model.id,
    name: model.name,
    team_name: model.team_name ?? null,
    created_at: model.created_at,
    n_submissions: model.n_submissions ?? 0,
    suites: modelSuites(model),
  };
}


// ─── COLUMNS ────────────────────────────────────────────────────────────────

function getColumns() {
  return [
    {
      title: "Model",
      field: "name",
      formatter: linkFormatter("/html/models/model_dashboard.html", "name"),
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
      // Labelled "Created", not "Updated" as the old markup had it: ModelList
      // carries created_at only, and the previous table showed that value under
      // the wrong heading.
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

// Team options come from the rows rather than a fetch: the caller already has
// every model the user can see, so the teams present in that list are exactly the
// ones worth offering.
function getControls(rows) {
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


/**
 * @param container element, or the id of one. Its contents are replaced.
 * @param models   records from GET /api/users/me/models or GET /api/models.
 * @returns the Tabulator instance.
 */
function renderModelsTable({ container, models }) {
  const rows = models.map(toRow);

  return createFilterableTable({
    container,
    rows,
    columns: getColumns(),
    controls: getControls(rows),
    noun: "models",
    initialSort: [{ column: "created_at", dir: "desc" }],
    caller: "renderModelsTable",
  });
}


export { renderModelsTable, toRow };

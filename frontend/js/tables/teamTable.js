// Filterable teams table.
//
// The table allows you to search by team name and filter by your role on it.
//
// The columns only. Rows and filters are in utils/teamUtils.js, and the table
// infrastructure in table.js.

import { getTeamFilters } from "../utils/teamUtils.js";
import {
  buildStaticTable,
  createFilterableTable,
  previewRows,
} from "./table.js";
import { buildLinkFormatter, roleBadgeFormatter } from "./formatters.js";

// ─── COLUMNS ─────────────────────────────────────────────────────────────────

function getTeamColumns() {
  return [
    {
      title: "Team",
      field: "name",
      formatter: buildLinkFormatter("/html/teams/teams.html", "name"),
      widthGrow: 2,
    },
    {
      title: "Your role",
      field: "role",
      formatter: roleBadgeFormatter,
      width: 130,
    },
    {
      title: "Members",
      field: "n_members",
      width: 110,
    },
    {
      title: "Models",
      field: "n_models",
      width: 110,
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
 * The live teams table, filterable above the grid.
 *
 * @param rows        rows from toTeamRows.
 * @param showFilters keep the filter bar above the grid. False for a caller with a bar of
 *                    its own over both its views — see templates/listPage.js.
 *
 * @returns { element, table } — as createModelsTable; the caller mounts the element.
 */
function createTeamsTable({ rows, showFilters = true }) {
  return createFilterableTable({
    rows,
    columns: getTeamColumns(),
    controls: showFilters ? getTeamFilters(rows) : [],
    noun: "team",
    initialSort: [{ column: "name", dir: "asc" }],
  });
}

// ─── STATIC TABLE ────────────────────────────────────────────────────────────

/**
 * Plain-markup counterpart to createTeamsTable, for a fixed preview — no filters, no
 * paging, and no Tabulator needed on the page.
 *
 * @param rows    as createTeamsTable.
 * @param limit   how many rows to show. Omit for all of them.
 * @param viewAll as buildStaticTable — where the footer's "View all" link goes.
 *
 * @returns the markup.
 */
function buildStaticTeamsTable({ rows, limit, viewAll }) {
  const shown = previewRows(
    rows,
    (a, b) => String(a.name).localeCompare(b.name),
    limit,
  );

  return buildStaticTable({
    columns: getTeamColumns(),
    rows: shown,
    noun: "team",
    total: rows.length,
    viewAll,
  });
}

export { createTeamsTable, buildStaticTeamsTable };

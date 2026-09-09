// Filterable task-score table: one row per scored task, across however many submissions
// the caller passes in.
//
// The columns only. Rows and filters are in utils/taskScoreUtils.js, and the table
// infrastructure in table.js.

import { getTaskScoreFilters } from "../utils/taskScoreUtils.js";
import { buildStaticTable, createFilterableTable, previewRows } from "./table.js";
import {
  buildFlagFormatter,
  buildLinkFormatter,
  buildScoreSemFormatter,
  metricBadgeFormatter,
  numericSorter,
  parameterFormatter,
  rankingFlagFormatter,
  rankSorter,
  scoreBarFormatter,
  taskNameFormatter,
  taskRankFormatter,
} from "./formatters.js";
import { TASK_FIELDS, trainingFieldKeys } from "../schemas/taskSubmissionSchema.js";

// ─── COLUMNS ─────────────────────────────────────────────────────────────────

// The narrowest each kind of column may be drawn. The table fills the width it is given and
// shares out what is spare, so these are floors rather than sizes: below them the grid scrolls
// sideways instead of squeezing a name to nothing.
//
// A flagged column is a heading over a tick, so the heading is the whole of its width — and
// "Used in public ranking" is a long one, where a Tabulator header clips rather than wraps.
// A parameter is one word from an enum; a score is a mean over its spread with the metric
// badged beside it; a name is a model or a submission label, both of which run long but are
// read as metadata here. What is spare above the floors is shared equally — every column
// carries `widthGrow: 1` — so the floors are the whole of the balance between them.
const TASK_WIDTH = 120;
const SCORE_WIDTH = 130;
const FIELD_WIDTH = 120;
const NAME_WIDTH = 110;
const FLAG_WIDTH = 150;

// A bar is the one column with nothing to read in it, so it gives way first — but below
// this it is too short to compare one row against another.
const BAR_WIDTH = 120;

// `showSubmission` off drops the Submission column, for a caller already scoped to one
// submission — there it would repeat the page's own heading down every row.
//
// `showRanking` adds the column saying which rankings each score is carrying. Off by
// default: it needs rows stamped by markRankedRows, which only a page that has fetched the
// model's ranking can do.
function getScoreColumns({ showSubmission = true, showModel = false, showRanking = false } = {}) {
  const modelColumn = showModel
    ? [
        {
          title: "Model",
          field: "model_name",
          formatter: buildLinkFormatter(
            "/html/models/models.html",
            "model_name",
            "model_id",
            "metadata",
          ),
          widthGrow: 1,
          minWidth: NAME_WIDTH,
        },
      ]
    : [];

  const submissionColumn = showSubmission
    ? [
        {
          title: "Submission",
          field: "submission_label",
          formatter: buildLinkFormatter(
            "/html/submissions/submissions.html",
            "submission_label",
            "submission_id",
            "metadata",
          ),
          widthGrow: 1,
          minWidth: NAME_WIDTH,
        },
      ]
    : [];

  // Beside the score rather than at the end of the row: both say something about *this*
  // number — whether it is the one being ranked on, and whether it is the model's newest go
  // at that task. Unsorted, because the order they would impose — carrying both, one, neither
  // — is the one the reader is already scanning for.
  const rankingColumns = showRanking
    ? [
        {
          title: "Used in public ranking",
          field: "ranked",
          formatter: buildFlagFormatter(
            (row) => row.ranked?.public,
            "Counted in the public ranking",
          ),
          headerSort: false,
          hozAlign: "center",
          headerHozAlign: "center",
          widthGrow: 1,
          minWidth: FLAG_WIDTH,
        },
        {
          title: "Latest score",
          field: "ranked",
          formatter: buildFlagFormatter(
            (row) => row.ranked?.latest,
            "The model's newest score for this task",
          ),
          headerSort: false,
          hozAlign: "center",
          headerHozAlign: "center",
          widthGrow: 1,
          minWidth: FLAG_WIDTH,
        },
      ]
    : [];

  return [
    {
      // The suite reads in front of the short name — "TS1 Choice" — rather than in a column
      // of its own: it is a fact about the task, derived from its id (see toScoreRow), and a
      // column of it would repeat one word down a band of its own. `suite` stays a field on
      // the row either way, which is what the select above filters on.
      title: "Task",
      field: "task_name",
      formatter: taskNameFormatter,
      widthGrow: 1,
      minWidth: TASK_WIDTH,
    },
    {
      // Mean, sem and the metric all three in one cell — see buildScoreSemFormatter. The field
      // stays `mean_score` so the sort is on the number, not on the spread or the badge
      // printed beside it.
      //
      // The metric belongs here rather than in a column because a score without it is not
      // a figure a reader can use: 0.61 is good bacc and poor r2, and the two used to sit
      // at opposite ends of the row.
      title: "Score",
      field: "mean_score",
      formatter: buildScoreSemFormatter("sem", { metricField: "metric" }),
      sorter: numericSorter,
      widthGrow: 1,
      minWidth: SCORE_WIDTH,
    },
    ...rankingColumns,
    ...trainingFieldKeys().map((key) => ({
      title: TASK_FIELDS[key].label,
      field: key,
      formatter: parameterFormatter,
      // The multi-value fields hold arrays, which don't sort meaningfully, and the
      // rest are unordered enums — so no column here earns a sort.
      headerSort: false,
      widthGrow: 1,
      minWidth: FIELD_WIDTH,
    })),
    ...submissionColumn,
    ...modelColumn,
  ];
}

// ─── LATEST SCORES ───────────────────────────────────────────────────────────

// What a model currently stands on, one task at a time: the number, the same number as a
// mark, what it is measured in, where it places, and what it is doing.
//
// What every table of standing scores leads with: the task, the number, the number as a
// mark, and what it is measured in. What follows differs by what the page is asking — see
// the two column sets over it.
function standingColumns() {
  return [
    {
      title: "Task",
      field: "task_name",
      formatter: taskNameFormatter,
      widthGrow: 1,
      minWidth: TASK_WIDTH,
    },
    {
      // The mean over its spread. The metric has a column of its own here, so it is not
      // badged beside the number as it is on the fuller table.
      title: "Score",
      field: "mean_score",
      formatter: buildScoreSemFormatter("sem"),
      sorter: numericSorter,
      widthGrow: 1,
      minWidth: SCORE_WIDTH,
    },
    {
      // Read on 0 to 1 like every primary metric, so one row's bar is comparable with the
      // next even where the metrics are not.
      title: "",
      field: "mean_score",
      formatter: scoreBarFormatter,
      headerSort: false,
      widthGrow: 2,
      minWidth: BAR_WIDTH,
    },
    {
      title: "Metric",
      field: "metric",
      formatter: metricBadgeFormatter,
      headerSort: false,
      widthGrow: 1,
      minWidth: FIELD_WIDTH,
    },
  ];
}

// Its own column set rather than more flags on getScoreColumns above: that one describes a
// score among many for a task, and this one describes the only score a task has left.
function getLatestScoreColumns() {
  return [
    ...standingColumns(),
    {
      title: "Rank",
      field: "rank",
      formatter: taskRankFormatter,
      sorter: rankSorter,
      widthGrow: 1,
      minWidth: FIELD_WIDTH,
    },
    {
      // A tick where the board is standing on this score, an eye where it is not because
      // the run behind it is unpublished — see rankingFlagFormatter.
      title: "Used in public ranking",
      field: "ranked",
      formatter: rankingFlagFormatter,
      headerSort: false,
      hozAlign: "center",
      headerHozAlign: "center",
      widthGrow: 1,
      minWidth: FLAG_WIDTH,
    },
    {
      title: "Submission",
      field: "submission_label",
      formatter: buildLinkFormatter(
        "/html/submissions/submissions.html",
        "submission_label",
        "submission_id",
        "metadata",
      ),
      widthGrow: 1,
      minWidth: NAME_WIDTH,
    },
  ];
}

// The best of an account's own scores: the same four, then whose model and which run made
// each of them.
function getBestScoreColumns() {
  return [
    ...standingColumns(),
    {
      title: "Model",
      field: "model_name",
      formatter: buildLinkFormatter(
        "/html/models/models.html",
        "model_name",
        "model_id",
        "metadata",
      ),
      widthGrow: 1,
      minWidth: NAME_WIDTH,
    },
    {
      title: "Submission",
      field: "submission_label",
      formatter: buildLinkFormatter(
        "/html/submissions/submissions.html",
        "submission_label",
        "submission_id",
        "metadata",
      ),
      widthGrow: 1,
      minWidth: NAME_WIDTH,
    },
  ];
}

/**
 * The best score reached on each task, as plain markup.
 *
 * @param rows  from toBestScoreRows — one per task there is a best for.
 * @param total the scores those bests were picked out of, so the footer says how much was
 *              weighed: eleven bests out of eighty-one task scores. Omit for "11 out of 11",
 *              which is only ever true when every task has been scored once.
 *
 * @returns the markup.
 */
function buildBestScoresTable({ rows, total }) {
  return buildStaticTable({
    columns: getBestScoreColumns(),
    rows: [...rows].sort((a, b) => numericSorter(b.mean_score, a.mean_score)),
    noun: "task",
    total: total || rows.length,
  });
}

/**
 * The scores a model currently stands on, as plain markup.
 *
 * @param rows    score rows stamped by markRankedRows, already narrowed to the latest of
 *                each task — see renderScoresSection in pages/modelView.js.
 * @param limit   how many rows to show. Omit for all of them.
 *
 * @returns the markup.
 */
function buildLatestScoresTable({ rows, limit }) {
  const shown = previewRows(rows, (a, b) => numericSorter(b.mean_score, a.mean_score), limit);

  return buildStaticTable({
    columns: getLatestScoreColumns(),
    rows: shown,
    noun: "task",
    total: rows.length,
  });
}

// ─── TABLE ───────────────────────────────────────────────────────────────────

/**
 * The live task-scores table, filterable above the grid.
 *
 * @param rows           rows from toScoreRows (records nesting their tasks) or
 *                       toScoreResultRows (already-flat task submissions).
 * @param showSubmission keep the Submission column and its filter. Pass false when every
 *                       row belongs to the same submission.
 * @param showModel      add the Model column and its filter. For rows spanning models.
 * @param showRanking    add the "Used in ranking" column. Rows must be stamped by
 *                       markRankedRows first — see getScoreColumns.
 * @param showFilters    keep the filter bar above the grid. False for a caller with a bar
 *                       of its own — see templates/listView.js.
 * @param selection      as createFilterableTable. What is picked is shown by highlighting
 *                       the row, one or several, rather than by a column of checkboxes.
 *
 * @returns { element, table } — the caller mounts the element.
 */
function createTaskScoresTable({
  rows,
  showSubmission = true,
  showModel = false,
  showRanking = false,
  showFilters = true,
  selection,
}) {
  const shown = { showSubmission, showModel, showRanking };

  return createFilterableTable({
    rows,
    columns: getScoreColumns(shown),
    controls: showFilters ? getTaskScoreFilters(rows, shown) : [],
    noun: "task",
    initialSort: [{ column: "mean_score", dir: "desc" }],
    index: "id",

    // Fills the page rather than sizing to its contents: a score table is a row of short
    // values, which left to themselves huddle at one end of the width they are given.
    layout: "fitColumns",
    selection,
    paginationSize: 8,
  });
}

export { buildBestScoresTable, buildLatestScoresTable, createTaskScoresTable };

// One card per task, for every table that reads a task a row at a time.
//
// The core is what standingColumns() leads each of those tables with — the task, the score as
// a number, the metric, the score as a bar. Everything a particular table adds is a slot here:
// the rank, schema fields, flags, the records the score came from, a per-row action.
//
// Built from a task row — toScoreRow in utils/taskScoreUtils.js, or toTaskSubmissionRows in
// utils/taskSubmissionUtils.js. The grid is cards/cardGrid.js.

import { hrefForRecord } from "../core/links.js";
import { taskFullLabel } from "../core/suites.js";
import { escapeHtml } from "../core/html.js";
import { TASK_FIELDS, trainingFieldKeys } from "../schemas/taskSubmissionSchema.js";
import { displayValue } from "../forms/fields.js";
import { numericSorter } from "../tables/formatters.js";
import { previewRows } from "../tables/table.js";
import { buildMetricBadge, buildTaskBadge } from "../components/badges.js";
import { buildScoreBar } from "../components/bars.js";
import { buildButton } from "../components/buttons.js";
import { buildIcon, getIcon } from "../components/icons.js";
import { toGridAttrs } from "../components/layout.js";
import { buildMeanSem, emptyMetadata } from "../components/scores.js";
import { createCardGrid } from "./cardGrid.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const MODEL_PAGE = "/html/models/models.html";
const SUBMISSION_PAGE = "/html/submissions/submissions.html";

// The two methodology fields a score is read with. The rest are filters over the list.
const SCORE_FIELDS = ["training_paradigm", "supervision_regime"];

// `unpublished` marks the flag that has a second answer: not ranked *because* nothing was
// published, which `is_public` tells apart from not ranked at all.
const RANKING_FLAG = {
  label: "Used in public ranking",
  read: (row) => row.ranked?.public,
  unpublished: true,
};

const LATEST_SCORE_FLAG = { label: "Latest score", read: (row) => row.ranked?.latest };

const LATEST_ENTRY_FLAG = { label: "Latest entry", read: (row) => row.latest };

// Where a link goes, by the name a caller asks for it by. The order is the order they are
// drawn in, which is fixed: the model at the near end of the card's foot, the run at the far.
const LINKS = {
  model: { page: MODEL_PAGE, id: "model_id", label: "model_name" },
  submission: { page: SUBMISSION_PAGE, id: "submission_id", label: "submission_label" },
};

// ─── ROWS ────────────────────────────────────────────────────────────────────

// A name against a value, which is the shape the score line above them already has.
function buildRow(label, value) {
  return `
    <div class="row gap-md">
      <span class="metadata">${escapeHtml(label)}</span>
      ${value}
    </div>
  `;
}

function buildValue(text) {
  return text == null || text === ""
    ? emptyMetadata()
    : `<span class="metadata bold">${escapeHtml(String(text))}</span>`;
}

// Through displayValue, so an enum reads as its own option — "single session".
function buildField(row, key) {
  const field = TASK_FIELDS[key];

  return buildRow(field.label, buildValue(displayValue(field, row[key])));
}

function buildFlag(row, flag) {
  if (flag.read(row)) {
    return buildRow(flag.label, buildIcon("tick", { className: "tick-icon", title: flag.label }));
  }

  if (flag.unpublished && row.is_public === false) {
    return buildRow(
      flag.label,
      buildIcon("private", { title: "Not published, so not counted in the public ranking" }),
    );
  }

  return buildRow(flag.label, emptyMetadata());
}

// The row's own task, routed in place — the same trip editFormatter writes for the table.
function buildEditAction(row) {
  return buildButton({
    label: "Edit",
    icon: getIcon("edit"),
    view: "task",
    data: { task: row.id },
    className: "sm",
  });
}

function buildLink(row, name) {
  const { page, id, label } = LINKS[name];

  if (!row[label]) return "";

  return `
    <a class="metadata bold" href="${hrefForRecord(page, row[id], { mine: row.is_mine })}">
      ${escapeHtml(row[label])}
    </a>
  `;
}

// The records a score came from, across the foot of the card. An empty slot rather than a
// missing one, so whichever is there keeps its own end of the row.
function buildLinks(row, names) {
  if (!names.length) return "";

  const slots = Object.keys(LINKS).map(
    (name) => (names.includes(name) && buildLink(row, name)) || "<span></span>",
  );

  return `<div class="row gap-md">${slots.join("")}</div>`;
}

// ─── MARKUP ──────────────────────────────────────────────────────────────────

// `row left` because a badge is inline-flex, and the card is a stretching column. The rank
// takes the other end, in the shape taskRankFormatter gives it.
function buildHeading(row, rank) {
  const place =
    rank && row.rank != null
      ? `<span class="row left gap-sm">
           <span class="bold">#${escapeHtml(String(row.rank))}</span>
           <span class="metadata">of ${escapeHtml(String(row.nRanked))}</span>
         </span>`
      : "";

  return `
    <div class="row${place ? "" : " left"}">
      ${buildTaskBadge(taskFullLabel(row.task_id), row.suite, "sm")}
      ${place}
    </div>
  `;
}

// buildMeanSem returns two elements where there is a spread; wrapped, a space-between row
// would push the mean and its ± to opposite ends.
//
// The column is not `left`: `.bar-track` is `flex: 1`, which a flex-start cross axis resolves
// to no width at all.
function buildScore(row) {
  return `
    <div class="column gap-xs">
      <div class="row gap-md">
        <span>${buildMeanSem(row.mean_score, row.sem)}</span>
        ${row.metric ? buildMetricBadge(row.metric, "sm") : ""}
      </div>

      ${buildScoreBar(row.mean_score, row.suite ?? "")}
    </div>
  `;
}

// Ruled off from the score above, and only where the caller asked for something to put there.
function buildDetail(rows) {
  const held = rows.filter(Boolean);

  if (!held.length) return "";

  return `
    <div class="column gap-xs">
      <hr class="rule" />
      ${held.join("")}
    </div>
  `;
}

/**
 * One task as a card.
 *
 * @param row     a task row.
 * @param score   the number, the metric and the bar. False for a card about how a task was
 *                run rather than what it reached — see createTaskSubmissionsTable's showScore.
 * @param rank    the task's place beside its name. Omit for a row with no ranking.
 * @param fields  TASK_FIELDS keys, drawn as label and value. Omit for none.
 * @param flags   flag descriptors — see RANKING_FLAG. Omit for none.
 * @param links   which of "model" and "submission" to name at the foot. Omit for neither.
 * @param actions (row) => markup under the card. Omit for a card nothing is done to.
 *
 * @returns the markup. A direct child of the grid, which writes the key onto it.
 */
function buildTaskCard(
  row,
  { score = true, rank = false, fields = [], flags = [], links = [], actions = null } = {},
) {
  return `
    <div class="card column gap-lg">
      ${buildHeading(row, rank)}
      ${score ? buildScore(row) : ""}

      ${buildDetail([
        ...fields.map((key) => buildField(row, key)),
        ...flags.map((flag) => buildFlag(row, flag)),
      ])}

      ${buildLinks(row, links)}

      ${actions ? `<div class="row right">${actions(row)}</div>` : ""}
    </div>
  `;
}

/**
 * A run of them in a grid, for a caller writing markup into a section.
 *
 * @param rows    the task rows.
 * @param options as buildTaskCard, applied to every card.
 *
 * @returns the markup.
 */
function buildTaskCards(rows, options) {
  return `
    <div class="grid card-grid" ${toGridAttrs({ cols: 2 })}>
      ${rows.map((row) => buildTaskCard(row, options)).join("")}
    </div>
  `;
}

// ─── VARIANTS ────────────────────────────────────────────────────────────────
//
// One per task table — see the column sets in tables/taskScoreTable.js and
// tables/taskSubmissionTable.js, which these stand in for. Each sorts and limits as its own
// table does: a section swapping between the two at CARDS_QUERY must not reorder what it
// holds.

const byScore = (a, b) => numericSorter(b.mean_score, a.mean_score);

const byTask = (a, b) => String(a.task_id).localeCompare(b.task_id);

// buildBestScoresTable: whose model and which run reached each best.
function buildBestTaskCards(rows) {
  return buildTaskCards([...rows].sort(byScore), { links: ["model", "submission"] });
}

// buildLatestScoresTable: where the model places, and whether the board stands on it.
function buildLatestTaskCards(rows, { limit } = {}) {
  return buildTaskCards(previewRows(rows, byScore, limit), {
    rank: true,
    flags: [RANKING_FLAG],
    links: ["submission"],
  });
}

// buildSubmissionScoresTable: one submission's scores, and whether each is still its entry.
function buildSubmissionScoreCards(rows) {
  return buildTaskCards([...rows].sort(byScore), { flags: [LATEST_ENTRY_FLAG] });
}

// buildStaticTaskSubmissionsTable: every methodology field, which is what that table is for.
function buildTaskSubmissionCards(rows, { showEdit = false, showScore = true, limit } = {}) {
  return buildTaskCards(previewRows(rows, byTask, limit), {
    score: showScore,
    fields: trainingFieldKeys(),
    actions: showEdit ? buildEditAction : null,
  });
}

// ─── GRIDS ───────────────────────────────────────────────────────────────────

/**
 * The task-score card grid, built once and kept — createTaskScoresTable's counterpart. Takes
 * that table's own display flags, so a page hands both the same object.
 *
 * @param showSubmission the run the score came from.
 * @param showModel      the model it came from. For rows spanning models.
 * @param showRanking    the ranking flags, for rows stamped by markRankedRows.
 * @param options        the rest, as createCardGrid.
 *
 * @returns as createCardGrid.
 */
function createTaskScoreCardGrid({
  showSubmission = true,
  showModel = false,
  showRanking = false,
  ...options
} = {}) {
  const cardOptions = {
    fields: SCORE_FIELDS,
    flags: showRanking ? [RANKING_FLAG, LATEST_SCORE_FLAG] : [],
    links: [showModel ? "model" : "", showSubmission ? "submission" : ""].filter(Boolean),
  };

  return createCardGrid({
    buildCards: (rows) => rows.map((row) => buildTaskCard(row, cardOptions)).join(""),
    noun: "score",

    ...options,
  });
}

/**
 * The task-submission card grid — createTaskSubmissionsTable's counterpart.
 *
 * @param showEdit  the way to the task's own editor, under each card.
 * @param showScore the score. False where the card is about how the task was run.
 * @param options   the rest, as createCardGrid.
 *
 * @returns as createCardGrid.
 */
function createTaskSubmissionCardGrid({ showEdit = false, showScore = true, ...options } = {}) {
  const cardOptions = {
    score: showScore,
    fields: trainingFieldKeys(),
    actions: showEdit ? buildEditAction : null,
  };

  return createCardGrid({
    buildCards: (rows) => rows.map((row) => buildTaskCard(row, cardOptions)).join(""),
    noun: "task",

    ...options,
  });
}

export {
  buildBestTaskCards,
  buildLatestTaskCards,
  buildSubmissionScoreCards,
  buildTaskCard,
  buildTaskCards,
  buildTaskSubmissionCards,
  createTaskScoreCardGrid,
  createTaskSubmissionCardGrid,
};

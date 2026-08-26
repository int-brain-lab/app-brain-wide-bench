// The task-scores table and whatever the reader wants to do with a row, on one page.
//
// Two modes, one table:
//
//   browse    click a row and its breakdown opens underneath — every recording the score
//             was measured on, which used to be a page of its own
//   compare   several rows at a time, side by side
//
// Both halves are widgets of their own — taskBreakdown.js and taskComparison.js — because
// the leaderboard drives the same two things from a different table. What is left here is
// the table, the mode switch, and turning a row into what those two take.
//
// The detail sits under the table in both modes. A row is a number in a table; what it
// means is the thing underneath, and sending the reader to another page to see it loses
// the table they were reading it against.

import { escapeHtml, refreshIcons } from "../core/utils.js";
import { getIcon } from "../components/icons.js";
import { resolveContainer } from "../tables/table.js";
import { renderTaskScoresTable } from "../tables/scoreTable.js";
import { MAX_COMPARED, createTaskComparison } from "./taskComparison.js";
import { createTaskBreakdown } from "./taskBreakdown.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const BROWSE_PROMPT =
  "Select a task score in the table to see how it was measured.";

// ─── DATA ───────────────────────────────────────────────────────────────────

// What either widget needs to start on a row: the rest — the breakdown, the methodology —
// each fetches for itself.
function toSeed(row) {
  return {
    key: row.id,
    taskId: row.task_id,
    submissionId: row.submission_id,
    submissionLabel: row.submission_label,
    modelName: row.model_name,
    metric: row.metric,
  };
}

// ─── MARKUP ─────────────────────────────────────────────────────────────────

function buildToolbar(comparing) {
  return `
    <div class="row right gap-md">
      <button type="button" class="btn with-icon ${comparing ? "primary-inv" : ""}" data-role="mode">
        <i class="btn-icon" data-lucide="${escapeHtml(getIcon("compare"))}"></i>
        ${comparing ? "Done comparing" : "Compare tasks"}
      </button>
    </div>`;
}

function buildShell() {
  return `
    <div class="column gap-md">
      <div data-role="toolbar"></div>
      <div data-role="table"></div>
      <div class="column gap-md" data-role="detail"></div>
    </div>`;
}

// ─── WIDGET ─────────────────────────────────────────────────────────────────

/**
 * @param container  element, or the id of one. Its contents are replaced.
 * @param rows       score rows — from toScoreRows or toScoreResultRows.
 * @param showModel  add the Model column, for rows spanning models.
 * @param showRanking add the "Used in ranking" column. Rows must be stamped first.
 * @returns nothing: the widget owns its table, and there is no second caller to hand it to.
 */
function renderTaskScoreExplorer({
  container,
  rows,
  showModel = false,
  showRanking = false,
}) {
  const root = resolveContainer(container, "renderTaskScoreExplorer");

  root.innerHTML = buildShell();

  const toolbar = root.querySelector("[data-role='toolbar']");
  const tableSlot = root.querySelector("[data-role='table']");
  const detail = root.querySelector("[data-role='detail']");

  let comparing = false;
  let table = null;

  // Both built on first use and kept: each holds the reader's choice of view and whatever
  // it has already fetched, which rebuilding per selection would throw away.
  let breakdown = null;
  let comparison = null;

  function breakdownFor() {
    breakdown ??= createTaskBreakdown({
      container: detail,
      prompt: BROWSE_PROMPT,
    });

    return breakdown;
  }

  // The comparison's remove button reaches back into the table, since that is where the
  // selection lives.
  function comparisonFor() {
    comparison ??= createTaskComparison({
      container: detail,
      onDrop: (key) => table?.deselectRow(key),
    });

    return comparison;
  }

  async function onSelection(selectedRows) {
    const overflow = await comparisonFor().show(selectedRows.map(toSeed));

    // Tabulator caps selection by click, not by selectRow — and a click past the cap is
    // refused silently. Putting the extras back is what keeps the ticks and the rows of the
    // grid saying the same thing; the pass this triggers finds nothing left to do.
    for (const key of overflow) table?.deselectRow(key);
  }

  // ── the table, which is a different table in each mode ──

  // One row at a time in browse mode, six in compare. Selection either way, and shown the
  // same way in both: the row picked is the row highlighted, which is the only thing on
  // screen saying which row the breakdown below belongs to.
  function onBrowse(selectedRows) {
    if (selectedRows.length) breakdownFor().show(toSeed(selectedRows[0]));
    else breakdownFor().clear();
  }

  function renderTable() {
    table = renderTaskScoresTable({
      container: tableSlot,
      rows,
      showModel,
      showRanking,
      showSubmission: true,
      // The task name links away to the submission's own breakdown. Here that breakdown is
      // a row click away, so the link would be a second answer to the same question.
      showTaskLink: false,
      selection: {
        max: comparing ? MAX_COMPARED : 1,
        onChange: comparing ? onSelection : onBrowse,
        // Only while comparing: there the row is the control and a link would cost the
        // reader the comparison, where in browse mode the Model and Submission links are
        // the only way to the pages behind the row.
        claimLinks: comparing,
      },
    });
  }

  function setMode(next) {
    comparing = next;

    toolbar.innerHTML = buildToolbar(comparing);
    refreshIcons();

    renderTable();

    // Emptied rather than destroyed: a reader who switches away and back keeps the view
    // they had chosen and the details already fetched. Whichever one is now in charge is
    // also what puts its own prompt on screen, since the wording is its own.
    (comparing ? comparisonFor() : breakdownFor()).clear();
  }

  toolbar.addEventListener("click", (event) => {
    if (event.target.closest("[data-role='mode']")) setMode(!comparing);
  });

  setMode(false);
}

export { renderTaskScoreExplorer };

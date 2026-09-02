// One model on its own: what it is, how each of its tasks was done, and how they scored.
//
//   specification  the model's own fields, and the way through to its full page
//   methodology    one row per task, one column per training field, the metric first
//   task scores    the same bars the model comparison draws, for a field of one
//
// The pick, the fetch and the ✕ are comparison.js; this supplies its `render`. It holds one
// model at a time, so a host binds it with `rolling`: clicking another row replaces what is
// shown rather than being refused.
//
// Which entries it describes is the host's to say. A host holding scores already — a
// leaderboard row names the entries it ranked — puts their ids on the entry, and this asks
// about those; one that has only a model lets the server pick the newest per task.

import { escapeHtml } from "../core/html.js";
import { disposeAll } from "../core/disposable.js";
import { resolveContainer } from "../core/dom.js";
import { renderHtml } from "../core/render.js";
import { suiteFromTask, taskLabel } from "../core/suites.js";
import { buildSuiteBadgeList } from "../components/badges.js";
import { buildComparisonGrid } from "../components/comparisonGrid.js";
import { buildEmptyMessage } from "../components/messages.js";
import {
  methodologyCells,
  methodologyColumns,
} from "../components/methodologyGrid.js";
import { buildSections } from "../components/sections.js";
import { buildDisplayFields } from "../forms/fields.js";
import { loadModelBreakdown } from "../api/modelApi.js";
import { createModelPlots } from "../plots/modelPlots.js";
import { SERIES_COLOURS } from "../plots/palette.js";
import { MODEL_FIELDS } from "../schemas/modelSchema.js";
import { fieldsForPanel } from "../schemas/schemaPanels.js";
import { TASK_FIELDS } from "../schemas/taskSubmissionSchema.js";
import { compareTasks, scoreMode, toCompareEntry } from "./compareData.js";
import { createComparison } from "./comparison.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// A section is found by document id, and a page showing this beside a model comparison has
// both in the DOM at once — so these are the breakdown's own names, not "summary" and
// "breakdown", which modelComparison owns.
const SPEC_SECTION = "model-specification";
const METHODOLOGY_SECTION = "model-methodology";
const SCORES_SECTION = "model-task-scores";

// ─── ENTRIES ─────────────────────────────────────────────────────────────────

// For a host whose rows came from toModelRows. A host holding scores passes its own, with
// the ids of the entries those scores came from.
function toModelEntry(row) {
  return {
    key: row.id,
    modelId: row.id,
    name: row.name,
    teamName: row.team_name,
  };
}

// ─── SPECIFICATION ───────────────────────────────────────────────────────────

// Every specification field, not the editable ones: this is a reading of the model, so a
// field the reader could never set still says something about it.
function buildSpecification(model) {
  const keys = fieldsForPanel(MODEL_FIELDS, "specification", false);

  return `
    <div class="grid-2">
      ${buildDisplayFields(keys, model, MODEL_FIELDS)}
    </div>
    <a class="link" href="/html/models/models.html?id=${escapeHtml(model.id)}">
      View full model →
    </a>`;
}

// ─── METHODOLOGY ─────────────────────────────────────────────────────────────

// Which task this row is. The suite is a badge rather than the first four characters of the
// id, so the name beside it is only what distinguishes one task from another.
function buildTaskHeader(taskId) {
  const suite = suiteFromTask(taskId);

  return `
    <span class="row left gap-sm">
      <span class="label">${escapeHtml(taskLabel(taskId))}</span>
      ${suite ? buildSuiteBadgeList([suite], "sm") : ""}
    </span>`;
}

// Rows are tasks here, where the task comparison's are scores — so no ✕ and no ink: there
// is one model, and a task is not something the reader picked or can drop. Which also means
// the header is written here rather than by buildRowHeader, whose own always carries one.
//
// By task id, so the suites read in order and a reader comparing this against the board
// above finds the rows in the same sequence.
function buildMethodology(tasks) {
  return buildComparisonGrid({
    columns: methodologyColumns(TASK_FIELDS),
    rows: Object.keys(tasks)
      .sort()
      .map((taskId) => ({
        key: taskId,
        header: buildTaskHeader(taskId),
        cells: methodologyCells({
          record: tasks[taskId],
          fields: TASK_FIELDS,
          // A reading, not the control the task comparison puts here: a breakdown draws
          // each task in the metric it was ranked on, which is not the reader's to choose.
          metricCell: { value: tasks[taskId].metric ?? "" },
        }),
      })),
  });
}

// ─── WIDGET ──────────────────────────────────────────────────────────────────

/**
 * @param container as createComparison.
 * @param toEntry   (row) => { key, modelId, name, teamName, taskSubmissionIds? }. The ids
 *                  are optional: with them the breakdown describes those entries, without
 *                  them the newest scored entry per task. See loadModelBreakdown.
 */
function createModelBreakdown({ container, ...options }) {
  let comparison = null;

  let charts = [];

  // The container, once, so the sections below can be found inside it.
  let root = null;

  // Found within the container rather than by document id, which is how modelComparison and
  // taskScoreComparison reach theirs. A host may build this while its own tree is still
  // detached — listView creates its default panel before the caller places the list — and
  // document.getElementById finds nothing in a tree that is not in the document yet.
  function section(id) {
    return root.querySelector(`#section-${id}`);
  }

  function sectionBody(id) {
    return root.querySelector(`#section-${id}-body`);
  }

  // Before every render, the empty one included — which is the only reason the two sections
  // below the specification are hidden here rather than where they are drawn: dropping the
  // last pick leaves the prompt alone, with no stale grid or plot under it.
  function clearUp() {
    disposeAll(charts);
    charts = [];

    section(METHODOLOGY_SECTION).hidden = true;
    section(SCORES_SECTION).hidden = true;
  }

  // ─── RENDER ────────────────────────────────────────────────────────────────

  function renderScores(entry, tasks, colour) {
    const compared = { ...toCompareEntry(entry, tasks), colour };
    const axis = compareTasks([compared]);

    if (!axis.length) {
      section(SCORES_SECTION).hidden = true;

      return;
    }

    section(SCORES_SECTION).hidden = false;

    const plots = createModelPlots({
      entries: [compared],
      tasks: axis,
      mode: scoreMode(),
    });

    sectionBody(SCORES_SECTION).replaceChildren(plots.element);
    charts = plots.charts;
  }

  // The one entry, or nothing: the cap is one, so `entries()` holds at most a single model.
  // Its breakdown is absent until the request lands, which shows as the specification alone
  // — the fields it was picked with — rather than as an empty panel.
  function renderSections() {
    clearUp();

    const [entry] = comparison.entries();
    const breakdown = entry?.detail;

    renderHtml(
      sectionBody(SPEC_SECTION),
      breakdown
        ? buildSpecification(breakdown)
        : buildEmptyMessage("Loading the model…"),
    );

    const tasks = breakdown?.tasks ?? {};

    const scored = Object.keys(tasks).length > 0;

    section(METHODOLOGY_SECTION).hidden = !scored;

    if (scored) {
      renderHtml(sectionBody(METHODOLOGY_SECTION), buildMethodology(tasks));
    }

    renderScores(entry, tasks, comparison.colourOf(entry.key));
  }

  function setup() {
    root = resolveContainer(container);

    renderHtml(
      root,
      buildSections([
        { id: SPEC_SECTION },
        { id: METHODOLOGY_SECTION, title: "Task methodology", hidden: true },
        { id: SCORES_SECTION, title: "Scores across tasks", hidden: true },
      ]),
    );

    comparison = createComparison({
      container: sectionBody(SPEC_SECTION),
      max: 1,
      // Picking another model replaces the one shown rather than being refused — which is
      // what a panel showing one at a time has to do, and what makes it work from the cards
      // as well as from the table.
      rolling: true,
      prompt: "Select a model to break it down.",

      // One colour, so the bars have one and the row the model was picked in is edged in it
      // — the same arrangement as the comparisons, for a selection of one.
      palette: SERIES_COLOURS.slice(0, 1),

      loadDetail: (entry) =>
        loadModelBreakdown(entry.modelId, {
          taskSubmissionIds: entry.taskSubmissionIds,
        }),

      // The model, not the row: two board rows can name one model.
      cacheKey: (entry) => entry.modelId,

      toEntry: toModelEntry,
      render: renderSections,
      clearUp,

      ...options,
    });

    return comparison;
  }

  // Eagerly, because a host binds its table to the controller the moment it has one.
  return setup();
}

export { createModelBreakdown };

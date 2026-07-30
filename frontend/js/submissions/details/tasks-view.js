// Tasks tab rendering: one card per task submission. Pure view — no state and
// no listeners. A card renders read-only, or as a form when handed a draft; the
// editing state that decides which lives in ../edit/task-edit.js.

import { escapeHtml, renderMessage } from "../../utils.js";
import { renderDisplayFields, renderFields } from "../../utils/form-fields.js";
import { TASK_FIELDS, trainingFieldKeys } from "../../tasks/schema.js";
import { suiteOf } from "../../scores.js";


// ─── DOM ────────────────────────────────────────────────────────────────────

function taskCardList() {
  return document.getElementById("task-card-list");
}

function taskCardCount() {
  return document.getElementById("task-card-count");
}

// Found by comparing dataset rather than interpolating an id into an attribute
// selector — same reason as tasks/tasks-view.js.
function taskCardElement(taskSubmissionId) {
  return [...taskCardList().querySelectorAll(".task-card")]
    .find(card => card.dataset.ts === taskSubmissionId);
}


// ─── BUILDERS ───────────────────────────────────────────────────────────────

function scoreLabel(record) {
  const mean = record.score?.primary_metric_mean;
  return mean == null ? "Not scored" : mean.toFixed(3);
}

function buildButtons(record, isEditing) {
  const id = escapeHtml(record.id);

  if (isEditing) {
    return `
      <span class="btn primary task-save" data-ts="${id}">Save</span>
      <span class="btn task-cancel" data-ts="${id}">Cancel</span>
    `;
  }

  return `<span class="btn task-edit" data-ts="${id}">Edit</span>`;
}

// `draft` null → read-only card; a draft → the same card as an editable form.
function buildTaskCard(record, draft = null) {
  const isEditing = draft !== null;
  const suite = suiteOf(record.task_id);
  const keys = trainingFieldKeys();

  return `
    <div class="card secondary column gap-md task-card" data-ts="${escapeHtml(record.id)}">
      <div class="row">
        <span class="row left gap-md">
          <span class="badge ${escapeHtml(suite)}">${escapeHtml(suite.toUpperCase())}</span>
          <span class="label">${escapeHtml(record.task_id)}</span>
        </span>
        <span class="row right gap-md">
          <span class="label muted">${escapeHtml(scoreLabel(record))}</span>
          ${buildButtons(record, isEditing)}
        </span>
      </div>

      <div class="grid">
        ${isEditing
          ? renderFields(keys, draft, TASK_FIELDS)
          : renderDisplayFields(keys, record, TASK_FIELDS)}
      </div>
    </div>
  `;
}


// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderTasksTab(taskSubmissions) {
  taskCardCount().textContent =
    `${taskSubmissions.length} task${taskSubmissions.length === 1 ? "" : "s"}`;

  if (!taskSubmissions.length) {
    renderMessage(taskCardList(), "This submission has no tasks.");
    return;
  }

  taskCardList().innerHTML = taskSubmissions.map(record => buildTaskCard(record)).join("");
}

// Swaps a single card in place. Safe with delegated listeners, which sit on the
// container rather than on the cards themselves.
function renderTaskCard(record, draft = null) {
  const element = taskCardElement(record.id);

  if (!element) return;

  element.outerHTML = buildTaskCard(record, draft);
}


export { renderTasksTab, renderTaskCard, taskCardList };

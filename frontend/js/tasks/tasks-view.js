import { escapeHtml, renderMessage } from "../utils.js";
import { buildTaskRow } from "./task-view.js";

// ─── DOM ────────────────────────────────────────────────────────────────────

function taskInfo() {
  return document.getElementById("task-info");
}

function taskCount() {
  return document.getElementById("task-count");
}

function taskList() {
  return document.getElementById("task-list");
}


// ─── DETECTED TASKS ─────────────────────────────────────────────────────────

// taskId comes from the dropped zip's folder names — see task-view.js.
function buildTaskPill(collection, taskId) {
  return `<span class="badge ${collection.isValid(taskId) ? "success" : "error"}">${escapeHtml(taskId)}</span>`;
}

// Only called once a file has actually been read (see tasks.js's
// applyDetectedTasks), so there's always a file — no empty state to handle.
function renderDetectedTasks(collection, taskIds) {
  const info = taskInfo();

  if (!taskIds.length) {
    renderMessage(info, "No tasks detected — add them manually in the next step.");
    return;
  }

  info.hidden = false;
  info.className = "card";

  const pills = taskIds.map(taskId => buildTaskPill(collection, taskId)).join("");

  info.innerHTML = `
    <div class="column gap-md">
      <div class="info-msg">
        Detected ${taskIds.length}
        task${taskIds.length === 1 ? "" : "s"} in this file
      </div>

      <div class="row left gap-sm">
        ${pills}
      </div>

    </div>
  `;
}


// ─── TASK LIST ──────────────────────────────────────────────────────────────

function renderTaskList(collection, expandedTaskId) {
  const taskIds = collection.ids();

  taskCount().textContent = `Detected tasks (${taskIds.length})`;

  if (!taskIds.length) {
    renderMessage(taskList(), "No tasks yet — use “Add missing task” to add one.", "task-empty");
    return;
  }

  taskList().innerHTML = taskIds
    .map(taskId => buildTaskRow(collection, expandedTaskId, taskId))
    .join("");
}

// Matched by comparing `dataset.task` rather than interpolating taskId into an
// attribute selector: a zip-derived id containing a quote would otherwise build
// a malformed selector and throw (CSS injection, not HTML injection — escapeHtml
// is the wrong tool for it, so avoid the selector entirely).
function updateTaskRow(collection, expandedTaskId, taskId) {
  const existing = [...taskList().querySelectorAll(".task-row")]
    .find(row => row.dataset.task === taskId);

  if (!existing) {
    return;
  }
  existing.outerHTML = buildTaskRow(collection, expandedTaskId, taskId);
}

export {
  renderDetectedTasks,
  renderTaskList,
  updateTaskRow,
};

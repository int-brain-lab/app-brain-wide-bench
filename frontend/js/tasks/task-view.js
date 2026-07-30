import { renderFields, fieldsForPanel } from "../utils/form-fields.js";
import { TASK_FIELDS } from "./schema.js";
import { escapeHtml } from "../utils.js";

// Task ids reach here from `inferTasks` over the *folder names inside a dropped
// zip*, so they are entirely user-controlled — not a server whitelist. Every
// interpolation of a taskId below is escaped, including the `data-task` /
// `id` attributes the click handlers read back.

// ─── INDIVIDUAL TASK ────────────────────────────────────────────────────────

function buildTaskStatus(collection, taskId) {
  if (!collection.isValid(taskId)) {
    return `<span class="task-status bad">✗</span>`;
  }

  if (collection.get(taskId).isConfirmed()) {
    return `<span class="task-status ok">✓</span>`;
  }

  return `<span class="task-status pending"></span>`;
}

function buildNewBadge(task) {
  if (!task.isNew) {
    return "";
  }

  return `
    <span class="badge success">
      New
    </span>
  `;
}

// A field can get silently cleared by revalidation (see form-fields.js's
// revalidateFields) when something it depends on changes — this surfaces
// which ones, using the schema's own labels, instead of a value just
// vanishing with no explanation.
function buildClearedNotice(task) {
  const cleared = task.clearedFields();
  if (!cleared.length) return "";

  const labels = cleared.map(key => TASK_FIELDS[key].label).join(", ");
  return `<p class="info-msg">Cleared (no longer valid): ${escapeHtml(labels)}</p>`;
}

function buildValidTask(collection, taskId) {
  const task = collection.get(taskId);

  return `
    ${buildClearedNotice(task)}

    <div class="grid">
      ${renderFields(fieldsForPanel(TASK_FIELDS, 1), task.state, TASK_FIELDS)}
    </div>

    <div class="row">
      <div class="row left gap-sm">
        <label class="label" for="task-confirm-${escapeHtml(taskId)}">Confirm this task</label>
        <input class="input-checkbox task-confirm" id="task-confirm-${escapeHtml(taskId)}" type="checkbox" data-task="${escapeHtml(taskId)}" ${task.isConfirmed() ? "checked" : ""}/>
      </div>
      <button type="button" class="btn task-remove" data-task="${escapeHtml(taskId)}"> Remove </button>
    </div>
  `;
}

function buildTaskOptions(collection) {
  const availableTaskIds = collection.availableIds();

  return `
    <option value="" selected disabled>
      Choose a task ...
    </option>

    ${availableTaskIds.map(taskId => `
      <option value="${escapeHtml(taskId)}">
        ${escapeHtml(taskId)}
      </option>
    `).join("")}
  `;
}

function buildInvalidTask(collection, taskId) {
  return `
    <p class="invalid-note">
      ✗ "${escapeHtml(taskId)}" is not a recognised task.
    </p>

    <div class="column gap-md">
      <label class="field-label">Replace with</label>
      <select class="field-dropdown task-rename" data-task="${escapeHtml(taskId)}">
        ${buildTaskOptions(collection)}
      </select>
    </div>
    <div class="row right">
      <button type="button" class="btn task-remove" data-task="${escapeHtml(taskId)}"> Remove </button>
    </div>
  `;
}

function buildTaskRow(collection, expandedTaskId, taskId) {
  const isExpanded = expandedTaskId === taskId;
  const isInvalid = !collection.isValid(taskId);
  const task = collection.get(taskId);

  const content = isInvalid
    ? buildInvalidTask(collection, taskId)
    : buildValidTask(collection, taskId);

  return `
    <div class="task-row ${isExpanded ? "open" : ""} ${isInvalid ? "invalid" : ""}" data-task="${escapeHtml(taskId)}">
      <button type="button" class="task-head" data-task="${escapeHtml(taskId)}">
        <span class="row left gap-md">
          ${buildTaskStatus(collection, taskId)}
          <span class="details-label"> ${escapeHtml(taskId)} </span>
        </span>

        <span class="row right gap-md">
          ${buildNewBadge(task)}
          <span class="task-chevron">▾</span>
        </span>
      </button>

      <div id="task-${escapeHtml(taskId)}" class="task-body" ${isExpanded ? "" : "hidden"}>
        ${content}
      </div>
    </div>
  `;
}

export { buildTaskRow };

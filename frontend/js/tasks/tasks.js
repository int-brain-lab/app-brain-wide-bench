import { renderMessage } from "../utils.js";
import { apiFetch } from "../api.js";
import { getFieldValue, setFieldValue } from "../utils/form-fields.js";
import { createTaskCollection } from "./collection.js";
import { TASK_FIELDS, loadTaskFields, trainingFieldKeys } from "./schema.js";
import { renderDetectedTasks, renderTaskList, updateTaskRow } from "./tasks-view.js";
import { initialisePopup } from "./popup.js";

// ─── API ────────────────────────────────────────────────────────────────────

// An empty result here is treated (by collection.js's isValid) as "nothing
// to validate against, allow anything" — appropriate for a genuinely empty
// task table, but that also means a fetch failure would otherwise silently
// make every task id look valid. Surface the failure so that's not silent.
async function loadKnownTaskIds() {
  try {
    const tasks = await apiFetch("/api/tasks/");
    return tasks.map(task => task.id).sort();
  } catch (err) {
    console.error(err);
    renderMessage(taskInfo(), "Could not load the list of known tasks — task validation is unavailable.");
    return [];
  }
}


// ─── STATE ──────────────────────────────────────────────────────────────────

let collection = null;
let expandedTaskId = null;
let wizard = null;


// ─── DOM ────────────────────────────────────────────────────────────────────

function taskInfo() {
  return document.getElementById("task-info");
}

function taskList() {
  return document.getElementById("task-list");
}


// ─── ACCESSORS (for create.js) ─────────────────────────────────────────────

// Guarded against `collection` not existing yet — in practice `initialiseTasks`
// always resolves before any of these can be reached from the wizard/create.js,
// but that's an implicit ordering assumption, not a guarantee, so fail safe
// rather than throw if it's ever called too early.
function isTasksValid() {
  return collection ? collection.allValid() : false;
}

function isTasksConfirmed() {
  return collection ? collection.allConfirmed() : false;
}

function getTaskCount() {
  return collection ? collection.ids().length : 0;
}

function getTaskIds() {
  return collection ? collection.ids() : [];
}

// The `tasks` array for POST /api/submissions/presign: each task's flat id plus
// the methodology collected for it. `state.model` is excluded — it's context the
// schema's predicates read, not a submitted value — so the payload is exactly
// the task id and the schema's training fields.
function getTaskPayloads() {
  if (!collection) return [];

  return collection.ids().map(taskId => {
    const { state } = collection.get(taskId);

    return {
      task_id: taskId,
      ...Object.fromEntries(trainingFieldKeys().map(key => [key, state[key]])),
    };
  });
}


// ─── MODEL (called by create.js whenever the selected model (re)loads) ─────

function setSelectedModel(model) {
  if (!collection) return;
  collection.setModel(model);
  refreshTaskList();
}


// ─── DETECTED TASKS (called by create.js after reading a dropped zip) ──────

function refreshTaskList() {
  renderTaskList(collection, expandedTaskId);
  wizard.updateNavigation();
}

// `error`, if given, means the zip couldn't be read at all — shown instead of
// the detected-tasks summary. Either way the collection still gets synced
// (to an empty list on error) so the task step reflects reality.
function applyDetectedTasks(detectedTaskIds, error = null) {
  if (error) {
    renderMessage(taskInfo(), error);
  } else if (detectedTaskIds.length) {
    renderDetectedTasks(collection, detectedTaskIds);
  } else {
    renderMessage(taskInfo(), "No tasks detected — add them manually in the next step.");
  }

  collection.syncFromDetected(detectedTaskIds);

  const firstInvalid = detectedTaskIds.find(id => !collection.isValid(id));
  expandedTaskId = firstInvalid ?? detectedTaskIds[0] ?? null;

  refreshTaskList();
}


// ─── TASK LIST ──────────────────────────────────────────────────────────────

function refreshTaskRow(taskId) {
  updateTaskRow(collection, expandedTaskId, taskId);
  wizard.updateNavigation();
}

function addTask(taskId, isNew = true) {
  if (!collection.add(taskId, isNew)) {
    return;
  }

  expandedTaskId = taskId;
  refreshTaskList();
}

function removeTask(taskId) {
  collection.remove(taskId);

  if (expandedTaskId === taskId) {
    expandedTaskId = collection.ids()[0] ?? null;
  }

  refreshTaskList();
}

function renameTask(oldTaskId, newTaskId) {
  if (!collection.rename(oldTaskId, newTaskId)) {
    return;
  }

  expandedTaskId = newTaskId;
  refreshTaskList();
}

function toggleTask(taskId) {
  const previouslyExpanded = expandedTaskId;
  expandedTaskId = expandedTaskId === taskId ? null : taskId;

  if (previouslyExpanded && previouslyExpanded !== taskId) {
    refreshTaskRow(previouslyExpanded);
  }
  refreshTaskRow(taskId);
}

function setTaskField(taskId, key, value) {
  const task = collection.get(taskId);
  task.setConfirmed(false); // invariant: changing a field always un-confirms the task

  task.setClearedFields(setFieldValue(task.state, TASK_FIELDS, key, value));
  refreshTaskRow(taskId);
}

function confirmTask(taskId, confirmed) {
  collection.get(taskId).setConfirmed(confirmed);

  expandedTaskId = confirmed
    ? (collection.nextUnconfirmedAfter(taskId) ?? null)
    : taskId;

  refreshTaskRow(taskId);

  if (expandedTaskId && expandedTaskId !== taskId) {
    refreshTaskRow(expandedTaskId);
  }
}

function attachTaskEvents() {
  taskList().addEventListener("click", event => {
    const head = event.target.closest(".task-head");
    if (head) {
      toggleTask(head.dataset.task);
      return;
    }

    const removeButton = event.target.closest(".task-remove");
    if (removeButton) {
      removeTask(removeButton.dataset.task);
    }
  });

  taskList().addEventListener("change", event => {
    const confirmCheckbox = event.target.closest(".task-confirm");
    if (confirmCheckbox) {
      confirmTask(confirmCheckbox.dataset.task, confirmCheckbox.checked);
      return;
    }

    const renameSelect = event.target.closest(".task-rename");
    if (renameSelect) {
      renameTask(renameSelect.dataset.task, renameSelect.value);
      return;
    }

    // Schema-rendered methodology field (see task-view.js's buildValidTask).
    // Each task row has its own state, so — unlike attachFieldEvents, which
    // binds to one fixed state — the task is resolved fresh per event from
    // the row's data-task attribute.
    const fieldInput = event.target.closest("[data-field]");
    if (fieldInput) {
      const row = event.target.closest(".task-row");
      const key = fieldInput.dataset.field;
      const value = getFieldValue(TASK_FIELDS[key], key, fieldInput, row);
      setTaskField(row.dataset.task, key, value);
    }
  });
}


// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function initialiseTasks(wizardInstance) {
  wizard = wizardInstance;

  const [knownTaskIds] = await Promise.all([
    loadKnownTaskIds(),
    loadTaskFields(),
  ]);

  collection = createTaskCollection(knownTaskIds);

  attachTaskEvents();
  initialisePopup(collection, addTask);
}

export {
  applyDetectedTasks,
  initialiseTasks,
  isTasksValid,
  isTasksConfirmed,
  getTaskCount,
  getTaskIds,
  getTaskPayloads,
  setSelectedModel,
};

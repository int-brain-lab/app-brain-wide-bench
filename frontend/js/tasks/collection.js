import { createFieldState, setFieldValue } from "../utils/form-fields.js";
import { TASK_FIELDS } from "./schema.js";

// `state` holds the 5 methodology fields (schema-driven, null by default)
// plus two ad hoc properties the schema's predicates read but that aren't
// themselves editable fields: `task_id` (this task's flat id) and `model`
// (the submission's selected Model — kept in sync by the collection's
// `setModel`, since it can change after tasks already exist).
function createTask({ taskId, model = null, isNew = false } = {}) {
  const state = createFieldState(TASK_FIELDS);
  state.task_id = taskId;
  state.model = model;

  let confirmed = false;
  // Field keys cleared by the *most recent* revalidation (see
  // form-fields.js's revalidateFields) — surfaced by task-view.js so a
  // silently-cleared value isn't actually silent to the user.
  let clearedFields = [];

  return {
    isNew,
    state,
    isConfirmed: () => confirmed,
    setConfirmed(value) {
      confirmed = value;
    },
    clearedFields: () => clearedFields,
    setClearedFields(keys) {
      clearedFields = keys;
    },
  };
}

function createTaskCollection(knownTaskIds) {
  let tasks = new Map();
  let model = null;

  function add(id, isNew = true) {
    if (!id || tasks.has(id)) {
      return false;
    }
    tasks.set(id, createTask({ taskId: id, model, isNew }));
    return true;
  }

  function remove(id) {
    return tasks.delete(id);
  }

  function rename(oldId, newId) {
    if (!newId || tasks.has(newId) || !tasks.has(oldId)) {
      return false;
    }

    // The suite-based rules (extra_input_modality, etc.) key off task_id, so
    // it has to update on the task's own state too, not just the map key —
    // and re-validate, since the new id can invalidate prior selections.
    const task = tasks.get(oldId);
    task.setClearedFields(setFieldValue(task.state, TASK_FIELDS, "task_id", newId));

    // Rebuilt (not just re-keyed) to preserve the renamed entry's position.
    tasks = new Map([...tasks].map(([id, t]) => [id === oldId ? newId : id, t]));
    return true;
  }

  function syncFromDetected(ids) {
    tasks = new Map(ids.map(id => [id, createTask({ taskId: id, model, isNew: false })]));
  }

  // Called whenever the submission's selected model (re)loads, so every
  // existing task's model-dependent rules re-evaluate against it — clearing
  // any now-invalid selections rather than leaving them stale. Un-confirms
  // every task too: revalidation can silently clear a field on an already
  // *confirmed* task, and confirmed-with-blanked-out-fields is exactly the
  // inconsistent state confirmation is meant to prevent.
  function setModel(newModel) {
    model = newModel;
    for (const task of tasks.values()) {
      task.setClearedFields(setFieldValue(task.state, TASK_FIELDS, "model", model));
      task.setConfirmed(false);
    }
  }

  function get(id) {
    return tasks.get(id);
  }

  function has(id) {
    return tasks.has(id);
  }

  function ids() {
    return [...tasks.keys()];
  }

  function entries() {
    return [...tasks.entries()];
  }

  function isEmpty() {
    return tasks.size === 0;
  }

  function isValid(id) {
    return knownTaskIds.length === 0 || knownTaskIds.includes(id);
  }

  function allValid() {
    return ids().every(isValid);
  }

  function allConfirmed() {
    return !isEmpty() && [...tasks.values()].every(task => task.isConfirmed());
  }

  function nextUnconfirmedAfter(id) {
    const after = ids().slice(ids().indexOf(id) + 1);
    return after.find(candidateId => !get(candidateId).isConfirmed()) ?? null;
  }

  function availableIds() {
    return knownTaskIds.filter(id => !has(id));
  }

  return {
    add, remove, rename, syncFromDetected, setModel,
    get, has, ids, entries, isEmpty,
    isValid, allValid, allConfirmed, nextUnconfirmedAfter, availableIds,
  };
}

export { createTaskCollection };

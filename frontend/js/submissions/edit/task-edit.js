// Per-task editing on the submission card's Tasks tab: which card is open, its
// draft, and saving. Rendering lives in ../details/tasks-view.js — this module
// only decides what state a card should be rendered in.
//
// One card is open at a time; opening another discards the previous draft, same
// as Cancel. Nothing is written to the record until Save succeeds.

import {
  createFieldState,
  getFieldValue,
  setFieldValue,
} from "../../utils/form-fields.js";
import { TASK_FIELDS, trainingFieldKeys } from "../../tasks/schema.js";
import { renderTaskCard, taskCardList } from "../details/tasks-view.js";

// The records and the model are read through getters, not copied, so a full tab
// re-render (e.g. after the submission's model changes) can't leave this module
// holding a stale list or a stale model.
let getTaskSubmissions = () => [];
let getModel = () => null;
let saveTask = null;
let notify = null;

let editing = null;   // { id, draft }
let eventsAttached = false;


function findRecord(taskSubmissionId) {
  return getTaskSubmissions().find(record => record.id === taskSubmissionId);
}

// A draft needs `task_id` and `model` on top of the editable values: every
// disabledOptionsWhen predicate in TASK_FIELDS reads one or both (the suite
// rules, and the model's is_pretrained / pretrained_*_modalities).
// createFieldState drops them — task_id is editable:false and model isn't a
// schema field at all — so without this the dropdowns disable the wrong options.
function createDraft(record) {
  const draft = createFieldState(TASK_FIELDS, record);
  draft.task_id = record.task_id;
  draft.model = getModel();
  return draft;
}


// ─── ACTIONS ────────────────────────────────────────────────────────────────

function startEditing(taskSubmissionId) {
  const record = findRecord(taskSubmissionId);
  if (!record) return;

  const previous = editing?.id;
  editing = { id: taskSubmissionId, draft: createDraft(record) };

  if (previous && previous !== taskSubmissionId) {
    const previousRecord = findRecord(previous);
    if (previousRecord) renderTaskCard(previousRecord);
  }

  renderTaskCard(record, editing.draft);
}

function cancelEditing() {
  const record = editing && findRecord(editing.id);
  editing = null;

  if (record) renderTaskCard(record);
}

async function saveEditing() {
  if (!editing) return;

  const { id, draft } = editing;
  const record = findRecord(id);
  if (!record) return;

  // Only the schema's training fields are sent — task_id and model were context
  // the predicates needed, not editable values.
  const patch = Object.fromEntries(trainingFieldKeys().map(key => [key, draft[key]]));

  try {
    const updated = await saveTask(id, patch);

    Object.assign(record, updated ?? patch);
    editing = null;
    renderTaskCard(record);
    notify?.(`Saved ${record.task_id}.`);
  } catch (err) {
    console.error(err);
    notify?.(`Could not save ${record.task_id}: ${err.message}`);
  }
}

function handleFieldChange(event) {
  if (!editing) return;

  const input = event.target.closest("[data-field]");
  if (!input) return;

  const card = event.target.closest(".task-card");
  if (!card || card.dataset.ts !== editing.id) return;

  const key = input.dataset.field;
  const field = TASK_FIELDS[key];
  if (!field) return;

  const record = findRecord(editing.id);
  if (!record) return;

  const value = getFieldValue(field, key, input, card);
  const cleared = setFieldValue(editing.draft, TASK_FIELDS, key, value);

  // Re-rendered on every change, not only when something was cleared: these
  // fields gate each other's *options* (e.g. calibration "inductive" restricts
  // supervision_regime), so the disabled set has to be recomputed.
  renderTaskCard(record, editing.draft);

  if (cleared.length) {
    const labels = cleared.map(clearedKey => TASK_FIELDS[clearedKey].label).join(", ");
    notify?.(`Cleared (no longer valid): ${labels}`);
  }
}


// ─── EVENTS ─────────────────────────────────────────────────────────────────

// Attached once for the page's lifetime. The listeners are delegated to the
// container, which survives every card re-render, so re-attaching on each
// render would stack duplicate handlers.
function attachEvents() {
  if (eventsAttached) return;
  eventsAttached = true;

  taskCardList().addEventListener("click", event => {
    const edit = event.target.closest(".task-edit");
    if (edit) {
      startEditing(edit.dataset.ts);
      return;
    }

    if (event.target.closest(".task-save")) {
      saveEditing();
      return;
    }

    if (event.target.closest(".task-cancel")) {
      cancelEditing();
    }
  });

  taskCardList().addEventListener("change", handleFieldChange);
}


// ─── INITIALISATION ─────────────────────────────────────────────────────────

/**
 * Safe to call again after a full tab re-render: the listeners attach once and
 * any open draft is dropped, since its card no longer exists.
 *
 * @param getTaskSubmissions () => task submission records (live, not a copy).
 * @param getModel           () => the submission's Model, for the field predicates.
 * @param onSave             async (taskSubmissionId, patch) => updated fields.
 * @param onMessage          optional (message: string) => void.
 */
function attachTaskEditing(options) {
  getTaskSubmissions = options.getTaskSubmissions;
  getModel = options.getModel;
  saveTask = options.onSave;
  notify = options.onMessage;
  editing = null;

  attachEvents();
}

export { attachTaskEditing };

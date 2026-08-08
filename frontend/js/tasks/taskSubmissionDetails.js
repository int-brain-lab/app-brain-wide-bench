import { createDetailEditor } from "../utils/detail-editor.js";
import {loadTaskFields, TASK_PANELS, trainingFieldKeys} from "./schema.js";
import {loadSubmission, loadTaskSubmission, updateTaskSubmissions} from "../submissions/submissionApi.js";
import {loadModel} from "../models/modelApi.js";
import {subtaskLabel, suiteOf} from "../scores.js";
import {renderMessage} from "../utils.js";
import {panelGroups, renderDisplayFields, renderGroups} from "../utils/form-fields.js";


// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(taskSubmission, submission) {
  document.getElementById("task-title").textContent = subtaskLabel(taskSubmission.task_id);
  document.getElementById("task-description").textContent =
    `${suiteOf(taskSubmission.task_id).toUpperCase()} · ${submission.label} · ${submission.team_name}`;
}

function renderBackLink(submission) {
  const link = document.getElementById("back-to-tasks");

  link.textContent = `← Back to ${submission.label}`;
  link.href = `/html/submissions/submission_tasks.html?id=${encodeURIComponent(submission.id)}`;
}

function renderDetails(taskSubmission, fields) {
  document.getElementById("task-details").innerHTML =
    renderGroups(panelGroups(fields, TASK_PANELS), taskSubmission, fields, renderDisplayFields);
}


// ─── APPLY TO SUITE ─────────────────────────────────────────────────────────

// The methodology a task declares is usually the same across a whole suite — the same
// model, trained the same way, evaluated on every ts1 task. This saves re-entering it
// per task.
//
// Safe to reuse the draft verbatim: TASK_FIELDS' predicates key off the model and the
// *suite* (via taskSuite), never the individual task, so values legal here are legal
// for every sibling in the same suite.

function applyToSuiteWrapper() {
  return document.getElementById("apply-to-suite");
}

function applyToSuiteInput() {
  return document.getElementById("apply-to-suite-input");
}

function renderApplyToSuiteLabel(taskSubmission, siblingCount) {
  document.getElementById("apply-to-suite-label").textContent =
    `Apply to all ${suiteOf(taskSubmission.task_id).toUpperCase()} tasks (${siblingCount})`;
}

// Includes the task being edited, so a checked save is one uniform pass over the suite
// rather than "this one, plus the others".
function suiteSiblings(submission, taskSubmission) {
  const suite = suiteOf(taskSubmission.task_id);

  return (submission.task_submissions ?? [])
    .filter(sibling => suiteOf(sibling.task_id) === suite);
}

// Mirrors Save/Cancel, which createDetailEditor toggles itself. It has no hook for
// *entering* edit mode, so this listens on the Edit button directly — a second listener
// alongside the editor's own, which is harmless since they do independent things.
function attachApplyToSuiteVisibility() {
  const setVisible = visible => { applyToSuiteWrapper().hidden = !visible; };

  document.getElementById("edit-task").addEventListener("click", () => setVisible(true));

  return () => {
    // Unticked on the way out, so a later edit can't silently fan out to the suite.
    applyToSuiteInput().checked = false;
    setVisible(false);
  };
}


// ─── EVENTS ─────────────────────────────────────────────────────────────────

// TaskSubmissionUpdate declares `extra="forbid"`, so anything the server doesn't accept
// is a 422 rather than an ignored key. The draft carries more than that — the schema's
// predicates need `task_id` and `model` on it (see `context` below) — so the payload is
// narrowed to the methodology fields here rather than sent whole.
function buildPatch(draft) {
  return Object.fromEntries(trainingFieldKeys().map(key => [key, draft[key]]));
}

// Names the tasks the server reports it wrote, rather than the ones this page asked it
// to — a suite-wide apply is otherwise invisible, since the page shows a single task.
function reportUpdated(updated) {
  const names = updated.map(row => subtaskLabel(row.task_id)).sort();

  renderMessage(
    document.getElementById("task-message"),
    names.length === 1
      ? `Updated ${names[0]}.`
      : `Updated ${names.length} tasks: ${names.join(", ")}.`,
  );
}

// One bulk call even for a single task, so there is one code path rather than two —
// and so the server, not this page, decides all-or-nothing. It returns the rows it
// actually wrote, which is what `reportUpdated` names.
//
// Returns the *edited* task's response, since createDetailEditor assigns that back onto
// `record`; the siblings aren't shown on this page.
async function saveDraft(draft, taskSubmission, submission) {
  const targets = applyToSuiteInput().checked
    ? suiteSiblings(submission, taskSubmission)
    : [taskSubmission];

  const updated = await updateTaskSubmissions(
    submission.id,
    targets.map(target => target.id),
    buildPatch(draft),
  );

  reportUpdated(updated);

  return updated.find(row => row.id === taskSubmission.id) ?? updated[0];
}

// `model` and `task_id` aren't editable fields, but every disabledOptionsWhen in
// TASK_FIELDS reads them — which options are legal depends on the model's pretraining
// and on which suite the task belongs to. Without them the form would silently offer
// choices the server would reject.
function attachEditor(taskSubmission, submission, model, fields) {
  const resetApplyToSuite = attachApplyToSuiteVisibility();

  createDetailEditor({
    container: document.getElementById("task-details"),
    editButton: document.getElementById("edit-task"),
    saveButton: document.getElementById("save-task"),
    cancelButton: document.getElementById("cancel-task"),
    record: taskSubmission,
    fields,
    groups: () => panelGroups(fields, TASK_PANELS, { columns: 1 }),
    context: () => ({ task_id: taskSubmission.task_id, model }),
    save: draft => saveDraft(draft, taskSubmission, submission),
    onSaved: () => {
      resetApplyToSuite();
      renderDetails(taskSubmission, fields);
    },
    onCancel: () => {
      resetApplyToSuite();
      renderDetails(taskSubmission, fields);
    },
  }).attach();
}


async function loadTaskSubmissionDetailsPage() {
      const params = new URLSearchParams(location.search);
      const submissionId = params.get("submission");
      const taskSubmissionId = params.get("task");

      const [taskSubmission, submission, fields] = await Promise.all([
        loadTaskSubmission(submissionId, taskSubmissionId),
        loadSubmission(submissionId),
        loadTaskFields(),
      ]);

      // The model decides which methodology options are legal, so it's fetched too —
      // the task submission carries neither it nor its id.
      // TODO add pretrained to the submission so we don't have to fetch the model
      const model = submission?.model_id ? await loadModel(submission.model_id) : null;

      renderHeader(taskSubmission, submission);
      renderBackLink(submission);
      renderDetails(taskSubmission, fields);
      renderApplyToSuiteLabel(taskSubmission, suiteSiblings(submission, taskSubmission).length);
      attachEditor(taskSubmission, submission, model, fields);

      globalThis.lucide?.createIcons?.();
}

loadTaskSubmissionDetailsPage()

// The `task` view of the submission record page — methodology for one task submission.
//
// Apply-to-suite propagates the change to every sibling task in the same suite.

import { showError, showMessage } from "../utils.js";
import { panelGroups } from "../utils/form-fields.js";
import { Editor } from "../utils/editor.js";
import { suiteFromTask } from "../utils/suites.js";
import { TASK_PANELS, trainingFieldKeys } from "./taskSubmissionSchema.js";
import { updateTaskSubmissions } from "./taskSubmissionApi.js";
import {
  buildBody,
  buildHeader,
  buildMessage,
  buildPage,
  pageMessage,
  renderDetails,
  renderHeader,
  renderPage,
  sectionBody,
} from "../pages/record-page.js";

const BACK = {
  text: "← Back to tasks",
  view: "tasks",
};

const EDIT_ACTION = {
  id: "edit-button",
  label: "Edit",
  icon: "pencil",
};

const SAVE_ACTION = {
  id: "save-button",
  label: "Save",
  icon: "check",
  className: "primary",
  hidden: true,
};

const CANCEL_ACTION = {
  id: "cancel-button",
  label: "Cancel",
  icon: "x",
  hidden: true,
};

// ─── DATA ────────────────────────────────────────────────────────────────────

function suiteLabel(taskId) {
  return suiteFromTask(taskId)?.toUpperCase() ?? null;
}

function suiteSiblings(submission, taskSubmission) {
  const suite = suiteFromTask(taskSubmission.task_id);

  return (submission.task_submissions ?? []).filter(
    sibling => suiteFromTask(sibling.task_id) === suite,
  );
}

function buildPatch(draft) {
  return Object.fromEntries(trainingFieldKeys().map(key => [key, draft[key]]));
}

// A suite-wide save writes rows the page still holds at their old values, and the tasks and
// scores views render from that same array — so the response is merged back in place rather
// than only into the edited record.
function mergeUpdated(submission, updated) {
  for (const row of updated) {
    const existing = (submission.task_submissions ?? []).find(task => task.id === row.id);

    if (existing) Object.assign(existing, row);
  }
}

// ─── MARKUP ──────────────────────────────────────────────────────────────────

function buildApplyToSuite() {
  return `
    <label class="row left gap-sm" id="apply-to-suite" hidden>
      <input type="checkbox" class="field-checkbox" id="apply-to-suite-input">
      <span class="metadata" id="apply-to-suite-label"></span>
    </label>
  `;
}

const APPLY_TO_SUITE_ACTION = {
  html: buildApplyToSuite()
}

function getSubtitle(submission, taskSubmission) {
  return [suiteLabel(taskSubmission.task_id), submission.label, submission.team_name]
    .filter(Boolean)
    .join(" · ");
}

// ─── VIEW ────────────────────────────────────────────────────────────────────

function renderTaskView({ submission, taskFields, task, edit = false }) {
  const taskSubmission = (submission.task_submissions ?? []).find(row => row.id === task);

  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader(
        taskSubmission
          ? [EDIT_ACTION, APPLY_TO_SUITE_ACTION, SAVE_ACTION, CANCEL_ACTION]
          : [],
      ),
      body: buildMessage() + buildBody(),
    }),
  );

  // Reachable by editing the URL, and by a Back into a task that a later save removed.
  if (!taskSubmission) {
    renderHeader(submission.label, submission.team_name ?? "");
    showError(pageMessage(), "That task is not part of this submission.");
    return;
  }

  renderHeader(taskSubmission.task_id, getSubtitle(submission, taskSubmission));
  renderDetails(taskSubmission, taskFields, TASK_PANELS);

  const siblings = suiteSiblings(submission, taskSubmission);
  const applyToSuite = document.getElementById("apply-to-suite");
  const applyToSuiteInput = document.getElementById("apply-to-suite-input");

  document.getElementById("apply-to-suite-label").textContent =
    `Apply to all ${suiteLabel(taskSubmission.task_id) ?? "matching"} tasks (${siblings.length})`;

  function showApplyToSuite(visible) {
    applyToSuite.hidden = !visible;

    if (!visible) applyToSuiteInput.checked = false;
  }

  showApplyToSuite(false);

  // Set by `save`, read by `onSaved`: the editor's save must return the one record it
  // merges, so the full list of updated rows has no way through except a variable here.
  let updated = [];

  Editor({
    container: sectionBody("body"),
    editButton: document.getElementById("edit-button"),
    saveButton: document.getElementById("save-button"),
    cancelButton: document.getElementById("cancel-button"),
    record: taskSubmission,
    fields: taskFields,
    groups: () => panelGroups(taskFields, TASK_PANELS, { columns: 1 }),

    // `task_id` and the model aren't editable fields, but TASK_FIELDS reads both when
    // deciding which methodology options are legal.
    context: () => ({
      task_id: taskSubmission.task_id,
      model: submission.model,
    }),

    onEdit: () => showApplyToSuite(true),

    // TASK_FIELDS is the one schema whose fields invalidate each other — changing the
    // paradigm can rule out the supervision regime already chosen. The create form shows
    // this per task; without it here the value would just vanish from the form.
    onCleared: labels => showError(pageMessage(), `Cleared (no longer valid): ${labels}`),

    // One bulk request for both the single-task and suite-wide cases, so the server stays
    // responsible for applying it atomically.
    save: async draft => {
      const targets = applyToSuiteInput.checked ? siblings : [taskSubmission];

      updated = await updateTaskSubmissions(
        submission.id,
        targets.map(target => target.id),
        draft,
      );

      return updated.find(row => row.id === taskSubmission.id) ?? updated[0];
    },

    onSaved: saved => {
      mergeUpdated(submission, updated);
      showApplyToSuite(false);
      renderDetails(saved, taskFields, TASK_PANELS);

      // Names what the server reported it changed, not what the page asked for.
      const names = updated.map(row => row.task_id).sort();

      showMessage(
        pageMessage(),
        names.length === 1
          ? `Updated ${names[0]}.`
          : `Updated ${names.length} tasks: ${names.join(", ")}.`,
      );

      updated = [];
    },

    onCancel: () => {
      showApplyToSuite(false);
      renderDetails(taskSubmission, taskFields, TASK_PANELS);
    },

    onError: message => showError(pageMessage(), message),
  }).attach();

  if (edit) {
    document.getElementById("edit-button").click();
  }
}


export { renderTaskView };

import { attachTabEvents, showTab } from "../../tab.js";
import { countTasks, getMeanScores, scoresBySuite } from "../../scores.js";
import { loadSubmission, updateTaskSubmission } from "../api.js";
import { loadSubmissionFields } from "../schema.js";
import { loadTaskFields } from "../../tasks/schema.js";
import { loadModel } from "../../models/api.js";
import {
  renderDetailsTab,
  renderEvaluationTab,
  renderOverviewTab,
  renderSubmissionHeader,
  showMessage,
} from "./details-view.js";
import { renderTasksTab } from "./tasks-view.js";
import { attachSubmissionEditor } from "../edit/edit.js";
import { attachTaskEditing } from "../edit/task-edit.js";


function attachSeeAllDetailsLink() {
  document.getElementById("see-all-details-link")
    ?.addEventListener("click", () => showTab("details"));
}


// The submission's Model is needed beyond display: TASK_FIELDS' predicates read
// its is_pretrained / pretrained_*_modalities to decide which training-field
// options are legal. Fetched separately because the submission detail response
// carries only model_id.
async function loadContext(submissionId) {
  const submission = await loadSubmission(submissionId);

  if (!submission) {
    return null;
  }

  const [fields] = await Promise.all([
    loadSubmissionFields(),
    loadTaskFields(),
  ]);

  const model = submission.model_id ? await loadModel(submission.model_id) : null;

  return { submission, fields, model };
}


// `context` is mutated in place (the editor writes to context.submission, and a
// model change replaces context.model), so the getters handed to the task editor
// below always see current values.
function renderAll(context) {
  const { submission, fields } = context;

  const suiteScores = scoresBySuite([submission]);
  const meanScores = getMeanScores(suiteScores);
  const taskCount = countTasks(suiteScores);

  renderSubmissionHeader(submission);
  renderOverviewTab({ submission, fields, meanScores, taskCount });
  renderDetailsTab(submission, fields);
  renderEvaluationTab(suiteScores);
  renderTasksTab(submission.task_submissions ?? []);

  if (globalThis.lucide?.createIcons) {
    globalThis.lucide.createIcons();
  }
}


function attachEditors(context) {
  attachSubmissionEditor({
    submission: context.submission,
    fields: context.fields,

    // Changing the model changes which training-field options are legal, so the
    // model is re-fetched and the whole card re-rendered — not just the tabs
    // that show its name.
    onSaved: async submission => {
      if (submission.model_id) {
        context.model = await loadModel(submission.model_id);
      }
      renderAll(context);
      attachTaskEditing(taskEditingOptions(context));
      showMessage("Changes saved.");
    },

    onCleared: labels => showMessage(`Cleared (no longer valid): ${labels}`),
    onError: message => showMessage(message, "error-msg"),
  });

  attachTaskEditing(taskEditingOptions(context));
}


function taskEditingOptions(context) {
  return {
    getTaskSubmissions: () => context.submission.task_submissions ?? [],
    getModel: () => context.model,
    onSave: (taskSubmissionId, patch) =>
      updateTaskSubmission(context.submission.id, taskSubmissionId, patch),
    onMessage: showMessage,
  };
}


async function loadSubmissionDetailsPage() {
  const submissionId = new URLSearchParams(location.search).get("id");

  if (!submissionId) {
    showMessage("No submission id in the URL.", "error-msg");
    return;
  }

  try {
    const context = await loadContext(submissionId);

    if (!context) {
      showMessage("Could not load this submission.", "error-msg");
      return;
    }

    renderAll(context);
    attachTabEvents();
    attachSeeAllDetailsLink();
    attachEditors(context);
  } catch (err) {
    console.error(err);
    showMessage("Could not load this submission.", "error-msg");
  }
}

loadSubmissionDetailsPage();

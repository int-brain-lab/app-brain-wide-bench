import { loadTrainingFields } from "./api.js";
import { fieldsForPanel } from "../utils/form-fields.js";

// `state.task_id` is the flat id (e.g. "ts1-reward"); `state.model` is the
// submission's selected Model (`is_pretrained`/`pretrained_in_modalities`/
// `pretrained_out_modalities`) — both must be present on a task's state for
// these predicates to resolve correctly.
function taskSuite(taskId) {
  return taskId?.match(/^ts\d/)?.[0] ?? null;
}

const SUITE_OUTPUT_MODALITY = { ts1: "behavior", ts2: "spikes", ts3: "anatomy" };

const TASK_FIELDS = {
  id: {
    label: "Task id",
    input: "text",
    editable: false,
  },

  submission_id: {
    label: "Submission id",
    input: "text",
    editable: false,
  },

  task_id: {
    label: "Suite id",
    input: "text",
    editable: false,
  },

  extra_input_modality: {
    label: "Extra modality",
    input: "checkbox-list",
    panel: 1,
    options: null,
    // Spikes is the baseline input (not "extra"); the suite's own
    // supervision target can't be used as an input either.
    disabledOptionsWhen: state => {
      // Spikes is a default input modality for all tasks
      const disabled = ["spikes"];
      const suite = taskSuite(state.task_id);
      // For ts1, the target is behavior, so it can't be used as an input modality.
      if (suite === "ts1") disabled.push("behavior");
      // For ts3, the target is anatomy, so it can't be used as an input modality.
      if (suite === "ts3") disabled.push("anatomy");
      return disabled;
    },
  },

  training_paradigm: {
    label: "Training paradigm",
    input: "select",
    panel: 1,
    options: null,
    disabledOptionsWhen: state => {
      const model = state.model;

      // Pretrained is false → rule out TSS/TSU, only single-session is an option
      if (!model?.is_pretrained) {
        return ["TSS", "TSU"];
      }

      // Pretrained is true → rule out single-session.
      const disabled = ["single_session"];

      // If the models modalities don't match the pretraining modalities -> rule out TSS
      const suite = taskSuite(state.task_id);
      const outputModality = SUITE_OUTPUT_MODALITY[suite];
      const inputMatches = model.pretrained_in_modalities?.includes("spikes");
      const outputMatches = outputModality && model.pretrained_out_modalities?.includes(outputModality);
      if (!inputMatches || !outputMatches) {
        disabled.push("TSS");
      }

      return disabled;
    },
  },

  supervision_regime: {
    label: "Supervision regime",
    input: "select",
    panel: 1,
    options: null,
    disabledOptionsWhen: state => {
      const disabled = new Set();

      // Pretrained is false -> rule out zero-shot
      if (!state.model?.is_pretrained) {
        disabled.add("zero_shot");
      }

      // For inductive calibration, only zero-shot is an option.
      if (state.calibration === "inductive") {
        ["few_shot", "full", "other"].forEach(option => disabled.add(option));
      }

      // For ts3, only zero-shot is an option
      if (taskSuite(state.task_id) === "ts3") {
        ["few_shot", "full", "other"].forEach(option => disabled.add(option));
      }

      return [...disabled];
    },
  },

  calibration: {
    label: "Calibration",
    input: "select",
    panel: 1,
    options: null,
    // Single-session models are always transductive (trained from scratch).
    disabledOptionsWhen: state => (state.model?.is_pretrained ? [] : ["inductive"]),
  },

  finetuning_strategy: {
    label: "Fine tuning strategy",
    input: "checkbox-list",
    panel: 1,
    options: null,
    // Field disabled when pretrained is false
    disabledWhen: state => !state.model?.is_pretrained,
  },
};


// Populate every select/checkbox-list field's options from `/api/meta/enums`
// once, in place, since it's shared read-only enum-like data, not per-flow
// instance state. The endpoint returns `{fieldName: [options...]}` — one
// options list per field, not a single shared list.

// TODO DON"T MUTATE STATE AS WILL NOT WORK ON SERVER SIDE

async function loadTaskFields() {
  if (TASK_FIELDS.training_paradigm.options !== null) {
    return TASK_FIELDS;
  }

  const trainingFields = await loadTrainingFields();

  for (const [key, field] of Object.entries(TASK_FIELDS)) {
    if (field.input === "select" || field.input === "checkbox-list") {
      field.options = trainingFields[key] ?? [];
    }
  }

  return TASK_FIELDS;
}

// The per-task methodology ("training") fields: everything on panel 1. Both the
// submit wizard's carousel and the submission card's task editor render exactly
// this set, and it's also the shape of a task-submission PATCH — so the list
// lives here with the schema rather than being re-derived at each call site.
function trainingFieldKeys() {
  return fieldsForPanel(TASK_FIELDS, 1);
}

export { TASK_FIELDS, loadTaskFields, trainingFieldKeys };

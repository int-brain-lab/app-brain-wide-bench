import { getMeta } from "../api/metaApi.js";
import { suiteFromTask } from "../core/suites.js";
import { applyFieldMeta } from "./fieldMeta.js";
import { fieldsForPanel } from "./schema.js";

// What each suite asks a model to predict, from /api/meta — which is why it is a `let`
// filled by loadTaskFields rather than a constant here. It used to be a constant here, and
// the same three pairs are a fact about the benchmark that the scoring code also needs, so
// the server is where they belong.
//
// The rules below read it synchronously during a render, which is safe because every caller
// awaits loadTaskFields before rendering anything. Empty until then, which reads as "no
// target modality" and disables nothing — the failure of a rule that ran too early would be
// a permissive form, so this is asserted by the loader ordering rather than left to chance.
let suiteOutputModality = {};

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
    enum: "modality",
    // Spikes is the baseline input (not "extra"); the suite's own
    // supervision target can't be used as an input either.
    disabledOptionsWhen: state => {
      // Spikes is a default input modality for all tasks
      const disabled = ["spikes"];
      const suite = suiteFromTask(state.task_id);
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
    enum: "training_paradigm",
    disabledOptionsWhen: state => {
      const model = state.model;

      // Pretrained is false → rule out TSS/TSU, only single-session is an option
      if (!model?.is_pretrained) {
        return ["TSS", "TSU"];
      }

      // Pretrained is true → rule out single-session.
      const disabled = ["single_session"];

      // If the models modalities don't match the pretraining modalities -> rule out TSS
      const suite = suiteFromTask(state.task_id);
      const outputModality = suiteOutputModality[suite];
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
    enum: "supervision_regime",
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
      if (suiteFromTask(state.task_id) === "ts3") {
        ["few_shot", "full", "other"].forEach(option => disabled.add(option));
      }

      return [...disabled];
    },
  },

  calibration: {
    label: "Calibration",
    input: "select",
    panel: 1,
    enum: "calibration",
    // Single-session models are always transductive (trained from scratch).
    disabledOptionsWhen: state => (state.model?.is_pretrained ? [] : ["inductive"]),
  },

  finetuning_strategy: {
    label: "Fine tuning strategy",
    input: "checkbox-list",
    panel: 1,
    enum: "finetuning_strategy",
    // Field disabled when pretrained is false
    disabledWhen: state => !state.model?.is_pretrained,
  },
};


// Fill the options and the help text from /api/meta, and take the suite output modalities
// while we are there. Every caller awaits this before rendering — see suiteOutputModality.
//
// Each field names the enum it wants (`enum: "calibration"`) rather than the endpoint
// answering per field name, which is what lets extra_input_modality and the model form's
// two pretrained-modality pickers share one list instead of three that can disagree.
//
// Still in place rather than returning a copy: TASK_FIELDS is imported directly by the task
// panel, the task table and the task submission view. See applyFieldMeta.
async function loadTaskFields() {
  const meta = await getMeta();

  suiteOutputModality = Object.fromEntries(
    Object.entries(meta.suites).map(([suite, { output_modality }]) => [suite, output_modality]),
  );

  return applyFieldMeta(TASK_FIELDS, meta, "task_submission");
}

// The per-task methodology ("training") fields: everything on panel 1. Both the
// submit wizard's carousel and the submission card's task editor render exactly
// this set, and it's also the shape of a task-submission PATCH — so the list
// lives here with the schema rather than being re-derived at each call site.
function trainingFieldKeys() {
  return fieldsForPanel(TASK_FIELDS, 1);
}

// The body of a task-submission PATCH: the methodology keys, and only those, read off a
// form's state. It lives here rather than in the API module because knowing which keys the
// server takes is knowing the schema — and having it there made api/ import this file,
// which was a circular import between the two.
function taskPayload(state) {
  return Object.fromEntries(
    trainingFieldKeys().map(key => [key, state[key]]),
  );
}

// One card, since every editable task field is methodology. Declared anyway so the
// task editor builds its layout the same way the model and submission ones do.
const TASK_PANELS = [
  { panel: 1, title: "Methodology", columns: 2 },
];

export { TASK_FIELDS, TASK_PANELS, loadTaskFields, taskPayload, trainingFieldKeys };

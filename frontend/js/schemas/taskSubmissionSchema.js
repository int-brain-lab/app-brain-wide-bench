// The per-task methodology schema: what a submission says about how each task was run.

import { suiteFromTask } from "../core/suites.js";
import { applyFieldMeta, getMeta } from "../api/metaApi.js";
import { fieldsForPanel } from "./schemaPanels.js";

// What each suite asks a model to predict, from /api/meta — hence a `let` filled by
// loadTaskFields. The rules below read it synchronously during a render, which is safe
// because every caller awaits that loader first. Empty until then, which disables nothing.
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
    panel: "methodology",
    enum: "modality",
    // Spikes is the baseline input (not "extra"); the suite's own
    // supervision target can't be used as an input either.
    disabledOptionsWhen: (state) => {
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
    panel: "methodology",
    enum: "training_paradigm",
    disabledOptionsWhen: (state) => {
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
      const outputMatches =
        outputModality &&
        model.pretrained_out_modalities?.includes(outputModality);
      if (!inputMatches || !outputMatches) {
        disabled.push("TSS");
      }

      return disabled;
    },
  },

  supervision_regime: {
    label: "Supervision regime",
    input: "select",
    panel: "methodology",
    enum: "supervision_regime",
    disabledOptionsWhen: (state) => {
      const disabled = new Set();

      // Pretrained is false -> rule out zero-shot
      if (!state.model?.is_pretrained) {
        disabled.add("zero_shot");
      }

      // For inductive calibration, only zero-shot is an option.
      if (state.calibration === "inductive") {
        ["few_shot", "full", "other"].forEach((option) => disabled.add(option));
      }

      // For ts3, only zero-shot is an option
      if (suiteFromTask(state.task_id) === "ts3") {
        ["few_shot", "full", "other"].forEach((option) => disabled.add(option));
      }

      return [...disabled];
    },
  },

  calibration: {
    label: "Calibration",
    input: "select",
    panel: "methodology",
    enum: "calibration",
    // Single-session models are always transductive (trained from scratch).
    disabledOptionsWhen: (state) =>
      state.model?.is_pretrained ? [] : ["inductive"],
  },

  finetuning_strategy: {
    label: "Fine tuning strategy",
    input: "checkbox-list",
    panel: "methodology",
    enum: "finetuning_strategy",
    // Field disabled when pretrained is false
    disabledWhen: (state) => !state.model?.is_pretrained,
  },
};

// One card, since every editable task field is methodology. Declared anyway so the
// task editor builds its layout the same way the model and submission ones do.
const TASK_PANELS = {
  methodology: { type: "fields", title: "Methodology", columns: 2 },
};

// Options, help text and the suite output modalities, from /api/meta. Every caller awaits
// this before rendering. In place rather than returning a copy — see applyFieldMeta.
//
// No loadTaskMeta counterpart, unlike the model and submission schemas: every option here
// is public, so there is no signed-in variant to split off.
async function loadTaskFields() {
  const meta = await getMeta();

  suiteOutputModality = Object.fromEntries(
    Object.entries(meta.suites).map(([suite, { output_modality }]) => [
      suite,
      output_modality,
    ]),
  );

  return applyFieldMeta(TASK_FIELDS, meta, "task_submission");
}

// Everything on the methodology panel — what the submit wizard, the task editor and a
// task-submission PATCH all take, so the list lives here rather than at each call site.
function trainingFieldKeys() {
  return fieldsForPanel(TASK_FIELDS, "methodology");
}

// The methodology keys, and only those, read off a form's state. Here rather than in the
// API module: which keys the server takes is schema knowledge, and api/ sits below this.
function toMethodologyValues(state) {
  return Object.fromEntries(
    trainingFieldKeys().map((key) => [key, state[key]]),
  );
}

export {
  TASK_FIELDS,
  TASK_PANELS,
  loadTaskFields,
  toMethodologyValues,
  trainingFieldKeys,
};

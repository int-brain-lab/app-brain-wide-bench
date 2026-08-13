// Create a new model.
//
// Contains 3 panels
//   1. Identity     model name and associated team
//   2. Links        optional links for the model
//   3. Parameters   optional model parameters
//
// Every panel is schema-driven, so this page contributes no markup of its own.

import { loadModelFields } from "./modelSchema.js";
import { createModel } from "./modelApi.js";
import { isAuthenticated } from "../api.js";
import { showError } from "../utils.js";
import { showGate } from "../utils/gate.js";
import { createPanelForm } from "../pages/create-form.js";



const MODEL_PANELS = [
  {
    panel: 1,
    required: ["name", "team_id"],
    title: "1. Choose a model name and the team it belongs to"
  },
  {
    panel: 2,
    required: [],
    title: "2. Add links to your models"
  },
  {
    panel: 3,
    required: [],
    title: "3. Describe your model parameters"
  },
];

async function submitModel(state) {
  const model = await createModel(state);
  // TODO do I need to throw an error if model is null or undefined?
  //  Or will createModel throw an error itself?
  return `/html/models/models.html?id=${encodeURIComponent(model.id)}&view=details&created`;
}


async function loadModelCreatePage() {
  try {
    if (!(await isAuthenticated())) {
      showGate(false);
      return;
    }

    showGate(true);

    const modelFields = await loadModelFields();

    const modelForm = createPanelForm({
      noun: "model",
      backTo: { href: "/html/models/model_list.html", text: "← Back to models" },
      panels: MODEL_PANELS,
      fields: modelFields,

      submit: async state => {
        return submitModel(state);
      },
    });

    modelForm.initialise();
    modelForm.attach();
  } catch (error) {
    console.error("Failed to initialise the model create page:", error);
    // TODO add generic message page on each html
    showError(document.getElementById("container"), "Could not load this page.");
  }
}

loadModelCreatePage();

// Create a new model.
//
//   1. Identity     name, team
//   2. Links        optional links
//   3. Parameters   optional model parameters
//
// Every panel is schema-driven, so this page contributes no markup of its own.

import { MODEL_PANELS, loadModelFields } from "./modelSchema.js";
import { createModel } from "./modelApi.js";
import { isAuthenticated } from "../api.js";
import { showError } from "../utils.js";
import { showGate } from "../utils/gate.js";
import { createPanelForm } from "../pages/create-form.js";

const LIST = "/html/models/model_list.html";

const PANELS = [
  { panel: 1, required: ["name", "team_id"] },
  { panel: 2, required: [] },
  { panel: 3, required: [] },
];

async function loadModelCreatePage() {
  const elements = { gate: document.getElementById("gate") };

  try {
    if (!(await isAuthenticated())) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);

    const fields = await loadModelFields();

    const form = createPanelForm({
      title: "New model",
      description: "Describe the model you want to benchmark.",
      backTo: { href: LIST, text: "← Back to models" },
      panels: PANELS,
      schemaPanels: MODEL_PANELS,
      fields,
      cancelHref: LIST,
      submitLabel: "Create model",
      submitError: "Failed to create model",

      submit: async state => {
        const model = await createModel(state);

        return `/html/models/models.html?id=${encodeURIComponent(model.id)}&view=details&created`;
      },
    });

    form.mount();
    form.render();
    form.refresh();
    form.attach();
  } catch (error) {
    console.error("Failed to initialise the model create page:", error);

    showError(document.getElementById("container"), "Could not load this page.");
  }
}

loadModelCreatePage();

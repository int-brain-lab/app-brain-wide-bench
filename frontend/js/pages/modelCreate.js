// Create a new model.
//
// Contains 3 panels
//   1. Identity     model name and associated team
//   2. Links        optional links for the model
//   3. Parameters   optional model parameters
//
// Every panel is schema-driven, so this page contributes no markup of its own.

import { createModel } from "../api/modelApi.js";
import { loadModelFields } from "../schemas/modelSchema.js";
import { loadCreatePage } from "../templates/createPage.js";

const MODEL_PANELS = {
  identity: {
    type: "fields",
    title: "1. Choose a model name and the team it belongs to",
  },
  links: { type: "fields", title: "2. Add links to your models" },
  specification: { type: "fields", title: "3. Describe your model parameters" },
};

async function submitModel(state) {
  const model = await createModel(state);

  return `/html/models/models.html?id=${encodeURIComponent(model.id)}&view=details&created`;
}

loadCreatePage({
  noun: "model",
  title: "Create a new model",
  description: "Name it, link to it, and describe its parameters.",
  back: { text: "← Back to models", href: "/html/models/model_list.html" },

  fields: loadModelFields,
  panels: MODEL_PANELS,
  submit: submitModel,
});

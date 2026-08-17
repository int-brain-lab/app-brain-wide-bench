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
import { loadCreatePage } from "../pages/create-page.js";



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


loadCreatePage({
  noun: "model",
  backTo: { href: "/html/models/model_list.html", text: "← Back to models" },
  panels: MODEL_PANELS,
  fields: () => loadModelFields(),
  submit: state => submitModel(state),
});

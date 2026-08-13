import {getMyModels} from "../models/modelApi.js";


const SUBMISSION_FIELDS = {
  id: {
    label: "Submission id",
    input: "text",
    editable: false,
  },

  label: {
    label: "Name",
    input: "text",
    panel: 1,
    default: "",
  },

  model_id: {
    label: "Model id",
    input: "select",
    options: null,
    panel: 1,
  },

  model_name: {
    label: "Model name",
    input: "text",
    editable: false,
    panel: 1,
  },

  team_name: {
    label: "Team name",
    input: "text",
    editable: false,
    panel: 1,
  },

  team_id: {
    label: "Team id",
    input: "text",
    editable: false,
  },

  status: {
    label: "Status",
    input: "text",
    editable: false,
    panel: 1,
  },

  is_public: {
    label: "Public",
    input: "checkbox",
    panel: 2,
  },

  // `s3_key`, not `s3_url` — matches SubmissionDetail and the mock fixture.
  s3_key: {
    label: "S3 file name",
    input: "text",
    editable: false,
  },

  created_at: {
    label: "Created",
    input: "datetime-local",
    editable: false,
  },

  updated_at: {
    label: "Last updated",
    input: "datetime-local",
    editable: false,
  },

  narrative_public: {
    label: "Public narrative",
    input: "textarea",
    panel: 2,
  },

  narrative_private: {
    label: "Private narrative",
    input: "textarea",
    panel: 2,
  },

};


const SUBMISSION_PANELS = [
  { panel: 1, title: "Model", columns: 2 },
  { panel: 2, title: "Information", columns: 1 },
];



// Populate team_id's options (team id/name pairs) once, in place, since it's
// shared read-only enum-like data, not per-flow instance state.
async function loadSubmissionFields() {
  if (SUBMISSION_FIELDS.model_id.options !== null) {
    return SUBMISSION_FIELDS;
  }

  const models = await getMyModels();

  SUBMISSION_FIELDS.model_id.options = models.map(model => ({ value: model.id, label: model.name }));

  return SUBMISSION_FIELDS;
}


export { SUBMISSION_FIELDS, loadSubmissionFields, SUBMISSION_PANELS };

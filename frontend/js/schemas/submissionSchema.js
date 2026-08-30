// The submission form schema: what a submission is, and the panels it is edited in.

import { applyFieldMeta, getMeta } from "../api/metaApi.js";
import { getMyModels } from "../api/modelApi.js";

const SUBMISSION_FIELDS = {
  id: {
    label: "Submission id",
    input: "text",
    editable: false,
  },

  label: {
    label: "Name",
    input: "text",
    panel: "model",
    default: "",
    required: true,
  },

  model_id: {
    label: "Model id",
    input: "select",
    options: null,
    panel: "model",
    required: true,
  },

  model_name: {
    label: "Model name",
    input: "text",
    editable: false,
    panel: "model",
  },

  team_name: {
    label: "Team name",
    input: "text",
    editable: false,
    panel: "model",
  },

  // team_id: {
  //   label: "Team id",
  //   input: "text",
  //   editable: false,
  // },

  status: {
    label: "Status",
    input: "text",
    editable: false,
    panel: "model",
  },

  is_public: {
    label: "Public",
    input: "select",
    options: [true, false],
    panel: "information",
    required: true,
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
    panel: "information",
  },

  narrative_private: {
    label: "Private narrative",
    input: "textarea",
    panel: "information",
  },
};

const SUBMISSION_PANELS = {
  model: { type: "fields", title: "Model", columns: 2 },
  information: { type: "fields", title: "Information", columns: 1 },
};

// The help text, from /api/meta. Split out from loadSubmissionFields because a signed-out
// reader of a public submission sees the same description rows and cannot fetch the models
// below. See loadModelMeta, which is the same split for the same reason.
async function loadSubmissionMeta() {
  return applyFieldMeta(SUBMISSION_FIELDS, await getMeta(), "submission");
}

// The above plus the Model select, whose options are the caller's own models — per-user
// data, so a separate fetch rather than part of the meta document.
async function loadSubmissionFields() {
  await loadSubmissionMeta();

  if (SUBMISSION_FIELDS.model_id.options === null) {
    const models = await getMyModels();

    SUBMISSION_FIELDS.model_id.options = models.map((model) => ({
      value: model.id,
      label: model.name,
    }));
  }

  return SUBMISSION_FIELDS;
}

export {
  SUBMISSION_FIELDS,
  SUBMISSION_PANELS,
  loadSubmissionFields,
  loadSubmissionMeta,
};

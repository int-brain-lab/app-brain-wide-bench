import { loadTeams } from "./api.js";

const MODEL_FIELDS = {
  id: {
    label: "Model id",
    input: "text",
    editable: false,
  },

  name: {
    label: "Name",
    input: "text",
    panel: 1,
    default: "",
  },

  team_id: {
    label: "Team",
    input: "select",
    options: null,
    panel: 1,
  },

  team_name: {
    label: "Team name",
    input: "text",
    editable: false,
  },

  created_at: {
    label: "Created",
    input: "datetime-local",
    editable: false,
  },

  link_project: {
    label: "Project link",
    input: "url",
    panel: 2,
  },

  link_code: {
    label: "Project code",
    input: "url",
    panel: 2,
  },

  publication_doi: {
    label: "Publication (DOI)",
    input: "text",
    panel: 2,
  },

  link_weights: {
    label: "Model weights",
    input: "url",
    panel: 2,
  },

  n_parameters: {
    label: "N parameters",
    input: "number",
    panel: 3,
  },

  temporal_context_s: {
    label: "Temporal context (s)",
    input: "number",
    default: 1,
    panel: 3,
  },

  is_pretrained: {
    label: "Pretrained",
    input: "select",
    panel: 3,
    options: [true, false]
  },

  pretrained_in_modalities: {
    label: "Pretrained in modalities",
    input: "checkbox-list",
    options: ['spikes', 'anatomy', 'behavior'],
    default: [],
    panel: 3,
  },

  pretrained_out_modalities: {
    label: "Pretrained out modalities",
    input: "checkbox-list",
    options: ['spikes', 'anatomy', 'behavior'],
    default: [],
    panel: 3,
  },

  pretraining_data: {
    label: "Pretraining data",
    input: "textarea",
    panel: 3,
  },
};






// Populate team_id's options (team id/name pairs) once, in place, since it's
// shared read-only enum-like data, not per-flow instance state.
async function loadModelFields() {
  if (MODEL_FIELDS.team_id.options !== null) {
    return MODEL_FIELDS;
  }

  const teams = await loadTeams();

  MODEL_FIELDS.team_id.options = teams.map(team => ({ value: team.id, label: team.name }));

  return MODEL_FIELDS;
}


export { MODEL_FIELDS, loadModelFields };

import { getMyTeams } from "../api/teamApi.js";

const MODEL_FIELDS = {
  id: {
    label: "Model id",
    input: "text",
    editable: false,
    panel: 1,
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
    panel: 1,
  },

  // `icon` is a Lucide name, shown next to the label on display rows only.
  link_project: {
    label: "Project link",
    input: "url",
    panel: 2,
    icon: "link",
  },

  link_code: {
    label: "Project code",
    input: "url",
    panel: 2,
    icon: "code",
  },

  publication_doi: {
    label: "Publication (DOI)",
    input: "text",
    panel: 2,
    icon: "book-open",
  },

  link_weights: {
    label: "Model weights",
    input: "url",
    panel: 2,
    icon: "database",
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


// How the panels above are titled and laid out. Lives here, next to the `panel`
// numbers it names, so the details view and its edit form can't drift apart —
// both build their cards from this one list via panelGroups().
//
// Order here is render order; a key with no `panel` (team_name) is intentionally
// absent from every card.
//
// `columns` is the read-only layout — the edit form overrides it to 1 so inputs
// get the full card width. Model specification stays single-column because its
// textarea and checkbox lists are the tall fields that need the room.
const MODEL_PANELS = [
  { panel: 1, title: "Identity", columns: 2 },
  { panel: 2, title: "Links", columns: 1, inline: true },
  { panel: 3, title: "Model specification", columns: 2 },
];




// Populate team_id's options (team id/name pairs) once, in place, since it's
// shared read-only enum-like data, not per-flow instance state.
async function loadModelFields() {
  if (MODEL_FIELDS.team_id.options !== null) {
    return MODEL_FIELDS;
  }

  const teams = await getMyTeams()

  MODEL_FIELDS.team_id.options = teams.map(team => ({ value: team.id, label: team.name }));

  return MODEL_FIELDS;
}


export { MODEL_FIELDS, MODEL_PANELS, loadModelFields };

import { getMeta } from "../api/metaApi.js";
import { getMyTeams } from "../api/teamApi.js";
import { getIcon } from "../components/icons.js";
import { applyFieldMeta } from "./fieldMeta.js";

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
    required: true,
  },

  team_id: {
    label: "Team",
    input: "select",
    options: null,
    panel: 1,
    required: true,
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
    icon: getIcon("link"),
  },

  link_code: {
    label: "Project code",
    input: "url",
    panel: 2,
    icon: getIcon("code"),
  },

  publication_doi: {
    label: "Publication (DOI)",
    input: "text",
    panel: 2,
    icon: getIcon("publication"),
  },

  link_weights: {
    label: "Model weights",
    input: "url",
    panel: 2,
    icon: getIcon("data"),
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
    options: [true, false],
    required: true,
  },

  // `enum` names a list on /api/meta rather than spelling the options out — this pair used
  // to hardcode three of the five modalities, which is exactly the drift that cost.
  pretrained_in_modalities: {
    label: "Pretrained in modalities",
    input: "checkbox-list",
    enum: "modality",
    default: [],
    panel: 3,
  },

  pretrained_out_modalities: {
    label: "Pretrained out modalities",
    input: "checkbox-list",
    enum: "modality",
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

// The enum options and the help text, from /api/meta. Split out from loadModelFields
// because every reader needs it and not every reader is signed in: the details cards show
// the same descriptions as the edit form, and a signed-out visitor reading a public model
// can't fetch the teams below.
async function loadModelMeta() {
  return applyFieldMeta(MODEL_FIELDS, await getMeta(), "model");
}

// The above plus the Team select, whose options are the caller's own teams — per-user data,
// so it stays a separate fetch rather than joining the meta document.
//
// Both fill MODEL_FIELDS in place, once; see applyFieldMeta on why in place.
async function loadModelFields() {
  await loadModelMeta();

  if (MODEL_FIELDS.team_id.options === null) {
    const teams = await getMyTeams();

    MODEL_FIELDS.team_id.options = teams.map((team) => ({
      value: team.id,
      label: team.name,
    }));
  }

  return MODEL_FIELDS;
}

export { MODEL_FIELDS, MODEL_PANELS, loadModelFields, loadModelMeta };

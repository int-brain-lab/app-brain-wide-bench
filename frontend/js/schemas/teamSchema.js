// The team form schema.
//
// Only `name` is editable — TeamUpdate declares `extra="forbid"`, so a second editable key
// would be a 422. The counts are server aggregates; they carry a panel so the details card
// shows them, which `fieldsForPanel` keeps out of the form.

const TEAM_FIELDS = {
  id: {
    label: "Team id",
    input: "text",
    editable: false,
  },

  name: {
    label: "Team name",
    input: "text",
    panel: "team",
    default: "",
    required: true,
  },

  n_members: {
    label: "Members",
    input: "number",
    editable: false,
    panel: "team",
  },

  n_models: {
    label: "Models",
    input: "number",
    editable: false,
    panel: "team",
  },
};

const TEAM_PANELS = { team: { type: "fields", title: "Team" } };

export { TEAM_FIELDS, TEAM_PANELS };

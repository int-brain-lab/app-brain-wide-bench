// The team form schema. Only `name` is editable — TeamUpdate accepts nothing else, and
// it declares `extra="forbid"`, so a second editable key here would be a 422 rather than
// an ignored field.
//
// The counts are read-only: they're aggregates the server computes. They still carry a
// panel so the details card shows them as display rows, the way MODEL_FIELDS' id and
// created_at do — `fieldsForPanel` filters non-editable keys out of the *form*, so this
// doesn't make them editable.

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

// The user form schema.
//
// Only `name` and `affiliation` are editable — the two fields PATCH /api/users/me accepts.
// The rest come from Auth0 and are `editable: false`, so they draw as read-only rows and
// createFieldState drops them from the draft.
const USER_FIELDS = {
  name: {
    label: "Name",
    input: "text",
    panel: "details",
    default: "",
  },

  affiliation: {
    label: "Affiliation",
    input: "text",
    panel: "details",
    default: "",
  },

  email: {
    label: "Email",
    input: "text",
    editable: false,
    panel: "provider",
  },

  provider: {
    label: "Sign-in provider",
    input: "text",
    editable: false,
    panel: "provider",
  },

  orcid_id: {
    label: "ORCID",
    input: "text",
    editable: false,
    panel: "provider",
  },

  created_at: {
    label: "Member since",
    input: "datetime-local",
    editable: false,
    panel: "provider",
  },
};

// The panel split is the editable/not split, so the page needn't explain per row why four
// of the six have no input.
const USER_PANELS = {
  details: { type: "fields", title: "Your details", columns: 2 },
  provider: { type: "fields", title: "From your sign-in provider", columns: 2 },
};

export { USER_FIELDS, USER_PANELS };

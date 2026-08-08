// Only `name` and `affiliation` are editable — they're the two fields
// PATCH /api/users/me accepts (see UserUpdate). Everything else comes from Auth0
// and is marked `editable: false`, which makes renderFields emit it as a
// read-only row rather than an input; createFieldState also drops those keys, so
// the draft is exactly what's safe to send back.
const USER_FIELDS = {
  name: {
    label: "Name",
    input: "text",
    panel: 1,
    default: "",
  },

  affiliation: {
    label: "Affiliation",
    input: "text",
    panel: 1,
    default: "",
  },

  email: {
    label: "Email",
    input: "text",
    editable: false,
  },

  provider: {
    label: "Sign-in provider",
    input: "text",
    editable: false,
  },

  orcid_id: {
    label: "ORCID",
    input: "text",
    editable: false,
  },

  created_at: {
    label: "Member since",
    input: "datetime-local",
    editable: false,
  },
};

export { USER_FIELDS };

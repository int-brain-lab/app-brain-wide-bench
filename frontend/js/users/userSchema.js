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
    panel: 2,
  },

  provider: {
    label: "Sign-in provider",
    input: "text",
    editable: false,
    panel: 2,
  },

  orcid_id: {
    label: "ORCID",
    input: "text",
    editable: false,
    panel: 2,
  },

  created_at: {
    label: "Member since",
    input: "datetime-local",
    editable: false,
    panel: 2,
  },
};


// The panel split is the editable/not split: panel 1 is what PATCH /api/users/me accepts,
// panel 2 is what the sign-in provider supplies. Naming that in the layout saves the page
// explaining per row why four of the six have no input.
//
// Same role as MODEL_PANELS and TEAM_PANELS — the display view takes these as declared and
// the edit form overrides `columns` to 1, so one list serves both.
const USER_PANELS = [
  { panel: 1, title: "Your details", columns: 2 },
  { panel: 2, title: "From your sign-in provider", columns: 2 },
];

export { USER_FIELDS, USER_PANELS };

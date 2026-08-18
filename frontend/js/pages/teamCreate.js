// Create a new team.
//
// Contains 2 panels
//   1. Identity     team name
//   2. Members      add members to the team
//
//  Panel 1 is schema-driven, panel 2 is component-driven and its markup and events are
//  built and controlled via teamMembers.js.

import { createTeam } from "../api/teamApi.js";
import { loadMe } from "../api/userApi.js";
import { buildMembersPanel, createMembersSection } from "../widgets/teamMembers.js";
import { TEAM_FIELDS } from "../schemas/teamSchema.js";
import { showFailure, showMessage } from "../core/utils.js";
import { loadCreatePage } from "../templates/create-page.js";
import {
  pageMessage,
  showPageError,
} from "../templates/record-page.js";

// Panel 2 requires nothing of its own: a team with no one but its creator is valid, and the
// creator is added by the server regardless. Its `build` marks it as the page's own, so the
// members section's listeners survive every re-render of panel 1.
const TEAM_PANELS = [
  {
    panel: 1,
    required: ["name"]
  },
  {
    panel: 2,
    required: [],
    build: buildMembersPanel
  },
];

// Stands in for the team that doesn't exist yet. The creator is listed from the start
// because POST /api/teams adds them as the first member — showing them is reporting
// what will happen, not pre-empting it.
// The creator is the team's owner — POST /api/teams makes them one, and the row
// has to say so rather than defaulting to "collaborator" like a staged addition.
async function loadCreator() {
  const me = await loadMe();

  if (!me) {
    showPageError("Could not load your account.");
    return null;
  }

  return { me, draft: { id: null, members: [{ ...me, role: "owner" }] }, members: null };
}

// A thrown error is the form's to report; returning without a destination is this page
// saying "created, but not entirely" — the one outcome that must stay on screen.
// Two api requests. First create the team and then add members. Doesn't prevent team
// from being created if a member does not exist.
async function submitTeam(state, draft, members) {

  // The whole state: createTeam builds the payload from it and trims the name itself.
  // Passing `state.name` here sent a *string* to be object-spread, so the body went out
  // as {"0":"M","1":"y",…} with no name at all.
  const team = await createTeam(state);

  draft.id = team.id;

  // Staged additions only reach the server here. `apply` collects per-member failures
  // rather than throwing, so one unknown address doesn't strand the rest.
  const failed = await members.apply();

  // `&created` is read by teamView.js, which then offers the next step — registering a
  // model for the team just made. It has to travel in the URL: navigating discards this
  // document, so anything rendered here would belong to a page about to vanish.
  if (failed.length === 0) {
    return `/html/teams/teams.html?id=${encodeURIComponent(team.id)}&view=details&created`;
  }

  // Deliberately no destination: this message is the only record of who didn't make it,
  // and the team's own page can't say what was attempted.
  showFailure(
    pageMessage(),
    "Team created, but some members could not be added — they may not have signed in yet. "
    + "Add them from the team page.",
    new Error(failed.join("; ")),
  );

  return null;
}

loadCreatePage({
  noun: "team",
  backTo: { href: "/html/teams/team_list.html", text: "← Back to teams" },
  panels: TEAM_PANELS,
  fields: TEAM_FIELDS,
  load: loadCreator,

  setup: (form, context) => {
    context.members = createMembersSection({
      getTeam: () => context.draft,
      onMessage: (message, failed) => (failed
        ? showFailure(pageMessage(), message)
        : showMessage(pageMessage(), message)),
      canRemove: member => member.id !== context.me.id,
    });

    // Staged mode starts read-only, for teamView.js where the block only opens on Edit.
    // Here the panel's own lock is the gate, so it is open from the start.
    context.members.setEditing(true);
  },

  submit: (state, context) => submitTeam(state, context.draft, context.members),
});

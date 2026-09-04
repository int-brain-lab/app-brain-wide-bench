// Create a new team.
//
// Contains 2 panels
//   1. Identity     team name
//   2. Members      add members to the team
//
// Panel 1 is schema-driven, panel 2 is component-driven and its markup and events are
// built and controlled via teamMembers.js.

import { createTeam } from "../api/teamApi.js";
import { loadMe } from "../api/userApi.js";
import { TEAM_FIELDS } from "../schemas/teamSchema.js";
import {
  buildFailureMessage,
  buildInfoMessage,
} from "../components/messages.js";
import {
  buildMembersPanel,
  createMembersSection,
} from "../widgets/teamMembers.js";
import { loadCreatePage } from "../templates/createPage.js";
import {
  clearMessage,
  renderMessage,
  renderPageError,
} from "../templates/pageChrome.js";

// Panel 2 has no `complete`: a team with only its creator is valid. `build` marks it as the
// page's own, so its listeners survive a re-render of the team panel.
const TEAM_PANELS = {
  team: { type: "fields", title: "1. Choose a team name" },
  members: {
    type: "component",
    title: "2. Add members to the team",
    build: buildMembersPanel,
  },
};

// Stands in for the team that doesn't exist yet. POST /api/teams adds the creator as the
// first member, as owner.
async function loadTeamContext() {
  const me = await loadMe();

  if (!me) {
    renderPageError("Could not load your account.");
    return null;
  }

  return {
    me,
    draft: { id: null, members: [{ ...me, role: "owner" }] },
    members: null,
  };
}

// Built between the form's `initialise()` and `attach()`, so a re-render can't destroy
// its listeners.
function setupComponentPanels(form, context) {
  context.members = createMembersSection({
    getTeam: () => context.draft,

    onMessage: (message, failed) => {
      if (!message) {
        clearMessage();
      } else if (failed) {
        renderMessage(buildFailureMessage(message));
      } else {
        renderMessage(buildInfoMessage(message));
      }
    },

    canRemove: (member) => member.id !== context.me.id,
  });

  // Open from the start: here the panel's own lock is the gate.
  context.members.setEditing(true);
}

// Two requests: create the team, then add its members. Returning no destination means
// "created, but not entirely" — the page stays open to say so.
async function submitTeam(state, draft, members) {
  // The whole state: createTeam builds the payload and trims the name itself.
  const team = await createTeam(state);

  draft.id = team.id;

  // Staged additions reach the server here. `apply` collects per-member failures rather
  // than throwing.
  const failed = await members.apply();

  // `&created` is read by teamView.js. It travels in the URL because navigating discards
  // this document.
  if (failed.length === 0) {
    return `/html/teams/teams.html?id=${encodeURIComponent(team.id)}&view=details&created`;
  }

  renderMessage(
    buildFailureMessage(
      "Team created, but some members could not be added — they may not have signed in yet. " +
        "Add them from the team page.",
      new Error(failed.join("; ")),
    ),
  );

  return null;
}

loadCreatePage({
  noun: "team",
  title: "Create a new team",
  description: "Name it and add the people who will work in it.",
  back: { text: "← Back to teams", href: "/html/teams/team_list.html" },

  fields: TEAM_FIELDS,
  panels: TEAM_PANELS,
  submit: (state, context) => submitTeam(state, context.draft, context.members),

  load: loadTeamContext,
  setup: setupComponentPanels,
});

// Create a new team.
//
//   1. Details  the team name
//   2. Members  who else should have access
//
// The members block is createMembersSection — the same module teams.html mounts for
// editing. It fits creation because it records changes rather than sending them, and
// `apply()` reads the team id at call time: the draft below starts with a null id, POST
// /api/teams fills it in, and only then does apply() have somewhere to send the additions.
//
// Two API steps, not one, and deliberately so: the team is created first and exists
// regardless, so a member who can't be added is reported by name rather than costing the
// whole form.

import { createTeam } from "./teamApi.js";
import { loadMe } from "../users/userApi.js";
import { buildMembersCard, createMembersSection } from "./teamMembers.js";
import { TEAM_FIELDS, TEAM_PANELS } from "./teamSchema.js";
import { showError, showMessage } from "../utils.js";
import { isAuthenticated } from "../api.js";
import { showGate } from "../utils/gate.js";
import { createPanelForm } from "../pages/create-form.js";
import { pageMessage } from "../pages/record-page.js";

const LIST = "/html/teams/team_list.html";

// Panel 2 requires nothing of its own: a team with no one but its creator is valid, and the
// creator is added by the server regardless. Its `build` marks it as the page's own, so the
// members section's listeners survive every re-render of panel 1.
const PANELS = [
  { panel: 1, required: ["name"] },
  { panel: 2, required: [], build: buildMembersCard },
];

// A thrown error is the form's to report; returning without a destination is this page
// saying "created, but not entirely" — the one outcome that must stay on screen.
async function submitTeam(state, draft, members) {
  showMessage(pageMessage(), "Creating team…");

  const team = await createTeam(state.name.trim());

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
  showError(
    pageMessage(),
    `Team created, but could not add: ${failed.join("; ")}. `
    + "They may not have signed in yet — add them from the team page.",
  );

  return null;
}

async function loadTeamCreatePage() {
  const elements = { gate: document.getElementById("gate") };

  try {
    if (!(await isAuthenticated())) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);

    const me = await loadMe();

    if (!me) {
      showError(document.getElementById("container"), "Could not load your account.");
      return;
    }

    // Stands in for the team that doesn't exist yet. The creator is listed from the start
    // because POST /api/teams adds them as the first member — showing them is reporting
    // what will happen, not pre-empting it.
    const draft = { id: null, members: [me] };

    let members = null;

    const form = createPanelForm({
      title: "New team",
      description:
        "Name the team and add anyone who should have access to its models and submissions.",
      backTo: { href: LIST, text: "← Back to teams" },
      panels: PANELS,
      schemaPanels: TEAM_PANELS,
      fields: TEAM_FIELDS,
      cancelHref: LIST,
      submitLabel: "Create team",
      submit: state => submitTeam(state, draft, members),
    });

    // After mount, so the members block's markup is in the DOM for it to bind to.
    form.mount();

    members = createMembersSection({
      getTeam: () => draft,
      onMessage: message => showMessage(pageMessage(), message),
      canRemove: member => member.id !== me.id,
    });

    // Staged mode starts read-only, for teamView.js where the block only opens on Edit.
    // Here the panel's own lock is the gate, so it is open from the start.
    members.setEditing(true);

    form.render();
    form.refresh();
    form.attach();
  } catch (error) {
    console.error("Failed to initialise the team create page:", error);

    showError(document.getElementById("container"), "Team create page could not be loaded.");
  }
}

loadTeamCreatePage();

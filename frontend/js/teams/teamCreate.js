// Create a new team.
//
// The form is a single page with two panels. The second is locked until the first is
// complete, the same shape modelCreate.js and submissionCreate.js use.
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
// whole form. That's why submit navigates to the new team on success but stays put when
// some members failed — the message is the only place that information exists.

import { createTeam } from "./teamApi.js";
import { loadMe } from "../users/userApi.js";
import { createMembersSection } from "./teamMembers.js";
import { TEAM_FIELDS, TEAM_PANELS } from "./teamSchema.js";
import {
  attachFieldEvents,
  createFieldState,
  panelGroups,
  renderFields,
  renderGroups,
} from "../utils/form-fields.js";
import { showError, showMessage } from "../utils.js";
import { isAuthenticated } from "../api.js";
import { showGate } from "../utils/gate.js";

// ─── PANEL CONFIGURATION ────────────────────────────────────────────────────

// Panel 2 requires nothing of its own: a team with no one but its creator is valid, and
// the creator is added by the server regardless.
const PANELS = [
  { panel: 1, required: ["name"] },
  { panel: 2, required: [] },
];

const PANEL_BY_NUMBER = new Map(PANELS.map(panel => [panel.panel, panel]));

// ─── STATE HELPERS ──────────────────────────────────────────────────────────

function isFilled(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;

  return true;
}

function isPanelComplete(panelNumber, state) {
  const panel = PANEL_BY_NUMBER.get(panelNumber);

  return (panel?.required ?? []).every(key => isFilled(state[key]));
}

function isPanelOpen(panelNumber, state) {
  return PANELS
    .filter(panel => panel.panel < panelNumber)
    .every(panel => isPanelComplete(panel.panel, state));
}

// ─── DOM ────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    gate: document.getElementById("gate"),
    message: document.getElementById("form-message"),
    panels: document.getElementById("team-panels"),
    createButton: document.getElementById("create-team"),
  };
}

function getPanel(elements, panelNumber) {
  return elements.panels.querySelector(`[data-panel="${panelNumber}"]`);
}

// ─── PANEL RENDERING ────────────────────────────────────────────────────────

// Only the schema-driven panel is rendered. Panel 2's markup is static, because the
// members section attaches listeners to elements inside it that must outlive a re-render.
function renderPanels(elements, state, fields) {
  for (const panel of TEAM_PANELS) {
    const panelElement = getPanel(elements, panel.panel);

    if (!panelElement) continue;

    const groups = panelGroups(fields, [panel], {
      editableOnly: true,
      columns: 1,
    });

    panelElement.innerHTML = renderGroups(groups, state, fields, renderFields);
  }

  globalThis.lucide?.createIcons?.();
}

function applyLocks(elements, state) {
  for (const panel of PANELS) {
    const panelElement = getPanel(elements, panel.panel);

    if (panelElement) {
      panelElement.disabled = !isPanelOpen(panel.panel, state);
    }
  }
}

// A team can be created with no one but its creator, so the only gate is the name.
function updateSubmit(elements, state) {
  elements.createButton.disabled = !isPanelComplete(1, state);
}

// ─── SUBMIT ─────────────────────────────────────────────────────────────────

// The draft is mutated rather than replaced so the members section — which holds
// `getTeam` as a closure — sees the real id once the team exists.
async function handleSubmit(elements, state, draft, members) {
  elements.createButton.disabled = true;
  showMessage(elements.message, "Creating team…");

  let team;

  try {
    team = await createTeam(state.name.trim());
  } catch (error) {
    console.error(error);

    showError(elements.message, error.message);
    updateSubmit(elements, state);
    return;
  }

  draft.id = team.id;

  // Staged additions only reach the server here. `apply` collects per-member failures
  // rather than throwing, so one unknown address doesn't strand the rest.
  const failed = await members.apply();

  // `&created` is read by teamView.js, which then offers the next step — registering a
  // model for the team just made. It has to travel in the URL: this assignment navigates, so
  // anything rendered here would belong to a document about to be replaced.
  if (failed.length === 0) {
    window.location.href =
      `/html/teams/teams.html?id=${encodeURIComponent(team.id)}&view=details&created`;
    return;
  }

  // Deliberately does not navigate: this message is the only record of who didn't make
  // it, and the team's own page can't say what was attempted.
  showError(
    elements.message,
    `Team created, but could not add: ${failed.join("; ")}. `
    + "They may not have signed in yet — add them from the team page.",
  );

  elements.createButton.disabled = false;
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadTeamCreatePage() {
  const elements = getElements();

  try {
    if (!(await isAuthenticated())) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);

    const me = await loadMe();

    if (!me) {
      showError(elements.message, "Could not load your account.");
      return;
    }

    const fields = TEAM_FIELDS;
    const state = createFieldState(fields);

    // Stands in for the team that doesn't exist yet. The creator is listed from the
    // start because POST /api/teams adds them as the first member — showing them is
    // reporting what will happen, not pre-empting it.
    const draft = { id: null, members: [me] };

    const members = createMembersSection({
      getTeam: () => draft,
      onMessage: message => showMessage(elements.message, message),
      canRemove: member => member.id !== me.id,
    });

    // Staged mode starts read-only, for teamView.js where the block only opens on
    // Edit. Here the panel's own lock is the gate, so the block is open from the start.
    members.setEditing(true);

    renderPanels(elements, state, fields);
    applyLocks(elements, state);
    updateSubmit(elements, state);

    attachFieldEvents(elements.panels, state, fields, () => {
      applyLocks(elements, state);
      updateSubmit(elements, state);
    });

    elements.createButton.addEventListener("click", () =>
      handleSubmit(elements, state, draft, members));

    globalThis.lucide?.createIcons?.();
  } catch (error) {
    console.error("Failed to initialise the team create page:", error);

    showError(elements.message, "Team create page could not be loaded.");
  }
}

loadTeamCreatePage();

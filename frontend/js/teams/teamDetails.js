// Team details
//
// A page showing the details for a single team.
//
// The page contains an edit button that allows the user to update editable fields.
// The fields and title of each panel in the page is defined in TEAM_PANELS.
// Editable fields are defined in the TEAM_FIELDS.
//
// Membership is edited here too, by the same createMembersSection team_create.html mounts.
// It stages its changes — nothing reaches the server until this page's Save applies them
// alongside the rename, because a page with a Save button shouldn't have half its controls
// quietly bypass it.

import { Editor } from "../utils/editor.js";
import {
  TEAM_FIELDS,
  TEAM_PANELS,
} from "./teamSchema.js";
import {
  loadTeam,
  updateTeam,
} from "./teamApi.js";
import { showError, showMessage } from "../utils.js";
import {
  panelGroups,
  renderDisplayFields,
  renderGroups,
} from "../utils/form-fields.js";
import { createMembersSection } from "./teamMembers.js";
import { appendCreateCard } from "../utils/create-card.js";
import { isAuthenticated } from "../api.js";
import { showGate } from "../utils/gate.js";


// ─── DOM ────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    gate: document.getElementById("gate"),
    message: document.getElementById("form-message"),
    title: document.getElementById("team-title"),
    description: document.getElementById("team-description"),
    backLink: document.getElementById("back-to-team"),
    details: document.getElementById("team-details"),
    postCreate: document.getElementById("team-post-create"),
    editButton: document.getElementById("edit-team"),
    saveButton: document.getElementById("save-team"),
    cancelButton: document.getElementById("cancel-team"),
  };
}

// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(elements, team) {
  elements.title.textContent = team.name;

  elements.description.textContent = [
    `${team.n_members} member${team.n_members === 1 ? "" : "s"}`,
    `${team.n_models} model${team.n_models === 1 ? "" : "s"}`,
  ].join(" · ");
}

function renderBackLink(elements, team) {
  elements.backLink.textContent = `← Back to ${team.name}`;
  elements.backLink.href =
    `/html/teams/team_dashboard.html?id=${encodeURIComponent(team.id)}`;
}

function renderDetails(elements, team, fields) {
  const groups = panelGroups(fields, TEAM_PANELS);

  elements.details.innerHTML =
    renderGroups(
      groups,
      team,
      fields,
      renderDisplayFields,
    );
}

// A rename changes the header and the back link as well as the card, and the counts in the
// header move when members are added — so a save re-renders all four together.
function renderAll(elements, team, fields, members) {
  renderHeader(elements, team);
  renderBackLink(elements, team);
  renderDetails(elements, team, fields);
  members.render();
}

// ─── EDITOR ─────────────────────────────────────────────────────────────────

function attachEditor(elements, context, fields, members) {
  // Set by `save`, read by `onSaved`. The editor's save must return the one record it
  // merges, so the per-member failures have no way through — they're held here, scoped to
  // this editor rather than at module level.
  let failedMembers = [];

  Editor({
    container: elements.details,
    editButton: elements.editButton,
    saveButton: elements.saveButton,
    cancelButton: elements.cancelButton,
    record: context.team,
    fields: fields,
    groups: () => panelGroups(fields, TEAM_PANELS, { columns: 1 }),

    // The members block is read-only until the page enters edit mode. onEdit also fires
    // for the ?edit deep link below, since that goes through the editor's startEditing.
    onEdit: () => members.setEditing(true),

    // Members first, then the rename: PATCH answers with the full TeamDetail, so doing it
    // last means the response already reflects the membership changes and onSaved can
    // re-render from it without re-fetching.
    save: async draft => {
      failedMembers = await members.apply();

      return updateTeam(context.team.id, draft);
    },

    onSaved: saved => {
      // Mutated in place by the editor, so this is the same object the members section's
      // getTeam already returns — assigned anyway so the page never depends on that.
      context.team = saved;

      members.setEditing(false);
      renderAll(elements, saved, fields, members);

      // A member that couldn't be added doesn't undo the rename, so both outcomes are
      // reported rather than the failure replacing the success.
      if (failedMembers.length === 0) {
        showMessage(elements.message, "Changes saved.");
      } else {
        showError(
          elements.message,
          `Saved, but some members could not be changed — ${failedMembers.join("; ")}`,
        );
      }

      failedMembers = [];
    },

    onCancel: () => {
      members.reset();
      members.setEditing(false);
      renderDetails(elements, context.team, fields);
    },

    onError: message => showError(elements.message, message),
  })
    .attach();
}

// Shown only when team_create.html sent us here, which it signals with `&created`. A team
// made moments ago owns nothing yet, and this is the one moment we know that without asking
// — so the page points at the next step rather than being a dead end.
//
// Absent on every other visit: the team dashboard reports what a team owns, and repeating
// the prompt there would be noise.
function renderPostCreate(elements) {
  if (!new URLSearchParams(location.search).has("created")) return;

  appendCreateCard(elements.postCreate, {
    href: "/html/models/model_create.html",
    label: "Register your first model for this team",
  });
}

// The dashboard's Edit button links here with `&edit` so it lands in edit mode rather than
// on the read-only card. Clicking the button rather than calling startEditing keeps one
// path into edit mode — which is what onEdit above hangs off.
function openEditIfRequested(elements) {
  if (new URLSearchParams(location.search).has("edit")) {
    elements.editButton.click();
  }
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadTeamDetailsPage() {
  const elements = getElements();

  try {
    if (!(await isAuthenticated())) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);

    const teamId = new URLSearchParams(location.search).get("id");

    if (!teamId) {
      showError(elements.message, "No team id in the URL.");
      return;
    }

    const team = await loadTeam(teamId);

    if (!team) {
      showError(elements.message, `Could not load team ${teamId}.`);
      return;
    }

    const fields = TEAM_FIELDS;

    // An object rather than a bare variable so the members section's getTeam closure and
    // the editor share one reference to the current record, which a save replaces.
    const context = { team };

    const members = createMembersSection({
      getTeam: () => context.team,
      onMessage: message => showMessage(elements.message, message),
    });

    renderAll(elements, team, fields, members);

    attachEditor(elements, context, fields, members);
    openEditIfRequested(elements);
    renderPostCreate(elements);

    globalThis.lucide?.createIcons?.();
  } catch (error) {
    console.error(
      "Failed to load team details:",
      error,
    );

    showError(
      elements.message,
      "Team details page could not be loaded.",
    );
  }
}

loadTeamDetailsPage();

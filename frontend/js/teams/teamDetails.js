import { createDetailEditor } from "../utils/detail-editor.js";
import { TEAM_FIELDS, TEAM_PANELS } from "./teamSchema.js";
import { loadTeam, updateTeam } from "./teamApi.js";
import { renderMessage } from "../utils.js";
import { panelGroups, renderDisplayFields, renderGroups } from "../utils/form-fields.js";
import { attachMembersSection } from "./teamMembersSection.js";

// Rename plus membership, both behind the one Edit/Save/Cancel. The members block is the
// same one team_members.html mounts, in `staged` mode: nothing it does reaches the server
// until Save, because a page with a Save button shouldn't have half its controls quietly
// bypass it.
//
// `context.team` is mutated in place so the section's getTeam sees the current record
// after a save replaces it.
const context = { team: null };

// Set in loadTeamDetailsPage; the editor's callbacks below drive it.
let members = null;


// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(team) {
  document.getElementById("team-title").textContent = team.name;
  document.getElementById("team-description").textContent =
    `${team.n_members} member${team.n_members === 1 ? "" : "s"} · ` +
    `${team.n_models} model${team.n_models === 1 ? "" : "s"}`;
}

function renderBackLink(team) {
  const backToTeam = document.getElementById('back-to-team');
  backToTeam.textContent = `← Back to ${team.name}`;
  backToTeam.href = `/html/teams/team_dashboard.html?id=${encodeURIComponent(team.id)}`;
}

// The read-only view, and what the page shows on load. Without it the container the
// editor writes into just sits empty until Edit is clicked, which reads as a broken page.
function renderDetails(team) {
  document.getElementById("team-details").innerHTML =
    renderGroups(panelGroups(TEAM_FIELDS, TEAM_PANELS), team, TEAM_FIELDS, renderDisplayFields);
}

function showMessage(message, className = "info-msg") {
  const container = document.getElementById("form-message");

  if (!message) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }

  renderMessage(container, message, className);
}

function renderAll(team) {
  context.team = team;

  renderHeader(team);
  renderDetails(team);
  renderBackLink(team);
  members?.render();
}


// ─── EVENTS ─────────────────────────────────────────────────────────────────

// `groups` with the panel layout, same as the model and submission pages: the card shows
// the name alongside the two read-only counts, and the form shows just the name —
// panelGroups filters `editable: false` keys out of the editable set for us.
//
// PATCH answers with the full TeamDetail, so onSaved can re-render from what it's handed
// rather than re-fetching.
let failedMembers = [];

function attachEditor(team) {
  createDetailEditor({
    container: document.getElementById("team-details"),
    editButton: document.getElementById("edit-team"),
    saveButton: document.getElementById("save-team"),
    cancelButton: document.getElementById("cancel-team"),
    record: team,
    fields: TEAM_FIELDS,
    groups: () => panelGroups(TEAM_FIELDS, TEAM_PANELS, { columns: 1 }),
    // Members first, then the rename: the PATCH answers with the full TeamDetail, so
    // doing it last means the response already reflects the membership changes and
    // onSaved can re-render the whole page from it without re-fetching.
    save: async draft => {
      failedMembers = await members.apply();

      return updateTeam(team.id, draft);
    },
    onSaved: renamed => {
      members.setEditing(false);
      renderAll(renamed);

      // A member that couldn't be added doesn't undo the rename, so both outcomes are
      // reported rather than the failure replacing the success.
      showMessage(
        failedMembers.length === 0
          ? "Changes saved."
          : `Saved, but some members could not be changed — ${failedMembers.join("; ")}`,
        failedMembers.length === 0 ? "info-msg" : "error-msg",
      );
      failedMembers = [];
    },
    onCancel: () => {
      members.reset();
      members.setEditing(false);
      renderDetails(context.team);
    },
    onError: message => showMessage(message, "error-msg"),
  }).attach();
}


async function loadTeamDetailsPage() {
      const teamId = new URLSearchParams(location.search).get("id");

      if (!teamId) {
        showMessage("No team id in the URL.", "error-msg");
        return;
      }

      const team = await loadTeam(teamId);

      if (!team) {
        showMessage("Could not load this team.", "error-msg");
        return;
      }

      context.team = team;

      members = attachMembersSection({
        getTeam: () => context.team,
        onMessage: showMessage,
        staged: true,
      });

      renderAll(team);
      attachEditor(team);

      // createDetailEditor has no hook for *entering* edit mode, so the members block is
      // switched on from the Edit button directly — a second listener alongside the
      // editor's own, which is harmless since they do independent things.
      document.getElementById("edit-team")
        .addEventListener("click", () => members.setEditing(true));

      openEditIfRequested();

      globalThis.lucide?.createIcons?.();
}

// The dashboard's Edit button links here with `&edit` so it lands in edit mode rather
// than on the read-only card. Clicking the button rather than calling startEditing keeps
// one path into edit mode — the members section listens on that same click.
function openEditIfRequested() {
  if (new URLSearchParams(location.search).has("edit")) {
    document.getElementById("edit-team").click();
  }
}


loadTeamDetailsPage()

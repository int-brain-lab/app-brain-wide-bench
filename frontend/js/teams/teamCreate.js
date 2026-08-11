// Page entry for html/teams/team_create.html — name a team, pick its members, submit.
//
// Two API steps, not one: POST /api/teams then POST .../members per person. The team is
// created first and exists regardless, so a member who can't be added is reported by
// name rather than losing the whole form. That's why submit navigates to the new team's
// page on success but stays put when some members failed — the message is the only place
// that information exists.

import { addTeamMember, createTeam } from "./teamApi.js";
import { searchUsers } from "../users/userApi.js";
import { escapeHtml, initials, renderMessage } from "../utils.js";

// The server enforces this too; matching it here avoids a request per keystroke that
// can only 422.
const MIN_QUERY = 2;


// ─── STATE ──────────────────────────────────────────────────────────────────

// Keyed by id so the same person can't be added twice, and so removal is a delete
// rather than a scan.
const picked = new Map();


// ─── DOM ────────────────────────────────────────────────────────────────────

function teamName() {
  return document.getElementById("team-name");
}

function memberSearch() {
  return document.getElementById("member-search");
}

function memberResults() {
  return document.getElementById("member-results");
}

function memberChips() {
  return document.getElementById("member-chips");
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


// ─── SEARCH RESULTS ─────────────────────────────────────────────────────────

function userLabel(user) {
  return user.name || user.email;
}

function buildResult(user) {
  return `
    <div class="row" data-user-id="${escapeHtml(user.id)}">
      <div class="row left gap-md">
        <div class="user-logo">${escapeHtml(initials(userLabel(user)))}</div>
        <div class="column left">
          <p class="label">${escapeHtml(user.name || "—")}</p>
          <p class="metadata">${escapeHtml(user.email)}</p>
        </div>
      </div>
      <button type="button" class="btn add-member" data-user-id="${escapeHtml(user.id)}">
        + Add
      </button>
    </div>
  `;
}

function renderResults(users) {
  const container = memberResults();

  // Already-picked people are filtered out rather than shown disabled: the chips below
  // are where "already added" is visible, and a dead row in the results is just noise.
  const available = users.filter(user => !picked.has(user.id));

  if (available.length === 0) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }

  container.hidden = false;
  container.innerHTML = available.map(buildResult).join("");
}


// ─── CHIPS ──────────────────────────────────────────────────────────────────

function buildChip(user) {
  return `
    <span class="row left gap-sm" data-user-id="${escapeHtml(user.id)}">
      <span class="user-logo">${escapeHtml(initials(userLabel(user)))}</span>
      <span class="column left">
        <span class="label">${escapeHtml(user.name || user.email)}</span>
        <span class="metadata">${escapeHtml(user.email)}</span>
      </span>
      <button type="button" class="modal-close remove-member" data-user-id="${escapeHtml(user.id)}"
              aria-label="Remove ${escapeHtml(userLabel(user))}">x</button>
    </span>
  `;
}

function renderChips() {
  memberChips().innerHTML = [...picked.values()].map(buildChip).join("");
}


// ─── EVENTS ─────────────────────────────────────────────────────────────────

function attachSearch() {
  memberSearch().addEventListener("input", async event => {
    const query = event.target.value.trim();

    if (query.length < MIN_QUERY) {
      memberResults().hidden = true;
      memberResults().replaceChildren();
      return;
    }

    const users = await searchUsers(query);

    // Guard against an older request resolving after a newer one: only render if the
    // box still holds the query this call was made for.
    if (memberSearch().value.trim() !== query) {
      return;
    }

    renderResults(users);
  });

  // Delegated, so it survives every re-render of the results list.
  memberResults().addEventListener("click", event => {
    const button = event.target.closest(".add-member");
    if (!button) return;

    const row = button.closest("[data-user-id]");

    picked.set(button.dataset.userId, {
      id: button.dataset.userId,
      name: row.querySelector(".label").textContent.trim(),
      email: row.querySelector(".metadata").textContent.trim(),
    });

    renderChips();

    // Clearing the box is the signal that the pick landed — the chip appears below and
    // the results collapse rather than leaving a row that can no longer be added.
    memberSearch().value = "";
    memberResults().hidden = true;
    memberResults().replaceChildren();
  });

  memberChips().addEventListener("click", event => {
    const button = event.target.closest(".remove-member");
    if (!button) return;

    picked.delete(button.dataset.userId);
    renderChips();
  });
}


// ─── SUBMIT ─────────────────────────────────────────────────────────────────

// The team is created first, so a member that can't be added doesn't cost the team.
// Failures are collected rather than thrown so one bad address doesn't stop the rest.
async function addMembers(teamId) {
  const failed = [];

  for (const member of picked.values()) {
    try {
      await addTeamMember(teamId, member.email);
    } catch (err) {
      console.error(err);
      failed.push(member.email);
    }
  }

  return failed;
}

function attachSubmit() {
  const button = document.getElementById("create-team");

  button.addEventListener("click", async () => {
    const name = teamName().value.trim();

    // Checked here as well as server-side so the obvious mistake doesn't need a round
    // trip; the server rejects a blank name with a 422 regardless.
    if (!name) {
      showMessage("Give the team a name first.", "error-msg");
      teamName().focus();
      return;
    }

    button.disabled = true;
    showMessage("Creating team…");

    let team;
    try {
      team = await createTeam(name);
    } catch (err) {
      console.error(err);
      button.disabled = false;
      showMessage(err.message, "error-msg");
      return;
    }

    const failed = await addMembers(team.id);

    if (failed.length === 0) {
      window.location.href = `/html/teams/team_dashboard.html?id=${encodeURIComponent(team.id)}`;
      return;
    }

    // Deliberately does not navigate: this message is the only record of which members
    // didn't make it, and the team's own page can't tell you what was attempted.
    button.disabled = false;
    showMessage(
      `Team created, but could not add: ${failed.join(", ")}. `
      + `They may not have signed in yet — add them from the team page.`,
      "error-msg",
    );
  });
}


// ─── INITIALISATION ─────────────────────────────────────────────────────────

attachSearch();
attachSubmit();

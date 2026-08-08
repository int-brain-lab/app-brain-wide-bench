// The add/remove members block: an exact-match lookup above a table of current members.
//
// Shared by team_members.html and team_details.html, which differ in *when* a change
// reaches the server:
//
//   immediate (team_members.html)  each add or remove is its own request. The page has
//                                  no Save button, so there is nothing to defer to.
//
//   staged (team_details.html)     changes accumulate and are applied by that page's
//                                  Save, alongside the rename. A page with a Save button
//                                  shouldn't have some of its controls quietly bypass it.
//
// Both modes share the rendering, the lookup and the failure messages; only `apply`
// differs. The section owns its own pending state, so a caller can't half-apply it.
//
// Both pages provide the same ids:
//
//   #member-search   the lookup input
//   #member-results  the match, with its Add button
//   #member-list     the table of current members
//   #member-add      (staged only) the card holding the lookup, hidden outside edit mode

import { addTeamMember, removeTeamMember } from "./teamApi.js";
import { searchUsers } from "../users/api.js";
import { escapeHtml, initials, renderMessage } from "../utils.js";


function userLabel(user) {
  return user.name || user.email;
}


/**
 * @param getTeam    () => the current team record, re-read on every interaction so a
 *                   reload's replacement is picked up.
 * @param onChanged  async () => void, run after changes reach the server.
 * @param onMessage  (message, className) => void.
 * @param staged     hold changes until `apply()` instead of sending them immediately.
 * @returns {{ render, setEditing, reset, apply, hasChanges }}
 */
function attachMembersSection({ getTeam, onChanged, onMessage, staged = false }) {
  // Keyed by email for adds (that's what the endpoint takes) and by id for removes
  // (that's what its URL takes), so neither needs a lookup at apply time.
  const pendingAdds = new Map();
  const pendingRemoves = new Set();

  // Immediate mode is always "editing" — there is no other state for it to be in.
  let editing = !staged;


  // ─── RENDERING ────────────────────────────────────────────────────────────

  // What the table should show *now*: the server's members, minus staged removals, plus
  // staged additions. In immediate mode both sets are always empty, so this is just the
  // server's list.
  function effectiveMembers() {
    const current = (getTeam().members ?? []).filter(member => !pendingRemoves.has(member.id));

    return [...current, ...pendingAdds.values()];
  }

  function buildMemberRow(member, pending) {
    const remove = editing
      ? `<button type="button" class="btn member-remove"
                 data-user-id="${escapeHtml(member.id)}"
                 data-email="${escapeHtml(member.email)}">Remove</button>`
      : "";

    return `
      <tr>
        <td>${escapeHtml(member.name || "—")}</td>
        <td>${escapeHtml(member.email)}</td>
        <td class="row right">
          ${pending ? `<span class="badge sm pending">To add</span>` : ""}
          ${remove}
        </td>
      </tr>`;
  }

  function render() {
    const container = document.getElementById("member-list");
    const members = effectiveMembers();
    const addedEmails = new Set(pendingAdds.keys());

    // The lookup only makes sense while editing; in immediate mode it is always shown.
    const addCard = document.getElementById("member-add");
    if (addCard) addCard.hidden = !editing;

    if (members.length === 0) {
      renderMessage(container, "This team has no members.");
      return;
    }

    container.innerHTML = `
      <div class="table">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${members.map(member => buildMemberRow(member, addedEmails.has(member.email))).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  // The avatar is the confirmation step: an exact lookup can still land on the wrong
  // person when two share a name, so the match is shown to be recognised before it's
  // added rather than being added outright.
  function buildResult(user) {
    return `
      <div class="row">
        <div class="row left gap-md">
          <div class="user-logo">${escapeHtml(initials(userLabel(user)))}</div>
          <div class="column left">
            <p class="label">${escapeHtml(user.name || "—")}</p>
            <p class="metadata">${escapeHtml(user.email)}</p>
          </div>
        </div>
        <button type="button" class="btn primary add-member"
                data-email="${escapeHtml(user.email)}"
                data-id="${escapeHtml(user.id)}"
                data-name="${escapeHtml(user.name ?? "")}">
          + Add
        </button>
      </div>
    `;
  }

  function clearResults() {
    const container = document.getElementById("member-results");

    container.hidden = true;
    container.replaceChildren();
  }

  function renderResults(users) {
    const container = document.getElementById("member-results");

    // Anyone already on the table drops out — including a staged addition, which would
    // otherwise be addable twice.
    const shown = new Set(effectiveMembers().map(member => member.id));
    const available = users.filter(user => !shown.has(user.id));

    if (available.length === 0) {
      clearResults();
      return;
    }

    container.hidden = false;
    container.innerHTML = available.map(buildResult).join("");
  }


  // ─── CHANGES ──────────────────────────────────────────────────────────────

  async function addMember(user) {
    if (staged) {
      // Re-adding someone staged for removal is just cancelling that removal, not a
      // separate add — otherwise apply() would DELETE then POST the same person.
      if (pendingRemoves.has(user.id)) {
        pendingRemoves.delete(user.id);
      } else {
        pendingAdds.set(user.email, user);
      }

      render();
      return;
    }

    try {
      await addTeamMember(getTeam().id, user.email);
      await onChanged?.();
      onMessage(`Added ${user.email}.`);
    } catch (err) {
      console.error(err);
      // Worth surfacing verbatim: the 404 body explains that the person has to sign in
      // once before they can be added, which isn't guessable from the UI.
      onMessage(`Could not add ${user.email}: ${err.message}`, "error-msg");
    }
  }

  async function removeMember(userId, email) {
    if (staged) {
      // Removing something only staged for addition drops it outright — it was never on
      // the server, so there is nothing to DELETE.
      if (pendingAdds.has(email)) {
        pendingAdds.delete(email);
      } else {
        pendingRemoves.add(userId);
      }

      render();
      return;
    }

    try {
      await removeTeamMember(getTeam().id, userId);
      await onChanged?.();
    } catch (err) {
      console.error(err);
      // Covers the last-member refusal, which is a 409 the user needs explaining.
      onMessage(`Could not remove that member: ${err.message}`, "error-msg");
    }
  }

  function hasChanges() {
    return pendingAdds.size > 0 || pendingRemoves.size > 0;
  }

  function reset() {
    pendingAdds.clear();
    pendingRemoves.clear();
    clearResults();
    render();
  }

  /**
   * Send the staged changes. Removals first: a team can't drop below one member, and
   * doing the adds first would make that limit easier to satisfy by accident.
   *
   * Failures are collected rather than thrown, so one bad address doesn't strand the
   * rest — and returned so the caller can report them alongside whatever else it saved.
   */
  async function apply() {
    const failed = [];

    for (const userId of pendingRemoves) {
      try {
        await removeTeamMember(getTeam().id, userId);
      } catch (err) {
        console.error(err);
        failed.push(`remove failed: ${err.message}`);
      }
    }

    for (const [email] of pendingAdds) {
      try {
        await addTeamMember(getTeam().id, email);
      } catch (err) {
        console.error(err);
        failed.push(`${email}: ${err.message}`);
      }
    }

    pendingAdds.clear();
    pendingRemoves.clear();

    return failed;
  }

  function setEditing(value) {
    editing = value;
    clearResults();
    render();
  }


  // ─── EVENTS ───────────────────────────────────────────────────────────────

  const search = document.getElementById("member-search");

  // On `change` rather than `input`: the lookup is exact, so there is nothing useful to
  // show while a name is half-typed, and a request per keystroke would be one empty
  // result after another. This fires on blur and on Enter.
  search.addEventListener("change", async () => {
    const query = search.value.trim();

    if (!query) {
      clearResults();
      return;
    }

    const users = await searchUsers(query);

    // Guard against an older request resolving after a newer one.
    if (search.value.trim() !== query) {
      return;
    }

    if (users.length === 0) {
      clearResults();
      onMessage(`No user with that exact name or email: ${query}`, "error-msg");
      return;
    }

    onMessage("");
    renderResults(users);
  });

  // Both delegated, so they survive every re-render of the lists they sit on.
  document.getElementById("member-results").addEventListener("click", event => {
    const button = event.target.closest(".add-member");
    if (!button) return;

    search.value = "";
    clearResults();

    addMember({
      id: button.dataset.id,
      email: button.dataset.email,
      name: button.dataset.name || null,
    });
  });

  document.getElementById("member-list").addEventListener("click", event => {
    const button = event.target.closest(".member-remove");
    if (!button) return;

    removeMember(button.dataset.userId, button.dataset.email);
  });

  return { render, setEditing, reset, apply, hasChanges };
}


export { attachMembersSection };

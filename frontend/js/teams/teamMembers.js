// Team members
//
// The add/remove members block: an exact-match lookup above a table of current members.
// Mounted by both team_create.html and the details view of teams.html, which supply the
// card and differ only in what they hand it.
//
// Both use `staged` mode — changes accumulate and the page's own submit applies them via
// `apply()`. There is an immediate mode too, where each add or remove is its own request;
// nothing uses it since team_members.html was folded into the details page, so that path
// is currently unexercised.
//
// The page provides #member-search, #member-results and #member-list; #member-add is
// optional and wraps the lookup where a page needs to hide it outside edit mode.

import { addTeamMember, removeTeamMember } from "./teamApi.js";
import { searchUsers } from "../users/userApi.js";
import { escapeHtml, initials, renderMessage } from "../utils.js";

// ─── DOM ────────────────────────────────────────────────────────────────────

// The block's own markup, so the ids below are declared and queried in one place. Both
// callers used to write this out themselves — the create page in HTML and the team record
// page in JS — which meant two copies of a contract only this module enforces.
function buildMembersPanel() {
  return `
    <div class="card column gap-md">
      <!-- Hidden outside edit mode by renderMembers: there is nothing to look someone up
           *for* until the surrounding form is editable. -->
      <div class="column gap-xs" id="member-add" hidden>
        <label class="field-label" for="member-search">Add a member</label>
        <input class="field-input" id="member-search" type="search"
               placeholder="Full name or email address" autocomplete="off">
        <p class="info-msg">
          Enter the whole name or email — partial matches aren't looked up. They must have
          signed in at least once before they can be added.
        </p>

        <!-- The match, with an Add button. Hidden until there is one. -->
        <div class="column gap-sm" id="member-results" hidden></div>
      </div>

      <div id="member-list"></div>
    </div>
  `;
}

function getElements() {
  return {
    search: document.getElementById("member-search"),
    results: document.getElementById("member-results"),
    list: document.getElementById("member-list"),
    addCard: document.getElementById("member-add"),
  };
}

// ─── SECTION ────────────────────────────────────────────────────────────────

/**
 * @param getTeam    () => the record being edited. Read on every interaction, so a caller
 *                   may swap or mutate it — team_create.html hands over a draft whose `id`
 *                   is null until POST /api/teams returns, and `apply` picks it up because
 *                   it reads the id at call time rather than at construction.
 * @param canRemove  (member) => boolean. Whether this member may be removed at all; the
 *                   Remove button is omitted for those it rejects. Defaults to everyone.
 *                   team_create.html uses it to protect the creator, who is the team's
 *                   first member and can't sensibly be dropped from a team being created.
 *
 * Changes are always staged: nothing here talks to the server, and `apply()` is the only
 * thing that does. There used to be an immediate mode — one request per click — for a
 * team_members.html since folded into the details page. With no caller left it was two
 * unreachable branches and an `onChanged` hook nobody passed.
 */
function createMembersSection({
  getTeam,
  onMessage,
  canRemove = () => true,
}) {
  const elements = getElements();

  const pendingAdds = new Map();
  const pendingRemoves = new Set();

  // Starts read-only. teamView.js opens it from the editor's onEdit; team_create.html
  // opens it once at construction, because there the panel's own lock is the gate.
  let editing = false;

  // ─── MEMBERS ──────────────────────────────────────────────────────────────

  function getEffectiveMembers() {
    const current = (getTeam().members ?? []).filter(
      member => !pendingRemoves.has(member.id),
    );

    return [...current, ...pendingAdds.values()];
  }

  function hasChanges() {
    return pendingAdds.size > 0 || pendingRemoves.size > 0;
  }

  // ─── RENDERING ────────────────────────────────────────────────────────────

  // The action cell's flex layout goes on a div inside the <td>, not on the <td> itself.
  // `.row` is `display: flex`, and setting that on a table cell takes it out of the table's
  // layout entirely — the cell stops sizing with its column, so it no longer lines up with
  // its header and the row's other cells shift to fill the space.
  function buildMemberRow(member) {
    return `
      <tr>
        <td>${escapeHtml(member.name || "—")}</td>
        <td>${escapeHtml(member.email)}</td>
        <td>
          <div class="row right">
            ${
              editing && canRemove(member)
                ? `<button
                    type="button"
                    class="btn member-remove"
                    data-user-id="${escapeHtml(member.id)}"
                    data-email="${escapeHtml(member.email)}"
                  >
                    Remove
                  </button>`
                : ""
            }
          </div>
        </td>
      </tr>
    `;
  }

  function renderMembers() {
    const members = getEffectiveMembers();

    // Optional: only the staged page (teamView.js) wraps its lookup in #member-add,
    // because only there does the lookup need hiding. In immediate mode `editing` is
    // permanently true, so an immediate-mode page has nothing to toggle and omits it.
    if (elements.addCard) {
      elements.addCard.hidden = !editing;
    }

    if (members.length === 0) {
      renderMessage(elements.list, "This team has no members.");
      return;
    }

    elements.list.innerHTML = `
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
            ${members.map(buildMemberRow).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderSearchResult(user) {
    const label = user.name || user.email;

    return `
      <div class="row">
        <div class="row left gap-md">
          <div class="user-logo">
            ${escapeHtml(initials(label))}
          </div>

          <div class="column left">
            <p class="label">${escapeHtml(user.name || "—")}</p>
            <p class="metadata">${escapeHtml(user.email)}</p>
          </div>
        </div>

        <button
          type="button"
          class="btn primary add-member"
          data-id="${escapeHtml(user.id)}"
          data-email="${escapeHtml(user.email)}"
          data-name="${escapeHtml(user.name ?? "")}"
        >
          + Add
        </button>
      </div>
    `;
  }

  function clearSearchResults() {
    elements.results.hidden = true;
    elements.results.replaceChildren();
  }

  function renderSearchResults(users) {
    const existingIds = new Set(
      getEffectiveMembers().map(member => member.id),
    );

    const available = users.filter(user => !existingIds.has(user.id));

    if (available.length === 0) {
      clearSearchResults();
      return;
    }

    elements.results.hidden = false;
    elements.results.innerHTML = available.map(renderSearchResult).join("");
  }

  function render() {
    renderMembers();
  }

  // ─── MEMBER CHANGES ──────────────────────────────────────────────────────

  // Re-adding someone staged for removal cancels that removal rather than recording a
  // separate add — otherwise apply() would DELETE and then POST the same person.
  function addMember(user) {
    if (pendingRemoves.has(user.id)) {
      pendingRemoves.delete(user.id);
    } else {
      pendingAdds.set(user.email, user);
    }

    render();
  }

  // Removing something only staged for addition drops it outright — it was never on the
  // server, so there is nothing for apply() to DELETE.
  function removeMember(userId, email) {
    if (pendingAdds.has(email)) {
      pendingAdds.delete(email);
    } else {
      pendingRemoves.add(userId);
    }

    render();
  }

  async function apply() {
    const failed = [];
    const teamId = getTeam().id;

    for (const userId of pendingRemoves) {
      try {
        await removeTeamMember(teamId, userId);
      } catch (err) {
        console.error(err);
        failed.push(`Remove failed: ${err.message}`);
      }
    }

    for (const email of pendingAdds.keys()) {
      try {
        await addTeamMember(teamId, email);
      } catch (err) {
        console.error(err);
        failed.push(`${email}: ${err.message}`);
      }
    }

    pendingAdds.clear();
    pendingRemoves.clear();

    return failed;
  }

  function reset() {
    pendingAdds.clear();
    pendingRemoves.clear();

    elements.search.value = "";
    clearSearchResults();
    render();
  }

  function setEditing(value) {
    editing = value;
    clearSearchResults();
    render();
  }

  // ─── EVENTS ───────────────────────────────────────────────────────────────

  async function handleSearch() {
    const query = elements.search.value.trim();

    if (!query) {
      clearSearchResults();
      return;
    }

    const users = await searchUsers(query);

    // Ignore results from an older search if the input has changed since it ran.
    if (elements.search.value.trim() !== query) {
      return;
    }

    if (users.length === 0) {
      clearSearchResults();
      onMessage(
        `No user with that exact name or email: ${query}`,
        "error-msg",
      );
      return;
    }

    onMessage("");
    renderSearchResults(users);
  }

  elements.search.addEventListener("change", handleSearch);

  elements.results.addEventListener("click", event => {
    const button = event.target.closest(".add-member");

    if (!button) {
      return;
    }

    elements.search.value = "";
    clearSearchResults();

    addMember({
      id: button.dataset.id,
      email: button.dataset.email,
      name: button.dataset.name || null,
    });
  });

  elements.list.addEventListener("click", event => {
    const button = event.target.closest(".member-remove");

    if (!button) {
      return;
    }

    removeMember(
      button.dataset.userId,
      button.dataset.email,
    );
  });

  return {
    render,
    setEditing,
    reset,
    apply,
  };
}

export { buildMembersPanel, createMembersSection };


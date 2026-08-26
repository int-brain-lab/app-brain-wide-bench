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

import {
  addTeamMember,
  removeTeamMember,
  updateTeamMember,
} from "../api/teamApi.js";
import { searchUsers } from "../api/userApi.js";
import { buildTableCount } from "../components/count.js";
import { escapeHtml, initials } from "../core/utils.js";
import { showEmpty } from "../core/message.js";

// The server's TeamRole. Ordered as the select shows them, most privileged first.
const ROLES = ["owner", "collaborator"];

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
               placeholder="Email address" autocomplete="off">
        <p class="info-msg">
          Enter the whole email address — partial matches aren't looked up. They must
          have signed in at least once before they can be added.
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
function createMembersSection({ getTeam, onMessage, canRemove = () => true }) {
  const elements = getElements();

  const pendingAdds = new Map();

  // What a newly added member starts as, before the row's select is touched. The lesser
  // role: adding someone shouldn't hand them the power to add others by default.
  const DEFAULT_ROLE = "collaborator";
  const pendingRemoves = new Set();

  // Role changes to members who are already saved, keyed by user id. Staged like the rest
  // rather than sent on change, so one Save applies everything and Cancel discards it.
  const pendingRoles = new Map();

  // Starts read-only. teamView.js opens it from the editor's onEdit; team_create.html
  // opens it once at construction, because there the panel's own lock is the gate.
  let editing = false;

  // ─── MEMBERS ──────────────────────────────────────────────────────────────

  function getEffectiveMembers() {
    const current = (getTeam().members ?? []).filter(
      (member) => !pendingRemoves.has(member.id),
    );

    return [...current, ...pendingAdds.values()];
  }

  // ─── RENDERING ────────────────────────────────────────────────────────────

  // A select rather than a badge, so the role is chosen where the member is. Only a
  // staged addition can have its role set: changing a saved member's role would need an
  // endpoint that doesn't exist yet, so those render as the same control, disabled, which
  // shows the role without implying it can be changed here.
  function buildRoleCell(member) {
    const selected = pendingRoles.get(member.id) ?? member.role ?? DEFAULT_ROLE;

    // A staged addition carries its role in the POST that creates it; a saved member is
    // changed with its own PATCH, which needs a team that exists — on the create page
    // there isn't one yet, and `canRemove` protects the creator there as it does for
    // removal.
    const settable =
      editing &&
      (pendingAdds.has(member.email) ||
        (getTeam().id != null && canRemove(member)));

    const options = ROLES.map(
      (role) =>
        `<option value="${role}"${role === selected ? " selected" : ""}>${role}</option>`,
    ).join("");

    return `
      <select
        class="input-select member-role"
        data-email="${escapeHtml(member.email)}"
        data-user-id="${escapeHtml(member.id ?? "")}"
        ${settable ? "" : "disabled"}
      >
        ${options}
      </select>
    `;
  }

  // The action cell's flex layout goes on a div inside the <td>, not on the <td> itself.
  // `.row` is `display: flex`, and setting that on a table cell takes it out of the table's
  // layout entirely — the cell stops sizing with its column, so it no longer lines up with
  // its header and the row's other cells shift to fill the space.
  function buildMemberRow(member) {
    return `
      <tr>
        <td>${escapeHtml(member.name || "—")}</td>
        <td>${escapeHtml(member.email)}</td>
        <td>${buildRoleCell(member)}</td>
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
      showEmpty(elements.list, "No members yet.");
      return;
    }

    elements.list.innerHTML = `
      <div class="table">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${members.map(buildMemberRow).join("")}
          </tbody>
        </table>
        <div class="table-footer">${buildTableCount(members.length, members.length, "member")}</div>
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
      getEffectiveMembers().map((member) => member.id),
    );

    const available = users.filter((user) => !existingIds.has(user.id));

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
      pendingAdds.set(user.email, { ...user, role: DEFAULT_ROLE });
    }

    render();
  }

  // Recorded against the staged entry, so apply() sends whatever the row now shows. No
  // re-render: the select already displays the new value, and redrawing it here would
  // take the focus off the control the user just used.
  function setMemberRole(email, userId, role) {
    const staged = pendingAdds.get(email);

    if (staged) {
      staged.role = role;
      return;
    }

    pendingRoles.set(userId, role);
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

    for (const [email, user] of pendingAdds) {
      try {
        await addTeamMember(teamId, email, user.role);
      } catch (err) {
        console.error(err);
        failed.push(`${email}: ${err.message}`);
      }
    }

    // Role changes last, and skipping anyone just removed — the PATCH would 404 on a
    // membership that no longer exists. Demoting yourself is left to the server to refuse:
    // it knows whether another owner remains.
    for (const [userId, role] of pendingRoles) {
      if (pendingRemoves.has(userId)) {
        continue;
      }

      try {
        await updateTeamMember(teamId, userId, role);
      } catch (err) {
        console.error(err);
        failed.push(`Role change failed: ${err.message}`);
      }
    }

    pendingAdds.clear();
    pendingRemoves.clear();
    pendingRoles.clear();

    return failed;
  }

  function reset() {
    pendingAdds.clear();
    pendingRemoves.clear();
    pendingRoles.clear();

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
      // Second argument, not a class name: the host decides what a failure looks like, and
      // both of them render it the same way.
      onMessage(`No user with that email: ${query}`, true);
      return;
    }

    onMessage("");
    renderSearchResults(users);
  }

  elements.search.addEventListener("change", handleSearch);

  elements.results.addEventListener("click", (event) => {
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

  elements.list.addEventListener("change", (event) => {
    const select = event.target.closest(".member-role");

    if (!select) {
      return;
    }

    setMemberRole(select.dataset.email, select.dataset.userId, select.value);
  });

  elements.list.addEventListener("click", (event) => {
    const button = event.target.closest(".member-remove");

    if (!button) {
      return;
    }

    removeMember(button.dataset.userId, button.dataset.email);
  });

  return {
    render,
    setEditing,
    reset,
    apply,
  };
}

export { buildMembersPanel, createMembersSection };

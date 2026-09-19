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

import { addTeamMember, removeTeamMember, updateTeamMember } from "../api/teamApi.js";
import { searchUsers } from "../api/userApi.js";
import { buildRoleBadge } from "../components/badges.js";
import { buildButton } from "../components/buttons.js";
import { getIcon } from "../components/icons.js";
import { buildTableCount } from "../components/count.js";
import { initials } from "../core/utils.js";
import { escapeHtml } from "../core/html.js";
import { buildEmptyMessage } from "../components/messages.js";
import { renderHtml } from "../core/render.js";
import { toGridAttrs } from "../components/layout.js";

// The server's TeamRole. Ordered as the select shows them, most privileged first.
const ROLES = ["owner", "collaborator"];

// Where this table gives up and the members are read as cards. Its own rather than
// cards/cardGrid.js's CARDS_QUERY: it carries a select and a button as well as the three
// columns the read-only table has, and runs out of room before either of them.
const MEMBER_CARDS_QUERY = "(max-width: 850px)";

// The width watch of the section on the page. One at a time: a second createMembersSection
// would otherwise leave the first still redrawing a list it no longer owns.
let stopWidthWatch = null;

// ─── DOM ─────────────────────────────────────────────────────────────────────

// The block's own markup, so the ids below are declared and queried in one place. Both
// callers used to write this out themselves — the create page in HTML and the team record
// page in JS — which meant two copies of a contract only this module enforces.
function buildMembersPanel() {
  return `
    <div class="card secondary column gap-lg">
      <!-- Hidden outside edit mode by renderMembers: there is nothing to look someone up
           *for* until the surrounding form is editable. -->
      <div class="column gap-xs" id="member-add" hidden>
        <label class="field-label" for="member-search">Add a member</label>
        <input class="field-input" id="member-search" type="search"
               placeholder="Email address" autocomplete="off">
        <p class="info-msg">
          Enter the full email address. Partial matches aren't looked up. They must have signed in at least once before they can be added.
        </p>

        <!-- The match, with an Add button. Hidden until there is one. -->
        <div class="column gap-sm" id="member-results" hidden></div>
      </div>

      <div id="member-list"></div>
    </div>
  `;
}

// The read-only table, for a page showing members it cannot change. The editable one is
// createMembersSection's, and carries the role selects and Remove buttons.
function buildMemberTable(members) {
  const rows = members
    .map(
      (member) => `
        <tr>
          <td><span class="label">${escapeHtml(member.name || "—")}</span></td>
          <td><span class="metadata">${escapeHtml(member.email)}</span></td>
          <td class="right">${buildRoleBadge(member.role, "sm")}</td>
        </tr>
      `,
    )
    .join("");

  return `
    <div class="table">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th class="right">Role</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="table-footer">
        <span class="metadata">
          ${buildTableCount(members.length, members.length, "member")}
        </span>
      </div>
    </div>
  `;
}

// The same members as cards, for a width a table of three columns no longer fits — see
// attachSectionView in widgets/sectionView.js, which chooses between the two.
function buildMemberCard(member) {
  return `
    <div class="card column gap-xs">
      <div class="row gap-md">
        <span class="label">${escapeHtml(member.name || "—")}</span>
        ${buildRoleBadge(member.role, "sm")}
      </div>

      <span class="metadata">${escapeHtml(member.email)}</span>
    </div>
  `;
}

function buildMemberCards(members) {
  return `
    <div class="grid card-grid" ${toGridAttrs({ cols: 2 })}>
      ${members.map(buildMemberCard).join("")}
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

// ─── SECTION ─────────────────────────────────────────────────────────────────

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
function createMembersSection({ getTeam, canRemove = () => true }) {
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

  // ─── MEMBERS ───────────────────────────────────────────────────────────────

  function getEffectiveMembers() {
    const current = (getTeam().members ?? []).filter((member) => !pendingRemoves.has(member.id));

    return [...current, ...pendingAdds.values()];
  }

  // ─── RENDERING ─────────────────────────────────────────────────────────────

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
      editing && (pendingAdds.has(member.email) || (getTeam().id != null && canRemove(member)));

    const options = ROLES.map(
      (role) => `<option value="${role}"${role === selected ? " selected" : ""}>${role}</option>`,
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

  // The app's bin, as the delete buttons carry: taking a member off the team is the same kind
  // of act, not the ✕ that clears a field.
  function buildRemoveButton(member) {
    if (!editing || !canRemove(member)) return "";

    return buildButton({
      label: "Remove",
      icon: getIcon("delete"),
      className: "sm primary member-remove",
      data: { "user-id": member.id, email: member.email },
    });
  }

  // The action cell's flex layout goes on a div inside the <td>, not on the <td> itself.
  // `.row` is `display: flex`, and setting that on a table cell takes it out of the table's
  // layout entirely — the cell stops sizing with its column, so it no longer lines up with
  // its header and the row's other cells shift to fill the space.
  function buildMemberRow(member) {
    return `
      <tr>
        <td><span class="label">${escapeHtml(member.name || "—")}</span></td>
        <td><span class="metadata">${escapeHtml(member.email)}</span></td>
        <td class="right">${buildRoleCell(member)}</td>
        <td>
          <div class="row right">${buildRemoveButton(member)}</div>
        </td>
      </tr>
    `;
  }

  // The same member as a card — see `.member-actions` in style.css, where the select gives up
  // the full width `.input-select` takes.
  function buildMemberCard(member) {
    return `
      <div class="card column gap-md">
        <div class="column gap-xs">
          <span class="label">${escapeHtml(member.name || "—")}</span>
          <span class="metadata">${escapeHtml(member.email)}</span>
        </div>

        <div class="row gap-md member-actions">
          ${buildRoleCell(member)}
          ${buildRemoveButton(member)}
        </div>
      </div>
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
      renderHtml(elements.list, buildEmptyMessage("No members yet"));
      return;
    }

    const build = matchMedia(MEMBER_CARDS_QUERY).matches ? buildCards : buildTable;

    renderHtml(elements.list, build(members));
  }

  function buildTable(members) {
    return `
      <div class="table">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th class="right">Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${members.map(buildMemberRow).join("")}
          </tbody>
        </table>
        <div class="table-footer">
          <span class="metadata">
            ${buildTableCount(members.length, members.length, "member")}
          </span>
        </div>
      </div>
    `;
  }

  function buildCards(members) {
    return `
      <div class="grid card-grid" ${toGridAttrs({ cols: 2 })}>
        ${members.map(buildMemberCard).join("")}
      </div>
    `;
  }

  function renderSearchResult(user) {
    const label = user.name || user.email;

    return `
      <div class="row">
        <div class="row left gap-lg">
          <div class="user-logo">
            ${escapeHtml(initials(label))}
          </div>

          <div class="column left">
            <p class="label">${escapeHtml(user.name || "—")}</p>
            <p class="metadata">${escapeHtml(user.email)}</p>
          </div>
        </div>

        ${buildButton({
          label: "Add",
          icon: getIcon("add"),

          // `sm` as the Remove buttons in the table below are: both act on one member.
          className: "sm primary add-member",
          data: { id: user.id, email: user.email, name: user.name ?? "" },
        })}
      </div>
    `;
  }

  function clearSearchResults() {
    elements.results.hidden = true;
    elements.results.replaceChildren();
  }

  function renderSearchResults(users) {
    const existingIds = new Set(getEffectiveMembers().map((member) => member.id));

    const available = users.filter((user) => !existingIds.has(user.id));

    if (available.length === 0) {
      clearSearchResults();
      return;
    }

    renderHtml(elements.results, available.map(renderSearchResult).join(""), { show: true });
  }

  function render() {
    renderMembers();
  }

  // The width is a redraw like any other change to the list.
  const media = matchMedia(MEMBER_CARDS_QUERY);
  const onWidthChange = () => renderMembers();

  stopWidthWatch?.();
  media.addEventListener("change", onWidthChange);
  stopWidthWatch = () => media.removeEventListener("change", onWidthChange);

  // ─── MEMBER CHANGES ────────────────────────────────────────────────────────

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

  // ─── EVENTS ────────────────────────────────────────────────────────────────

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
      // Nothing failed — the search found nobody, which is an answer, and it belongs in the
      // results region rather than in the page's own message.
      renderHtml(elements.results, buildEmptyMessage(`No user with that email: ${query}`), {
        show: true,
      });

      return;
    }

    renderSearchResults(users);
  }

  elements.search.addEventListener("change", handleSearch);

  // Whatever the last search answered is about the last query: typing or deleting a
  // character makes it stale, so it goes at the first keystroke rather than at the next
  // `change`.
  elements.search.addEventListener("input", clearSearchResults);

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

export { buildMemberCards, buildMemberTable, buildMembersPanel, createMembersSection };

import { escapeHtml, renderMessage } from "../utils.js";

// The add-task popup is self-contained: it only needs read access to the
// collection (to list what's still available to add) and a callback for
// "the user picked one" — it doesn't need expandedTaskId, wizard, or
// anything else tasks.js manages.

// ─── DOM ────────────────────────────────────────────────────────────────────

function popup() {
  return document.getElementById("task-popup");
}

function searchInput() {
  return document.getElementById("task-search");
}

function openButton() {
  return document.getElementById("open-task-popup");
}

function closeButton() {
  return document.getElementById("close-task-popup");
}

function cancelButton() {
  return document.getElementById("cancel-task-popup");
}

function searchResults() {
  return document.getElementById("match-list");
}


// ─── RENDERING ──────────────────────────────────────────────────────────────

function buildMatch(taskId) {
  return `
    <div class="match-row">
      <span>${escapeHtml(taskId)}</span>
      <button type="button" class="btn add-task" data-task="${escapeHtml(taskId)}">
        + Add
      </button>
    </div>
  `;
}

function renderMatches(collection, query) {
  const search = query.trim().toLowerCase();
  const matches = collection.availableIds().filter(taskId => taskId.toLowerCase().includes(search));

  if (!matches.length) {
    renderMessage(searchResults(), "No matching tasks.");
    return;
  }

  searchResults().innerHTML = matches.map(buildMatch).join("");
}


// ─── EVENTS ─────────────────────────────────────────────────────────────────

function openTaskPopup(collection) {
  const search = searchInput();

  search.value = "";
  renderMatches(collection, "");

  popup().hidden = false;
  search.focus();
}

function closeTaskPopup() {
  popup().hidden = true;
  openButton().focus();
}

// `onAdd(taskId)` is called when the user picks a task to add — tasks.js
// owns what "adding a task" actually means (collection.add + re-render).
function initialisePopup(collection, onAdd) {
  openButton().addEventListener("click", () => openTaskPopup(collection));
  closeButton().addEventListener("click", closeTaskPopup);
  cancelButton().addEventListener("click", closeTaskPopup);

  searchResults().addEventListener("click", event => {
    const button = event.target.closest(".add-task");
    if (!button) return;

    onAdd(button.dataset.task);
    closeTaskPopup();
  });

  searchInput().addEventListener("input", event => renderMatches(collection, event.target.value));

  const modal = popup();
  modal.addEventListener("click", event => {
    if (event.target === modal) {
      closeTaskPopup();
    }
  });
}

export { initialisePopup };

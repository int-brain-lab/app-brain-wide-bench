// User details
//
// A page showing the details for a single user.
//
// The page contains an edit button that allows the user to update editable fields.
// The fields and title of each panel in the page is defined in USER_PANELS.
// Editable fields are defined in the USER_FIELDS.

import { isAuthenticated } from "../api.js";
import { fillSidebarUser } from "../nav/nav_side.js";
import { showMessage, showError } from "../utils.js";
import { Editor } from "../utils/editor.js";
import {
  panelGroups,
  renderDisplayFields,
  renderGroups,
} from "../utils/form-fields.js";
import { loadMe, updateMe } from "./userApi.js";
import { USER_FIELDS, USER_PANELS } from "./userSchema.js";

// ─── DOM ─────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    gate: document.getElementById("gate"),
    actions: document.getElementById("user-actions"),
    details: document.getElementById("user-details"),
    editButton: document.getElementById("edit-user"),
    saveButton: document.getElementById("save-user"),
    cancelButton: document.getElementById("cancel-user"),
    message: document.getElementById("form-message"),
  };
}

// ─── RENDERING ───────────────────────────────────────────────────────────────

function showGate(elements, signedIn) {
  elements.gate.hidden = signedIn;
  elements.actions.hidden = !signedIn;
  elements.details.hidden = !signedIn;
}

function renderDetails(elements, user, fields) {
  const groups = panelGroups(fields, USER_PANELS);
  elements.details.innerHTML = renderGroups(
    groups,
    user,
    fields,
    renderDisplayFields,
  );

  globalThis.lucide?.createIcons?.();
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────

function attachEditor(elements, user, fields) {
  Editor({
    container: elements.details,
    editButton: elements.editButton,
    saveButton: elements.saveButton,
    cancelButton: elements.cancelButton,
    record: user,
    fields: fields,
    groups: () => panelGroups(fields, USER_PANELS, { columns: 1 }),
    save: draft => updateMe(draft),
    onSaved: async saved => {
      renderDetails(elements, saved, fields);
      showMessage(elements.message, "Your details have been saved.");
      await fillSidebarUser();
    },
    onCancel: () => renderDetails(elements, user, fields),

  }).attach();
}

// ─── INITIALISATION ──────────────────────────────────────────────────────────

async function loadUserDetailsPage() {
  const elements = getElements();

  try {
    const signedIn = await isAuthenticated();

    if (!signedIn) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);

    const user = await loadMe();
    const fields = USER_FIELDS;

    if (!user) {
      showError(elements.message, "Could not load your details.");
      return;
    }

    renderDetails(elements, user, fields);
    attachEditor(elements, user, fields);
  } catch (error) {
    console.error(
      "Failed to load user details page ",
      error);

    showError(
      elements.message,
      "User details page could not be loaded.")
  }
}

loadUserDetailsPage();
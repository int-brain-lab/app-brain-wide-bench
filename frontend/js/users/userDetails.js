// Settings — your own profile.
//
// A single view, so it keeps its own loader rather than the record engine's; it borrows the
// page chrome from pages/record-page.js so it looks and behaves like a details view.

import { isAuthenticated } from "../api.js";
import { fillSidebarUser } from "../nav/nav_side.js";
import { showError, showMessage } from "../utils.js";
import { Editor } from "../pages/editor.js";
import { panelGroups } from "../fields/groups.js";
import { showGate } from "../pages/gate.js";
import { loadMe, updateMe } from "./userApi.js";
import { USER_FIELDS, USER_PANELS } from "./userSchema.js";
import {
  buildBody,
  buildHeader,
  buildMessage,
  buildPage,
  pageMessage,
  renderDetails,
  renderHeader,
  renderPage,
  sectionBody,
} from "../pages/record-page.js";

const DESCRIPTION =
  "Your profile details. Name and affiliation are yours to change; the rest comes from "
  + "your sign-in provider.";

const EDIT_ACTION = {
  id: "edit-button",
  label: "Edit",
  icon: "pencil",
};

const SAVE_ACTION = {
  id: "save-button",
  label: "Save",
  icon: "check",
  className: "primary",
  hidden: true,
};

const CANCEL_ACTION = {
  id: "cancel-button",
  label: "Cancel",
  icon: "x",
  hidden: true,
};

// ─── EDITOR ──────────────────────────────────────────────────────────────────

function attachEditor(user) {
  Editor({
    container: sectionBody("body"),
    editButton: document.getElementById("edit-button"),
    saveButton: document.getElementById("save-button"),
    cancelButton: document.getElementById("cancel-button"),
    record: user,
    fields: USER_FIELDS,
    groups: () => panelGroups(USER_FIELDS, USER_PANELS, { columns: 1 }),
    save: draft => updateMe(draft),

    onSaved: async saved => {
      renderDetails(saved, USER_FIELDS, USER_PANELS);
      showMessage(pageMessage(), "Your details have been saved.");

      // The sidebar shows the name that was just edited.
      await fillSidebarUser();
    },

    onCancel: () => renderDetails(user, USER_FIELDS, USER_PANELS),

    onError: message => showError(pageMessage(), message),
  }).attach();
}

// ─── INITIALISATION ──────────────────────────────────────────────────────────

async function loadUserDetailsPage() {
  const container = document.getElementById("container");

  try {
    if (!(await isAuthenticated())) {
      showGate(false);
      return;
    }

    showGate(true);

    const user = await loadMe();

    if (!user) {
      showError(container, "Could not load your details.");
      return;
    }

    renderPage(
      buildPage({
        header: buildHeader([EDIT_ACTION, SAVE_ACTION, CANCEL_ACTION]),
        body: buildMessage() + buildBody(),
      }),
    );

    renderHeader("Settings", DESCRIPTION);
    renderDetails(user, USER_FIELDS, USER_PANELS);
    attachEditor(user);

    globalThis.lucide?.createIcons?.();
  } catch (error) {
    console.error("Failed to load user details page ", error);

    showError(container, "User details page could not be loaded.");
  }
}

loadUserDetailsPage();

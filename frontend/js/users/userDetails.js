// Settings — your own profile.
//
// A single view, so it keeps its own loader rather than the record engine's; it borrows the
// page chrome from pages/record-page.js so it looks and behaves like a details view.

import { isAuthenticated } from "../api.js";
import { fillSidebarUser } from "../nav/nav_side.js";
import { showError, showMessage } from "../utils.js";
import { attachRecordEditor } from "../pages/record-editor.js";
import { showGate } from "../pages/gate.js";
import { loadMe, updateMe } from "./userApi.js";
import { USER_FIELDS, USER_PANELS } from "./userSchema.js";
import {
  EDIT_ACTIONS,
  buildBody,
  buildHeader,
  buildMessage,
  buildPage,
  pageMessage,
  renderDetails,
  renderHeader,
  renderPage,
} from "../pages/record-page.js";

const DESCRIPTION =
  "Your profile details. Name and affiliation are yours to change; the rest comes from "
  + "your sign-in provider.";

// ─── EDITOR ──────────────────────────────────────────────────────────────────

function attachEditor(user) {
  attachRecordEditor({
    record: user,
    fields: USER_FIELDS,
    panels: USER_PANELS,
    save: draft => updateMe(draft),

    onSaved: async () => {
      showMessage(pageMessage(), "Your details have been saved.");

      // The sidebar shows the name that was just edited.
      await fillSidebarUser();
    },
  });
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
        header: buildHeader(EDIT_ACTIONS),
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

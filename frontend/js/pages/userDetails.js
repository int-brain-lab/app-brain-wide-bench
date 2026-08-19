// Settings — your own profile.
//
// A single view, so it keeps its own loader rather than the record engine's; it borrows the
// page chrome from pages/record-page.js so it looks and behaves like a details view.

import { isAuthenticated } from "../api/client.js";
import { fillSidebarUser } from "../nav/navSide.js";
import { showSuccess } from "../core/utils.js";
import { attachRecordEditor } from "../templates/record-editor.js";
import { showGate } from "../templates/gate.js";
import { loadMe, updateMe } from "../api/userApi.js";
import { USER_FIELDS, USER_PANELS } from "../schemas/userSchema.js";
import {
  buildBody,
  buildHeader,
  buildPage,
  EDIT_ACTIONS,
  pageMessage,
  renderDetails,
  renderHeader,
  renderPage,
  showPageError,
} from "../templates/record-page.js";

const DESCRIPTION =
  "Your profile details. Name and affiliation are yours to change; the rest comes from "
  + "your sign-in provider.";

// ─── EDITOR ──────────────────────────────────────────────────────────────────

function attachEditor(user) {
  attachRecordEditor({
    noun: "details",
    record: user,
    fields: USER_FIELDS,
    panels: USER_PANELS,
    save: draft => updateMe(draft),

    onSaved: async () => {
      showSuccess(pageMessage(), "Details successfully saved.");

      // The sidebar shows the name that was just edited.
      await fillSidebarUser();
    },
  });
}

// ─── INITIALISATION ──────────────────────────────────────────────────────────

async function loadUserDetailsPage() {
  try {
    if (!(await isAuthenticated())) {
      showGate(false);
      return;
    }

    showGate(true);

    const user = await loadMe();

    if (!user) {
      showPageError("Could not load your details.");
      return;
    }

    renderPage(
      buildPage({
        header: buildHeader(EDIT_ACTIONS),
        body: buildBody(),
      }),
    );

    renderHeader("My details");
    renderDetails(user, USER_FIELDS, USER_PANELS);
    attachEditor(user);

    globalThis.lucide?.createIcons?.();
  } catch (error) {
    console.error("Failed to load user details page ", error);

    showPageError("User details page could not be loaded.", error);
  }
}

loadUserDetailsPage();

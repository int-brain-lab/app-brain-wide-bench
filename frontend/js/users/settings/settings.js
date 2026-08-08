import { isAuthenticated } from "../../api.js";
import { fillSidebarUser } from "../../nav_side.js";
import { loadMe } from "../api.js";
import { attachUserEditor } from "../edit/edit.js";
import { renderDetails, showGate, showMessage } from "./settings-view.js";


async function initialise() {
  try {
    if (!(await isAuthenticated())) {
      showGate(false);
      return;
    }

    showGate(true);

    const user = await loadMe();

    if (!user) {
      showMessage("Could not load your details.", "error-msg");
      return;
    }

    renderDetails(user);

    attachUserEditor({
      user,

      // createDetailEditor has already assigned the saved values onto `user` and
      // switched back to the read-only panel; this just re-renders it.
      onSaved: async saved => {
        renderDetails(saved);
        showMessage("Your details have been saved.");

        // The sidebar renders name and initials once at page load, so without
        // this a rename leaves it stale until the next navigation.
        await fillSidebarUser();
      },

      onError: message => showMessage(message, "error-msg"),
    });
  } catch (err) {
    console.error("Failed to initialise settings page:", err);
    showMessage("Could not load your details.", "error-msg");
  }
}

initialise();

// Settings — your own profile.
//
// One view rather than a record page's several, so it calls loadPage directly and draws
// the details view itself.

import { refreshIcons } from "../core/render.js";
import { loadMe, updateMe } from "../api/userApi.js";
import { USER_FIELDS, USER_PANELS } from "../schemas/userSchema.js";
import { buildSuccessMessage } from "../components/messages.js";
import { fillSidebarUser } from "../nav/navSide.js";
import { renderRecordDetailsView } from "../templates/recordDetails.js";
import { loadPage } from "../templates/page.js";
import { renderHeader, renderMessage } from "../templates/pageChrome.js";

// ─── DETAILS VIEW ────────────────────────────────────────────────────────────

function renderDetailsView(user) {
  const page = renderRecordDetailsView({
    noun: "details",
    record: user,
    fields: USER_FIELDS,
    panels: USER_PANELS,

    // Your own profile: there is no one else's version of it to read, so it is always
    // editable.
    canEdit: true,

    renderTitle: () => renderHeader("My details"),
  });

  // A record page refreshes its icons through the router, which this page does not use.
  refreshIcons();

  return page.attachEditor({
    save: (draft) => updateMe(draft),

    onSaved: async () => {
      renderMessage(buildSuccessMessage("Details successfully saved."));

      // The sidebar shows the name that was just edited.
      await fillSidebarUser();
    },
  });
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

loadPage({
  noun: "details",

  // The record is the signed-in user, so there is no id in the URL.
  requiresId: false,

  load: loadMe,
  render: renderDetailsView,
});

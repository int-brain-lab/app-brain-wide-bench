import { renderMessage } from "../../utils.js";
import { renderDisplayFields } from "../../utils/form-fields.js";
import { USER_FIELDS } from "../schema.js";

const ELEMENTS = {
  gate: document.getElementById("gate"),
  body: document.getElementById("settings-body"),
  details: document.getElementById("user-details-full"),
  message: document.getElementById("form-message"),
};


// Toggles the wrapper rather than the two `section[data-tab]` panels inside it,
// which are owned by tab.js's showTab — the editor drives those.
function showGate(isAuthenticated) {
  ELEMENTS.gate.hidden = isAuthenticated;
  ELEMENTS.body.hidden = !isAuthenticated;
}


// The read-only view: every field as a display row, including the two that are
// editable, so this is the whole profile at a glance.
function renderDetails(user) {
  ELEMENTS.details.innerHTML = renderDisplayFields(
    Object.keys(USER_FIELDS),
    user,
    USER_FIELDS,
  );
}


function showMessage(message, className = "info-msg") {
  if (!message) {
    ELEMENTS.message.hidden = true;
    ELEMENTS.message.replaceChildren();
    return;
  }

  renderMessage(ELEMENTS.message, message, className);
}


export { showGate, renderDetails, showMessage };

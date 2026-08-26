import { escapeHtml } from "./html.js";
import { clearContent, renderHtml } from "./render.js";

// Built as DOM rather than an innerHTML string because `message` is pure text
// with no markup of its own — and because it routinely carries raw server
// output: api.js throws `Error(`${status} ${statusText}: ${text}`)` with the
// whole response body, and FastAPI's 422s echo the offending input back. Via
// textContent none of that can be parsed as HTML.
// The class goes on a wrapper rather than the paragraph, so `detail` has somewhere to sit:
// a second, quieter line under the first.
//
// Everything is escaped rather than trusted: a detail is usually whatever the server said,
// and apiFetch throws with the whole response body in its message while a FastAPI 422
// echoes the offending input straight back.
//
// Returned as markup as well as rendered, because a card is sometimes part of a bigger
// template — a task's own cleared notice, built with the fields it sits above.
function buildMessageCard(message, className = "info-msg", detail = "") {
  return `
    <div class="${escapeHtml(className)}">
      <p>${escapeHtml(message)}</p>
      ${detail ? `<p class="msg-detail">${escapeHtml(detail)}</p>` : ""}
    </div>
  `;
}

function renderMessage(container, message, className = "info-msg", detail = "") {
  renderHtml(container, buildMessageCard(message, className, detail), {
    show: true,
  });
}

// Empties a message region and hides it again. Its own function because
// `showMessage(element, "")` reads as "show nothing", which is a strange way to say "there
// is nothing to report any more".
function clearMessage(element) {
  clearContent(element, { hide: true });
}

function showMessage(element, message) {
  if (!message) {
    clearMessage(element);
    return;
  }

  renderMessage(element, message);
}

// A section with nothing to show yet — no submissions, no members, no scored tasks. Its own
// helper rather than showMessage with a class argument, so every one of them looks the same
// without each call site electing to.
function showEmpty(element, message) {
  renderMessage(element, message, "empty-msg");
}

// The two outcomes of a create or an edit. `showFailure` names the action that failed and
// puts the error underneath, so the sentence stays readable however ugly the detail is.
function showSuccess(element, message) {
  renderMessage(element, message, "success-msg");
}

// A change that was valid but cost something — fields cleared because they no longer
// apply. Amber rather than red: nothing failed, but it must not slip past unnoticed.
function showWarning(element, message, detail = "") {
  renderMessage(element, message, "warn-msg", detail);
}

function showFailure(element, message, error) {
  renderMessage(element, message, "failure-msg", error?.message ?? "");
}

function showError(element, message) {
  if (!message) {
    clearMessage(element);
    return;
  }

  renderMessage(element, message, "error-msg");
}

export {
  buildMessageCard,
  clearMessage,
  renderMessage,
  showEmpty,
  showError,
  showFailure,
  showMessage,
  showSuccess,
  showWarning,
};


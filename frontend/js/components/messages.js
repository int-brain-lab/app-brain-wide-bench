import { escapeHtml } from "../core/html.js";

// `detail` carries raw server output: apiFetch throws with the whole response body, and a
// FastAPI 422 echoes the offending input back.
function buildMessageCard(message, className = "info-msg", detail = "") {
  return `
    <div class="${escapeHtml(className)}">
      <p>${escapeHtml(message)}</p>
      ${detail ? `<p class="msg-detail">${escapeHtml(detail)}</p>` : ""}
    </div>
  `;
}

function buildInfoMessage(message) {
  return buildMessageCard(message);
}

function buildEmptyMessage(message) {
  return buildMessageCard(message, "empty-msg");
}

function buildSuccessMessage(message) {
  return buildMessageCard(message, "success-msg");
}

function buildWarningMessage(message, detail = "") {
  return buildMessageCard(message, "warn-msg", detail);
}

function buildFailureMessage(message, error) {
  return buildMessageCard(message, "failure-msg", error?.message ?? "");
}

function buildPageErrorMessage(message, error) {
  return buildMessageCard(message, "page-error", error?.message ?? "");
}

export {
  buildEmptyMessage,
  buildFailureMessage,
  buildInfoMessage,
  buildMessageCard,
  buildPageErrorMessage,
  buildSuccessMessage,
  buildWarningMessage,
};

// util functions that are reused across

// Make `value` safe to interpolate into an HTML string — both in text position
// and inside a double- or single-quoted attribute. Use this at EVERY point where
// data we didn't author reaches an `innerHTML` template; without it a model name
// like `"><img src=x onerror=...>` closes the surrounding tag and the rest is
// parsed as real markup (stored XSS, and the leaderboard is public).
//
// `&` must be replaced first, or it would re-escape the entities added below.
//
// This is for building *markup strings*. When you only need to set text or an
// attribute, prefer `textContent` / `setAttribute` — they can't inject at all,
// so there's nothing to remember to escape.
function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function initials(name) {
  return name
    .split(/\s+/)
    .map((w) => w[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function refreshIcons() {
  globalThis.lucide?.createIcons?.();
}

// Human-readable file size, e.g. "41.2 MB".
function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

function formatDate(value, locale = "en-GB") {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

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

function renderMessage(
  container,
  message,
  className = "info-msg",
  detail = "",
) {
  container.hidden = false;
  container.innerHTML = buildMessageCard(message, className, detail);
}

// Empties a message region and hides it again. Its own function because
// `showMessage(element, "")` reads as "show nothing", which is a strange way to say "there
// is nothing to report any more".
function clearMessage(element) {
  element.hidden = true;
  element.replaceChildren();
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

function mean(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

// How a score is written everywhere it appears — a table cell, a stat card, a plot tooltip.
// Here rather than in tables/formatters.js because it is a number format, not a cell
// renderer, and the plots need it too.
function score(value) {
  return value == null ? "—" : value.toFixed(3);
}

export {
  escapeHtml,
  formatDate,
  initials,
  formatBytes,
  buildMessageCard,
  clearMessage,
  renderMessage,
  showMessage,
  showEmpty,
  showError,
  showFailure,
  showSuccess,
  showWarning,
  mean,
  refreshIcons,
  score,
};

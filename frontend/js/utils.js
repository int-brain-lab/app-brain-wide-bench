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
  return name.split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
}


function score(value) {
  return value == null ? "—" : value.toFixed(3);
}


// Human-readable file size, e.g. "41.2 MB".
function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(1)} ${units[i]}`;
}


// Relative time, e.g. "3 days ago". Returns "" for missing/unparseable input.
function timeAgo(dateStr) {
  if (!dateStr) return "";
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.round((Date.now() - then) / 1000);
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  if (secs < 45) return "just now";
  for (const [name, size] of units) {
    const n = Math.floor(secs / size);
    if (n >= 1) return `${n} ${name}${n > 1 ? "s" : ""} ago`;
  }
  return "just now";
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
function renderMessage(container, message, className = "info-msg") {
  container.hidden = false;

  const paragraph = document.createElement("p");
  paragraph.className = className;
  paragraph.textContent = message;

  container.replaceChildren(paragraph);
}

function showMessage(element, message) {
  if (!message) {
    element.hidden = true;
    element.replaceChildren();
    return;
  }

  renderMessage(element, message);
}


function showError(element, message) {
  if (!message) {
    element.hidden = true;
    element.replaceChildren();
    return;
  }

  renderMessage(element, message, "error-msg");
}

// Returns an element, not a string: the structure here is fixed and both slots
// are pure text, so there's no reason to go through the HTML parser (and no
// escaping to forget). Callers use `replaceChildren`, not `innerHTML`.
function renderInfoRow([label, value]) {
  const row = document.createElement("div");
  row.className = "details-row";

  for (const [className, text] of [["details-label", label], ["details-value", value]]) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    row.append(span);
  }

  return row;
}

// A fragment so a caller can drop the whole set in with one replaceChildren().
function renderInfoRows(rows) {
  const fragment = document.createDocumentFragment();
  fragment.append(...rows.map(renderInfoRow));
  return fragment;
}



export {
  escapeHtml,
  formatDate,
  initials,
  formatBytes,
  score,
  renderMessage,
  renderInfoRows,
  renderInfoRow,
  showMessage,
  showError
};
// util functions that are reused across

import { refreshIcons } from "./render.js";
import { escapeHtml } from "./html.js";
import {
  buildMessageCard,
  clearMessage,
  renderMessage,
  showEmpty,
  showError,
  showFailure,
  showMessage,
  showSuccess,
  showWarning,
} from "./message.js";

function initials(name) {
  return name
    .split(/\s+/)
    .map((w) => w[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
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
  buildMessageCard,
  clearMessage,
  escapeHtml,
  formatDate,
  initials,
  formatBytes,
  mean,
  refreshIcons,
  renderMessage,
  score,
  showEmpty,
  showError,
  showFailure,
  showMessage,
  showSuccess,
  showWarning,
};

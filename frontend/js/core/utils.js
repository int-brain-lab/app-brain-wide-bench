// util functions that are reused across

// English enough for the nouns this app names. A word already ending in "s" is taken to be
// plural as it stands, which is what "details" needs.
function pluralise(noun) {
  if (!noun || noun.endsWith("s")) return noun;

  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;

  return `${noun}s`;
}

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

// The standard error of that mean: how far the mean itself would move on another sample of
// the same size. The sample deviation (n − 1), because the values are a sample of what could
// have been measured rather than the whole of it.
//
// Null under two values, where there is no spread to state — one measurement says nothing
// about how much it varies, and 0 would claim it says a great deal.
function sem(values) {
  if (values.length < 2) return null;

  const centre = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - centre) ** 2, 0) /
    (values.length - 1);

  return Math.sqrt(variance / values.length);
}

// A count in as few characters as read it: 1.2K, 340M, 200B. For a figure whose magnitude is
// the point — a parameter count spans eight orders — where the digits past the first two say
// nothing a reader is asking. Largest unit first, so the loop below takes the first that fits.
const COUNT_UNITS = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

// One decimal, and not a trailing zero: "1.2K" and "200B", never "200.0B".
function trimmed(value) {
  return String(Number(value.toFixed(1)));
}

function formatCount(value) {
  if (value == null) return "—";

  for (const [size, unit] of COUNT_UNITS) {
    if (Math.abs(value) >= size) return `${trimmed(value / size)}${unit}`;
  }

  return String(Math.round(value));
}

// How a score is written everywhere it appears — a table cell, a stat card, a plot tooltip.
// Here rather than in tables/formatters.js because it is a number format, not a cell
// renderer, and the plots need it too.
function score(value) {
  return value == null ? "—" : value.toFixed(3);
}

export {
  formatCount,
  formatDate,
  initials,
  formatBytes,
  mean,
  pluralise,
  score,
  sem,
};

// Grid layout, written as custom properties rather than as one class per column count.
//
// `.grid` and `.section-row` read `--cols`, `--shares` and `--grid-gap` — see style.css.
// A count is data, so it is written here; the breakpoint rules override
// `grid-template-columns` itself, which an inline property cannot be made to lose to.
//
// The count and the shape go out as `data-cols` and `data-shares` beside the properties,
// because a breakpoint rule has to *select* on them and CSS cannot read a property to do it.

// ─── PROPERTIES ──────────────────────────────────────────────────────────────

// What a grid may carry, for clearing one off an element that held it before.
const GRID_PROPERTIES = ["--cols", "--shares", "--grid-gap"];

// `[1, 2, 2]` → "minmax(0, 1fr) minmax(0, 2fr) minmax(0, 2fr)". `minmax(0, ...)` so a wide
// child — a table, a Tabulator grid — is clipped by its column rather than widening it.
// A share that is not a number is a track written out: "240px", "auto".
function toShares(shares) {
  return shares
    .map((share) => (typeof share === "number" ? `minmax(0, ${share}fr)` : share))
    .join(" ");
}

function toColumnCount({ cols, shares }) {
  return shares ? shares.length : (cols ?? 1);
}

function toGridProperties({ cols, shares, gap }) {
  return [
    shares ? ["--shares", toShares(shares)] : ["--cols", String(cols ?? 1)],
    ...(gap ? [["--grid-gap", `var(--gap-${gap})`]] : []),
  ];
}

function toGridStyle(options) {
  return toGridProperties(options)
    .map(([name, value]) => `${name}:${value}`)
    .join("; ");
}

// ─── GRIDS ───────────────────────────────────────────────────────────────────

/**
 * The attributes a grid written as markup carries.
 *
 * @param cols   how many equal columns.
 * @param shares the columns' widths instead — `[1, 2, 2]` is a fifth, then two fifths twice,
 *               and a string is a track written out. Omit for equal columns.
 * @param gap    a gap token's name — "xs", "md". Omit for the grid's own `--gap-lg`.
 *
 * @returns `data-cols`, `data-shares` where the columns are uneven, and `style` — to follow
 *          `class="grid"`.
 */
function toGridAttrs(options = {}) {
  const { shares } = options;

  return [
    `data-cols="${toColumnCount(options)}"`,
    shares ? `data-shares="${shares.join("-")}"` : "",
    `style="${toGridStyle(options)}"`,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The same, on an element the caller already holds.
 *
 * @param element the element to lay out.
 * @param options toGridAttrs's, plus a `className` the grid keeps beside `grid` — for a grid
 *               a stylesheet has to find. Null takes the grid off again, classes and all.
 */
function applyGrid(element, options) {
  if (!element) return;

  for (const name of GRID_PROPERTIES) {
    element.style.removeProperty(name);
  }

  delete element.dataset.cols;
  delete element.dataset.shares;

  element.className = options ? ["grid", options.className].filter(Boolean).join(" ") : "";

  if (!options) return;

  element.dataset.cols = String(toColumnCount(options));

  if (options.shares) {
    element.dataset.shares = options.shares.join("-");
  }

  for (const [name, value] of toGridProperties(options)) {
    element.style.setProperty(name, value);
  }
}

export { applyGrid, toGridAttrs };

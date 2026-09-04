// The controls a list is narrowed by: a select, a search, a pinned select, a row of checks,
// and the bar that holds them.
//
// A control is markup and nothing else — the values behind one are components/filterState.js,
// which reads them back off the DOM. Every control matches against *rows*, so the cards and
// the table on a list page narrow through the same matchers.
//
// `buildSelect`, `buildSearch` and `buildPinnedSelect` are also usable on their own, by a
// caller with one control and no state: each takes the parts of a control it needs rather
// than a control, and the caller wires it up.

import { escapeHtml } from "../core/html.js";
import { suiteLabel, SUITES } from "../core/suites.js";
import { getIcon } from "./icons.js";
import { buildRange } from "./ranges.js";

// ─── MATCHERS ────────────────────────────────────────────────────────────────

// Hardcoded from SUITES rather than derived from the rows, so an option doesn't disappear
// exactly when nothing on the page covers that suite.
const SUITE_OPTIONS = SUITES.map((suite) => ({
  value: suite,
  label: suiteLabel(suite),
  className: suite,
}));

// Each of these builds a control's `match`. They are only ever called with a non-empty
// value — createFilterState skips a blank control — so none has to treat "" as
// "match everything".

function matchIncludes(field) {
  return (row, value) =>
    String(row[field] ?? "")
      .toLowerCase()
      .includes(value.toLowerCase());
}

function matchEquals(field) {
  return (row, value) => String(row[field] ?? "") === value;
}

function matchInArray(field) {
  return (row, value) => (row[field] ?? []).includes(value);
}

// For a select whose options are whatever the data happens to contain (team names). A
// fixed server-side enum should stay hardcoded instead, so an option doesn't vanish
// exactly when a user has no rows carrying that value.
function optionsFromRows(rows, field) {
  return [
    ...new Set(
      rows
        .map((row) => row[field])
        .filter((value) => value != null && value !== ""),
    ),
  ]
    .sort((a, b) => String(a).localeCompare(String(b)))
    .map((value) => ({ value, label: value }));
}

// ─── CONTROLS ────────────────────────────────────────────────────────────────

/**
 * A select's contents.
 *
 * @param options     [{ value, label }].
 * @param selected    the value to mark. Omit for none.
 * @param placeholder a blank first option, which doubles as the control's label — an unset
 *                    filter reads as "All suites" without a separate <label>. Omit where
 *                    every option is a real choice.
 */
function buildOptions(options, { selected = null, placeholder = "" } = {}) {
  const blank = placeholder
    ? `<option value="">${escapeHtml(placeholder)}</option>`
    : "";

  return (
    blank +
    options
      .map(
        (option) => `
    <option value="${escapeHtml(option.value)}" ${option.value === selected ? "selected" : ""}>${escapeHtml(option.label)}</option>
  `,
      )
      .join("")
  );
}

/**
 * One select, for a bar or on its own.
 *
 * @param name     what a listener finds it by.
 * @param hook     the data attribute carrying `name`, without the `data-`. "filter" is what
 *                 a filter state resolves a control by; a select outside one names its own,
 *                 so a state can never hear a control it doesn't own.
 * @param options  as buildOptions.
 * @param selected as buildOptions.
 * @param placeholder as buildOptions.
 * @param disabled for a select with nothing to choose between.
 * @returns the markup.
 */
function buildSelect({
  name,
  hook = "filter",
  options,
  selected = null,
  placeholder = "",
  disabled = false,
}) {
  return `
    <select
      class="input-select"
      data-${escapeHtml(hook)}="${escapeHtml(name)}"
      ${disabled ? "disabled" : ""}
    >
      ${buildOptions(options, { selected, placeholder })}
    </select>
  `;
}

/**
 * One search box, for a bar or on its own.
 *
 * @param name        as buildSelect.
 * @param hook        as buildSelect.
 * @param placeholder what the empty box says it narrows — "Search models...".
 * @param value       what it starts with. Omit for empty, which is what a bar wants.
 * @returns the markup.
 */
function buildSearch({ name, hook = "filter", placeholder = "", value = "" }) {
  return `
    <input
      class="input-text"
      type="search"
      data-${escapeHtml(hook)}="${escapeHtml(name)}"
      placeholder="${escapeHtml(placeholder)}"
      value="${escapeHtml(value)}">
  `;
}

// ─── PINNED SELECTS ──────────────────────────────────────────────────────────
//
// A select whose picks stay: choosing an option pins it as a chip underneath, with a ✕ to
// take it off again, and the select drops back to its placeholder ready for the next. The
// multi-valued control for a set too long to show as boxes — eight fields of five options
// each is forty boxes on screen at rest, where this is eight closed selects until the reader
// adds to one.
//
// No state of its own: the chips are the state, and `pinnedIn` reads them back off whatever
// element the caller put them in. So a caller listening on a persistent ancestor can rebuild
// the controls under it whenever it likes, and there is no second copy of what is picked to
// disagree with what is on screen.
//
// A pinned option is hidden *and* disabled in the select rather than taken out of it: the
// list keeps its own order, so unpinning puts the option back where it was rather than at the
// end. Disabled as well as hidden because `hidden` on an <option> is honoured unevenly, and
// on its own would leave a pinnable option pinnable twice.
//
// The two halves are separately buildable, because they do not always want to be together: a
// caller can put the control in a section's header and the chips in its body, where a growing
// row of them would otherwise push the heading around. `pinFromEvent` looks both up inside
// the root it is handed, so that root has to contain the two.

// The chip list, by the name of the select above it — what pinning re-renders into.
const PINS = "pins";

// One chip's ✕, and the select's own option, by value.
const UNPIN = "unpin";

// A chip's own class, carried on the option it is pinned from — see buildChip. On the option
// because that is all `pin` has to go on when the reader picks one, and the label is read off
// it for the same reason. One word, like the two above: an attribute is case-insensitive, so
// a camel-cased name here would not be the key it is read back by.
const CHIP_CLASS = "chip";

function buildChip(name, option) {
  // The class comes off the option, so a chip can be coloured by whatever it stands for —
  // the leaderboard's tasks wear their suite's.
  const classes = ["chip", option.className].filter(Boolean).join(" ");

  return `
    <span class="${escapeHtml(classes)}">
      ${escapeHtml(option.label)}
      <button
        type="button"
        class="chip-remove"
        data-${UNPIN}="${escapeHtml(name)}"
        value="${escapeHtml(option.value)}"
        title="Remove ${escapeHtml(option.label)}"
        aria-label="Remove ${escapeHtml(option.label)}"
      >
        <i class="field-icon" data-lucide="${escapeHtml(getIcon("remove"))}"></i>
      </button>
    </span>`;
}

/**
 * One of them: a label, the select, and the chips for what is already picked.
 *
 * @param name        what a listener finds it by, on the select and on every ✕ under it.
 * @param hook        the data attribute carrying `name` on the select, without the `data-`.
 *                    As buildSelect's — the select is one, so a bar's own listener hears it
 *                    or doesn't by the same rule.
 * @param label       what the control is called, above it.
 * @param options     [{ value, label }]. Ungrouped: a set with an order of its own — the
 *                    tasks of a suite — is its own control rather than a heading inside a
 *                    shared one, so that what a select offers is the same thing its chips
 *                    are.
 * @param selected    the values that start pinned, in the order they should read.
 * @param placeholder the select's blank first option, which is what it shows at rest. Reads
 *                    as the state rather than as an instruction — nothing pinned is "Any",
 *                    the way an unset bar select is "All teams".
 * @returns the markup.
 */
function buildPinnedControl({
  name,
  hook = "filter",
  label = "",
  className = "",
  options,
  selected = [],
  placeholder = "Any",
}) {
  const pinned = new Set(selected);

  const classes = ["row left gap-sm", className].filter(Boolean).join(" ");

  return `
    <span class="${escapeHtml(classes)}">
      ${label ? `<span class="metadata">${escapeHtml(label)}</span>` : ""}
      <select
        class="input-select"
        data-${escapeHtml(hook)}="${escapeHtml(name)}"
        ${options.length ? "" : "disabled"}
      >
        <option value="">${escapeHtml(placeholder)}</option>
        ${options
          .map(
            (option) => `
          <option
            value="${escapeHtml(option.value)}"
            ${option.className ? `data-${CHIP_CLASS}="${escapeHtml(option.className)}"` : ""}
            ${pinned.has(option.value) ? "hidden disabled" : ""}
          >${escapeHtml(option.label)}</option>`,
          )
          .join("")}
      </select>
    </span>`;
}

/**
 * The chips for one control: what is picked, each with a ✕.
 *
 * @param name     the control's, which is how the two halves find each other.
 * @param options  as buildPinnedControl, for the labels — a chip says what was picked, not
 *                 the value it was stored as.
 * @param selected the values pinned, in the order they should read.
 * @returns the markup. Always an element, since it is what a pin is inserted into; empty, it
 *          collapses — see `.pins` in style.css.
 */
function buildPins({ name, options, selected = [] }) {
  const byValue = new Map(options.map((option) => [option.value, option]));

  return `<span class="row left gap-sm pins" data-${PINS}="${escapeHtml(name)}">${selected
    .filter((value) => byValue.has(value))
    .map((value) => buildChip(name, byValue.get(value)))
    .join("")}</span>`;
}

// The two stacked, for a caller that wants them together — a column of filters, where each
// grows downwards into its own space.
//
// The label goes at the top of the column rather than through to the control, where it would
// sit on the select's left and take the width of the field name off it. Stacked, the name is
// over the thing it names and the chips are under it, which is one column per question.
function buildPinnedSelect({ name, label = "", options, selected = [], ...rest }) {
  return `
    <div class="column gap-sm">
      ${label ? `<span class="metadata">${escapeHtml(label)}</span>` : ""}
      ${buildPinnedControl({ name, options, selected, ...rest })}
      ${buildPins({ name, options, selected })}
    </div>`;
}

/**
 * The values pinned in `root`, in the order they were pinned.
 *
 * @param name as buildPinnedSelect.
 */
function pinnedIn(root, name) {
  return [
    ...root.querySelectorAll(`[data-${PINS}="${name}"] [data-${UNPIN}="${name}"]`),
  ].map((button) => button.value);
}

// A pinned option is out of the list and a returned one is back in it — see the note above.
function show(option, visible) {
  if (!option) return;

  option.hidden = !visible;
  option.disabled = !visible;
}

// The chip, and the option it takes out of the select. The label comes off the option rather
// than from the caller, so a chip and the line it was chosen from always read the same.
function pin(pins, name, value, option) {
  pins.insertAdjacentHTML(
    "beforeend",
    buildChip(name, {
      value,
      label: option?.textContent.trim() ?? value,
      className: option?.dataset[CHIP_CLASS] ?? "",
    }),
  );

  show(option, false);
}

function optionFor(root, name, hook, value) {
  return root.querySelector(
    `select[data-${hook}="${name}"] option[value="${CSS.escape(value)}"]`,
  );
}

/**
 * Pin or unpin whatever a change or a click just asked to, in place.
 *
 * One entry point for both, because they are the same edit read from either end — a change on
 * the select pins its value, a click on a ✕ unpins the chip's — and a caller would otherwise
 * wire two listeners to two functions that have to agree.
 *
 * @param event the change or click. Anything landing elsewhere is left alone.
 * @param root  an ancestor of the control, which is where it is looked for.
 * @param hook  as buildPinnedSelect.
 * @returns the name of the select whose pins changed, or null for an event that wasn't one's
 *          — so a caller can tell "the filters moved" from "the reader clicked the panel".
 */
function pinFromEvent(event, root, hook = "filter") {
  // `closest`, not the target itself: a click on a ✕ lands on the icon inside it, which
  // lucide has by then replaced with an svg of its own.
  const unpin = event.target?.closest?.(`[data-${UNPIN}]`);
  const select = unpin ? null : event.target?.closest?.(`select[data-${hook}]`);

  const control = unpin ?? select;

  if (!control) return null;

  const name = unpin ? unpin.dataset[UNPIN] : select.dataset[hook];

  const pins = root.querySelector(`[data-${PINS}="${name}"]`);

  if (!pins) return null;

  const value = control.value;

  // A change back to the placeholder is not a pin — and it is what pinning leaves the select
  // showing, so this is also the click on the select itself.
  if (!value) return null;

  const option = optionFor(root, name, hook, value);

  if (unpin) {
    unpin.closest(".chip")?.remove();

    show(option, true);

    return name;
  }

  pin(pins, name, value, option);

  // Back to the instruction, so the control never reads as though it held one of the values
  // pinned below it.
  select.value = "";

  return name;
}

/**
 * Pin `value` without the reader having chosen it — for a control that stands for several,
 * like a suite that means its own tasks. Already-pinned values are left alone, so adding a
 * suite over a part-chosen one adds only what is missing.
 *
 * @returns whether anything changed.
 */
function pinIn(root, name, value, hook = "filter") {
  const pins = root.querySelector(`[data-${PINS}="${name}"]`);

  if (!pins) return false;

  const option = optionFor(root, name, hook, value);

  // Hidden is what pinned looks like in the select, so it is also how this asks.
  if (!option || option.hidden) return false;

  pin(pins, name, value, option);

  return true;
}

/**
 * Take `value` off without the reader having clicked its ✕ — the counterpart to pinIn, for
 * the same kind of control that stands for several.
 *
 * @returns whether anything changed.
 */
function unpinIn(root, name, value, hook = "filter") {
  const chip = root.querySelector(
    `[data-${PINS}="${name}"] [data-${UNPIN}="${name}"][value="${CSS.escape(value)}"]`,
  );

  if (!chip) return false;

  chip.closest(".chip")?.remove();

  show(optionFor(root, name, hook, value), true);

  return true;
}

// ─── CHECKS ──────────────────────────────────────────────────────────────────
//
// A box per value, each labelled by a badge: the multi-valued control for a handful of values
// with a colour of their own, where a select would hide behind a placeholder what a badge says
// outright.
//
// The box is the control and the badge beside it is only a label — it carries no listener, so
// the one thing on the row that can be pressed is the one that looks like it.
//
// Three states, because a box can stand for several things and be part-way there: checked,
// `indeterminate` for some of them, and clear. Indeterminate is only ever set from outside —
// a click on one goes to checked, which is what "add the rest" should do.
//
// No state of its own, like the pinned selects: what is ticked is set by `markChecks` from
// whatever the caller holds, so a box can stand for something it doesn't store — the
// leaderboard's suites, which are ticked by the task chips under them.

// The box's name, on every one in the row.
const CHECK = "check";

/**
 * One row of them, all clear — call markChecks to tick them.
 *
 * @param name    what a listener finds them by, on every box in the row.
 * @param options [{ value, label, className }]. The class is the badge's own modifier, so a
 *                value with a colour keeps it here.
 * @returns the markup.
 */
function buildChecks({ name, options }) {
  return `
    <span class="row left gap-md">
      ${options
        .map(
          (option) => `
        <span class="row left gap-sm">
          <input
            class="input-checkbox"
            type="checkbox"
            data-${CHECK}="${escapeHtml(name)}"
            value="${escapeHtml(option.value)}"
            aria-label="${escapeHtml(option.label)}">
          <span class="badge ${escapeHtml(option.className ?? "")}">${escapeHtml(option.label)}</span>
        </span>`,
        )
        .join("")}
    </span>`;
}

/**
 * Tick the boxes under `root`.
 *
 * @param states value => "on" | "partial" | anything falsy for clear.
 */
function markChecks(root, name, states) {
  for (const box of root.querySelectorAll(`[data-${CHECK}="${name}"]`)) {
    const state = states[box.value];

    box.checked = state === "on";
    box.indeterminate = state === "partial";
  }
}

/**
 * Which box was just ticked, and what it now says — so a caller can read it as "add these" or
 * "take these off".
 *
 * @returns { name, value, on }, or null for an event that wasn't a box's. `on` is the state
 *          the box is in *after* the click, which is what the caller has to make true — so
 *          acting on it twice is acting on it once, and a caller listening for both `click`
 *          and `change` hears the same answer from each.
 */
function checkFromEvent(event) {
  const box = event.target?.closest?.(`input[data-${CHECK}]`);

  if (!box) return null;

  return { name: box.dataset[CHECK], value: box.value, on: box.checked };
}

// ─── CONTROLS BY KIND ────────────────────────────────────────────────────────

/**
 * One control, whatever kind it is, holding `value`.
 *
 * @param control   as createFilterState's — `type` names the kind and the rest is what that
 *                  kind's builder takes.
 * @param value     what it holds: a string, the pinned values, or a pair of bounds.
 * @param className carried through to a pinned select's own row.
 * @param labelled  a label above a select or a search, which otherwise carry their field
 *                  name in the placeholder. A pinned select and a range label themselves.
 *
 * @returns the markup.
 */
function buildFilterControl({
  control,
  value,
  className = "",
  labelled = false,
}) {
  if (control.type === "pinned") {
    return buildPinnedSelect({
      name: control.name,
      hook: control.hook,
      className,
      label: control.label,
      options: control.options,
      selected: value ?? [],
    });
  }

  if (control.type === "range") {
    return buildRange({
      name: control.name,
      label: control.label,
      ...control.range,
      value: value ?? null,
    });
  }

  // `required` is the bar's own notion — a control that picks *which* thing a table shows has
  // no "don't narrow" — so the blank option is dropped here rather than by buildSelect.
  const input =
    control.type === "select"
      ? buildSelect({
          name: control.name,
          options: control.options,
          selected: value || null,
          placeholder: control.required ? "" : control.placeholder,
        })
      : buildSearch({
          name: control.name,
          placeholder: control.placeholder,
          value: value ?? "",
        });

  if (!labelled) return input;

  return `
    <div class="column gap-sm">
      ${control.label ? `<span class="metadata">${escapeHtml(control.label)}</span>` : ""}
      ${input}
    </div>`;
}

// ─── BAR ─────────────────────────────────────────────────────────────────────

// A grid rather than a flex row: the controls carry width:100% from .input-select and
// .input-text, so only a grid gives them equal shares. A single control has no share to take
// and stays stacked.
const GRID_CLASS = { 2: "grid-2", 3: "grid-3", 4: "grid-4", 5: "grid-5" };

// Five to a row at most, and the rows are even rather than filled: ten controls are two
// fives, six are two threes, and no row is left holding one control at a fifth of the width.
const ROW_MAX = 5;

function toFilterRows(controls) {
  const count = Math.ceil(controls.length / ROW_MAX);
  const perRow = Math.ceil(controls.length / count);

  const rows = [];

  for (let at = 0; at < controls.length; at += perRow) {
    rows.push(controls.slice(at, at + perRow));
  }

  return { rows, perRow };
}

/**
 * The bar over a list: every control, five to a row.
 *
 * @param controls as createFilterState's, in the order they should read.
 * @param values   what each holds, by name. Omit for a bar that opens empty.
 *
 * @returns the markup.
 */
function buildFilterBar(controls, values = {}) {
  if (controls.length === 0) return "";

  // A pinned cell grows downwards as chips are added, so every cell states its field name —
  // a bar of placeholders beside a labelled column reads as two bars — and each row is
  // topped rather than stretched.
  const pinned = controls.some((control) => control.type === "pinned");

  const { rows, perRow } = toFilterRows(controls);

  // Not on the stacked fallback, where `align-items: start` would take a lone control down
  // to its content width.
  const grid = GRID_CLASS[perRow];
  const layout = grid ?? "column gap-md";
  const align = pinned && grid ? " align-start" : "";

  return `
    <div class="column gap-md">
      ${rows
        .map(
          (row) => `
        <div class="${layout}${align}">
          ${row
            .map((control) =>
              buildFilterControl({
                control,
                value: values[control.name],
                labelled: pinned,
              }),
            )
            .join("")}
        </div>`,
        )
        .join("")}
    </div>
  `;
}

export {
  SUITE_OPTIONS,
  UNPIN,
  buildChecks,
  buildFilterBar,
  buildFilterControl,
  buildOptions,
  buildPinnedControl,
  buildPinnedSelect,
  buildPins,
  buildSearch,
  buildSelect,
  checkFromEvent,
  markChecks,
  matchEquals,
  matchInArray,
  matchIncludes,
  optionsFromRows,
  pinFromEvent,
  pinIn,
  pinnedIn,
  unpinIn,
};

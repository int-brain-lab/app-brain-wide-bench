// The controls a list is narrowed by: one select, a bar of them, and the state behind a bar.
//
// Lifted out of tables/table.js so the two ways of reading a list can share one bar: the
// table filters through Tabulator, the cards filter an array, and neither owns the controls.
// Nothing here knows about either — a control is a `match(row, value)` and the values are a
// plain object, so whoever mounted the bar decides what a change does.
//
// `buildSelect` and `buildSearch` are also usable on their own, by a caller with one control
// and no bar: each takes the parts of a control it needs rather than a control, and the
// caller wires it up — see comparisons/modelComparison.js, which attaches its own listeners.
// The two `buildFilterBar*` below are the bar's own translation from a control to those
// parts.
//
// Every control matches against *rows* — what a domain's `toXRows` produced — which is why
// the cards on a list page render from rows too. One shape, one set of matchers.

import { escapeHtml } from "../core/html.js";
import { suiteLabel, SUITES } from "../core/suites.js";

// ─── MATCHERS ────────────────────────────────────────────────────────────────

// Hardcoded from SUITES rather than derived from the rows, so an option doesn't disappear
// exactly when nothing on the page covers that suite.
const SUITE_OPTIONS = SUITES.map((suite) => ({
  value: suite,
  label: suiteLabel(suite),
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
 * @param selected    the value to mark. Omit for none, which is what a bar wants: its state
 *                    is createFilterState's, set on the element after the markup exists.
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
 * @param hook     the data attribute carrying `name`, without the `data-`. "filter" is the
 *                 bar's, and createFilterState listens for it; a select outside a bar names
 *                 its own, so a bar can never hear a control it doesn't own.
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

// ─── BAR ─────────────────────────────────────────────────────────────────────

// A control as the bar declares it, turned into the parts the builders take. `required` is
// the bar's own notion — a control that picks *which* thing the table shows, like the
// leaderboard's metric, has no "don't narrow" — so it is read here rather than by
// buildSelect. Neither builder ever sees `match` or `type`.
function buildFilterBarSelect(control) {
  return buildSelect({
    name: control.name,
    options: control.options,
    placeholder: control.required ? "" : control.placeholder,
  });
}

function buildFilterBarSearch(control) {
  return buildSearch({
    name: control.name,
    placeholder: control.placeholder,
  });
}

// A grid rather than a flex row: the controls carry width:100% from .input-select and
// .input-text, so only a grid gives them equal shares. An unsupported count stacks.
const GRID_CLASS = { 2: "grid-2", 3: "grid-3", 4: "grid-4" };

function buildFilterBar(controls) {
  if (controls.length === 0) return "";

  const layout = GRID_CLASS[controls.length] ?? "column gap-md";

  return `
    <div class="${layout}">
      ${controls
        .map((control) =>
          control.type === "select"
            ? buildFilterBarSelect(control)
            : buildFilterBarSearch(control),
        )
        .join("")}
    </div>
  `;
}

// ─── STATE ───────────────────────────────────────────────────────────────────

/**
 * The values behind a bar already in the DOM, and the predicate they add up to.
 *
 * @param controls [{type: "search"|"select", name, placeholder, match, options, required}].
 *                 `name` keys the state; `match(row, value)` decides a row; `options` is
 *                 required for a select; `required` drops the blank "don't narrow" option
 *                 and starts on options[0].
 * @param root     the element the bar was rendered into. The listener is delegated to it,
 *                 so the controls can be replaced under it — see setControlOptions.
 * @param onChange (name, value) => void, after the state has been updated. Applying the
 *                 new predicate is the caller's: a table refilters, a grid re-renders.
 * @returns {matches, setControlOptions}. `setControlOptions` does *not* call `onChange` —
 *          it exists to be called from one, and would otherwise recurse.
 */
function createFilterState({ controls, root, onChange }) {
  // Scoped to this call, so two bars on one page can't fight over one set of values. A
  // `required` select starts on its first option to match the markup buildSelect emits for
  // it, rather than saying "no filter" while the visible select shows a choice.
  const values = Object.fromEntries(
    controls.map((control) => [
      control.name,
      control.required && control.options?.length
        ? String(control.options[0].value)
        : "",
    ]),
  );

  // A blank control is skipped rather than matched, so "All statuses" means "don't narrow"
  // instead of "status equals empty string".
  function matches(row) {
    return controls.every((control) => {
      const value = values[control.name].trim();
      return !value || control.match(row, value);
    });
  }

  // For a control whose choices depend on another control's value — the leaderboard's
  // metric list, which is the suites or the tasks depending on the grouping. The previous
  // value is dropped rather than preserved: the point of swapping the options is that the
  // old one may no longer exist, and a stale value would filter against a field no row has.
  function setControlOptions(name, options, selected) {
    const control = controls.find((candidate) => candidate.name === name);
    const select = root.querySelector(`select[data-filter="${name}"]`);
    if (!control || !select) return;

    control.options = options;
    select.innerHTML = buildOptions(options, {
      placeholder: control.required ? "" : control.placeholder,
    });

    const value =
      selected ??
      (control.required && options.length ? String(options[0].value) : "");

    select.value = value;
    values[name] = value;

    return value;
  }

  // Delegated, and on `input` rather than `change`: a <select> fires both, while a text
  // input only fires `change` on blur, leaving the list stale until the user clicks away.
  root.addEventListener("input", (event) => {
    const control = event.target.closest("[data-filter]");
    if (!control) return;

    values[control.dataset.filter] = control.value;

    onChange(control.dataset.filter, control.value);
  });

  return { matches, setControlOptions };
}

export {
  SUITE_OPTIONS,
  buildFilterBar,
  buildOptions,
  buildSearch,
  buildSelect,
  createFilterState,
  matchEquals,
  matchInArray,
  matchIncludes,
  optionsFromRows,
};

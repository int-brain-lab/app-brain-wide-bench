// The bar of filters above a list, and the state behind it.
//
// Lifted out of tables/table.js so the two ways of reading a list can share one bar: the
// table filters through Tabulator, the cards filter an array, and neither owns the controls.
// Nothing here knows about either — a control is a `match(row, value)` and the values are a
// plain object, so whoever mounted the bar decides what a change does.
//
// Every control matches against *rows* — what a domain's `toXRows` produced — which is why
// the cards on a list page render from rows too. One shape, one set of matchers.

import { escapeHtml } from "../core/utils.js";
import { SUITES } from "../core/suites.js";

// ─── MATCHERS ───────────────────────────────────────────────────────────────

// Hardcoded from SUITES rather than derived from the rows, so an option doesn't disappear
// exactly when nothing on the page covers that suite.
const SUITE_OPTIONS = SUITES.map((suite) => ({
  value: suite,
  label: suite.toUpperCase(),
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

// ─── BAR ────────────────────────────────────────────────────────────────────

function buildOptions(control) {
  return control.options
    .map(
      (option) => `
    <option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>
  `,
    )
    .join("");
}

// The blank first option doubles as the control's label, so an unset filter reads as
// "All suites" without a separate <label>. `required` omits it: a control that picks
// *which* thing the table shows — the leaderboard's metric — has no "don't narrow".
function buildSelect(control) {
  return `
    <select class="input-select" data-filter="${escapeHtml(control.name)}">
      ${control.required ? "" : `<option value="">${escapeHtml(control.placeholder)}</option>`}
      ${buildOptions(control)}
    </select>
  `;
}

function buildSearch(control) {
  return `
    <input
      class="input-text"
      type="search"
      data-filter="${escapeHtml(control.name)}"
      placeholder="${escapeHtml(control.placeholder)}">
  `;
}

// A grid rather than a flex row: the controls carry width:100% from .input-select and
// .input-text, so only a grid gives them equal shares. An unsupported count stacks.
const GRID_CLASS = { 2: "grid-2", 3: "grid-3", 4: "grid-4" };

function buildFilterBar(controls) {
  if (controls.length === 0) return "";

  const layout = GRID_CLASS[controls.length] ?? "column gap-md";

  return `
    <div class="${layout}">
      ${controls.map((control) => (control.type === "select" ? buildSelect(control) : buildSearch(control))).join("")}
    </div>
  `;
}

// ─── STATE ──────────────────────────────────────────────────────────────────

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
    select.innerHTML = `
      ${control.required ? "" : `<option value="">${escapeHtml(control.placeholder)}</option>`}
      ${buildOptions(control)}
    `;

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
  createFilterState,
  matchEquals,
  matchInArray,
  matchIncludes,
  optionsFromRows,
};

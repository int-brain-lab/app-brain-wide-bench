// Shared scaffolding for every Tabulator table in the app: the filter bar above the grid,
// the row count in its footer, and the plumbing that connects the two. Each table beside it
// in this folder supplies only its rows, columns and controls — nothing here knows what it
// is listing, and how a cell renders is in formatters.js.
//
// `Tabulator` is a global from the unpkg <script>, not this module graph, so a page
// mounting one of these tables needs both the tabulator JS and CSS tags — copy them from
// dashboard.html.

import { buildTableCount } from "../components/count.js";
import { escapeHtml } from "../core/utils.js";
import { SUITES } from "../core/suites.js";


// ─── CONTAINER ──────────────────────────────────────────────────────────────

// `caller` only shapes the error message: a bad id is the likeliest mistake at a mount
// site, and "no such container" beats the TypeError that writing to null would give.
function resolveContainer(container, caller) {
  const element = typeof container === "string"
    ? document.getElementById(container)
    : container;

  if (!element) {
    throw new Error(`${caller}: no such container "${container}"`);
  }

  return element;
}


// ─── FILTERS ────────────────────────────────────────────────────────────────

// Hardcoded from SUITES rather than derived from the rows, so an option doesn't disappear
// exactly when nothing on the page covers that suite.
const SUITE_OPTIONS = SUITES.map(suite => ({ value: suite, label: suite.toUpperCase() }));

// Each of these builds a control's `match`. They are only ever called with a non-empty
// value — createFilterableTable skips a blank control — so none has to treat "" as
// "match everything".

function matchIncludes(field) {
  return (row, value) =>
    String(row[field] ?? "").toLowerCase().includes(value.toLowerCase());
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
  return [...new Set(rows.map(row => row[field]).filter(value => value != null && value !== ""))]
    .sort((a, b) => String(a).localeCompare(String(b)))
    .map(value => ({ value, label: value }));
}


// ─── FILTER BAR ─────────────────────────────────────────────────────────────

function buildOptions(control) {
  return control.options.map(option => `
    <option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>
  `).join("");
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
      ${controls.map(control => control.type === "select" ? buildSelect(control) : buildSearch(control)).join("")}
    </div>
  `;
}


// ─── STATIC TABLE ───────────────────────────────────────────────────────────

// Plain `.table` markup from the same column definitions the Tabulator grids use, for a
// fixed preview.

// Sits at the right of the footer, opposite the count, pointing wherever the section
// heading above the table points. Two kinds of destination, because the headings have two:
// `href` leaves the page, `view` is a view the router switches to in place. A `view` keeps
// `href="#"` beside it — the router lets an unknown view fall through to the href, which is
// what lets one link work on a page that owns the view and on one that doesn't.
//
// No destination, no link: a preview whose heading has nowhere to go shouldn't invent one.
function buildViewAllLink(noun, viewAll) {
  if (!viewAll) return "";

  const target = viewAll.view
    ? `href="#" data-view="${escapeHtml(viewAll.view)}"`
    : `href="${escapeHtml(viewAll.href)}"`;

  return `<a class="link" data-role="view-all" ${target}>View all ${escapeHtml(noun)}s →</a>`;
}

// Tabulator hands a formatter a cell object, so a static render has to present one. This
// is the only place that shape is faked; the formatters work unchanged in both renderers.
function staticCell(row, field) {
  return {
    getValue: () => row[field],
    getData: () => row,
  };
}

// A column with no formatter falls back to its escaped raw value, as Tabulator would.
// Tabulator-only options (width, widthGrow, sorter, headerSort) are ignored.
function staticCellHtml(column, row) {
  if (typeof column.formatter === "function") {
    return column.formatter(staticCell(row, column.field));
  }

  const value = row[column.field];

  return value == null || value === "" ? "—" : escapeHtml(value);
}

// A preview shows the rows its filterable twin opens on, in the same order, so the two
// can't disagree about what comes first. `limit` is the preview's own business.
function previewRows(rows, compare, limit) {
  const ordered = [...rows].sort(compare);

  return limit == null ? ordered : ordered.slice(0, limit);
}

/**
 * @param columns Tabulator column definitions — `title`, `field`, `formatter`.
 * @param rows    already mapped, ordered and sliced — see previewRows.
 * @param noun    *singular* noun — the footer adds the "s", as createFilterableTable does.
 *                Omit to leave the footer off entirely.
 * @param total   rows before the slice, so the footer can say "3 out of 12". Defaults to
 *                what was rendered, for a preview that isn't one.
 * @param viewAll where the footer's "View all" link goes — {href} or {view}, matching the
 *                section heading above the table. Omit for no link.
 * @returns an HTML string; the caller does its own DOM write.
 */
function renderStaticTable({ columns, rows, noun, total = rows.length, viewAll }) {
  return `
    <div class="table">
      <table>
        <thead>
          <tr>${columns.map(column => `<th>${escapeHtml(column.title)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>${columns.map(column => `<td>${staticCellHtml(column, row)}</td>`).join("")}</tr>
          `).join("")}
        </tbody>
      </table>
      ${noun ? `
        <div class="table-footer">
          <span>${buildTableCount(rows.length, total, noun)}</span>
          ${buildViewAllLink(noun, viewAll)}
        </div>
      ` : ""}
    </div>
  `;
}


// ─── FILTERABLE TABLE ───────────────────────────────────────────────────────

/**
 * Mounts a Tabulator grid with a filter bar above it and a live row count in its footer.
 *
 * @param container      element, or the id of one. Its contents are replaced.
 * @param rows           plain row objects — map your API records first.
 * @param columns        Tabulator column definitions.
 * @param controls       [{type: "search"|"select", name, placeholder, match, options,
 *                       required}]. `name` keys the filter state; `match(row, value)`
 *                       decides a row; `options` is required for a select; `required`
 *                       drops the blank "don't narrow" option and starts on options[0].
 * @param onControlChange optional (name, value, {table, setControlOptions}) => void, run
 *                       after a control changes and the rows have been refiltered. For a
 *                       control that changes what is shown rather than which rows.
 * @param noun           *singular* noun — the count and the empty-state text add the "s".
 * @param initialSort    Tabulator initialSort, optional.
 * @param initialFilter  Tabulator initialFilter, optional — for a grid filtered by a
 *                       control that lives outside it, so the filter is in place before
 *                       the first render rather than applied to a half-built table.
 * @param paginationSize rows per page.
 * @param caller         name used in error messages.
 * @returns the Tabulator instance, so a caller can replaceData() on it later.
 */
function createFilterableTable({
  container,
  rows,
  columns,
  controls = [],
  noun = "row",
  initialSort,
  initialFilter,
  paginationSize = 10,
  onControlChange,
  caller = "createFilterableTable",
}) {
  if (typeof Tabulator === "undefined") {
    throw new Error(`${caller}: Tabulator is not loaded — add its <script> and <link> to the page.`);
  }

  const root = resolveContainer(container, caller);

  root.className = "column gap-md";
  root.innerHTML = `
    ${buildFilterBar(controls)}
    <div data-role="grid"></div>
  `;

  // The count element belongs to Tabulator's footer, and Tabulator builds its DOM
  // asynchronously — the moment the constructor below returns, `root` is still empty. So the
  // element is looked up per write rather than held, and nothing writes before the build.
  //
  // "display" rows are what is actually on screen: the filter *and* the current page applied.
  // So the footer counts the page you are looking at, not the whole filtered set.
  function setCount() {
    const count = root.querySelector("[data-role='count']");
    if (!count) return;

    count.textContent = buildTableCount(table.getDataCount("display"), rows.length, noun);
  }

  // Scoped to this call, so two tables on one page can't fight over one set of filter
  // values. A `required` select starts on its first option to match the markup buildSelect
  // emits for it, rather than saying "no filter" while the visible select shows a choice.
  const filters = Object.fromEntries(controls.map(control => [
    control.name,
    control.required && control.options?.length ? String(control.options[0].value) : "",
  ]));

  // A blank control is skipped rather than matched, so "All statuses" means "don't narrow"
  // instead of "status equals empty string".
  function matchesFilters(row) {
    return controls.every(control => {
      const value = filters[control.name].trim();
      return !value || control.match(row, value);
    });
  }

  const table = new Tabulator(root.querySelector("[data-role='grid']"), {
    data: rows,

    layout: "fitColumns",

    // Only page when there is a second page to go to, otherwise Tabulator renders a lone
    // "1" button. Keyed off the unfiltered total, so the buttons don't appear and vanish as
    // the user types.
    pagination: rows.length > paginationSize,
    paginationSize,

    // The count goes in Tabulator's own footer instead of a line under the table. Tabulator
    // lays that strip out as a flex row and gives the paginator `flex: 1; text-align: right`,
    // so whatever comes first sits left of the page buttons — and setting footerElement at
    // all is what keeps the footer when pagination is off and there are no buttons to hold
    // it open.
    footerElement: `<span data-role="count"></span>`,

    placeholder: `No ${noun}s match these filters.`,

    columns,

    ...(initialSort ? { initialSort } : {}),

    ...(initialFilter ? { initialFilter } : {}),
  });

  // Tabulator 6 dropped callbacks-as-options, so these are bound rather than passed above.
  // A `renderComplete:` key in the constructor is discarded in silence — OptionsList reads
  // `debugInvalidOptions` off the raw options before the defaults are merged in, so it never
  // even warns.

  // Both hang off one event. Tabulator rebuilds its rows on every filter, sort and page
  // change, so a render is exactly when the count can be wrong and when a formatter's
  // `<i data-lucide>` placeholders are new — and it fires after the display rows are
  // settled, which `dataFiltered` (before the display pipeline reruns) does not.
  table.on("renderComplete", () => {
    setCount();
    globalThis.lucide?.createIcons?.();
  });

  // For a control whose choices depend on another control's value — the leaderboard's
  // metric list, which is the suites or the tasks depending on the grouping. The previous
  // value is dropped rather than preserved: the point of swapping the options is that the
  // old one may no longer exist, and a stale value would filter against a field no row has.
  function setControlOptions(name, options, selected) {
    const control = controls.find(candidate => candidate.name === name);
    const select = root.querySelector(`select[data-filter="${name}"]`);
    if (!control || !select) return;

    control.options = options;
    select.innerHTML = `
      ${control.required ? "" : `<option value="">${escapeHtml(control.placeholder)}</option>`}
      ${buildOptions(control)}
    `;

    const value = selected ?? (control.required && options.length ? String(options[0].value) : "");

    select.value = value;
    filters[name] = value;
    table.setFilter(matchesFilters);

    return value;
  }

  // Delegated, and on `input` rather than `change`: a <select> fires both, while a text
  // input only fires `change` on blur, leaving the table stale until the user clicks away.
  root.addEventListener("input", event => {
    const control = event.target.closest("[data-filter]");
    if (!control) return;

    filters[control.dataset.filter] = control.value;
    table.setFilter(matchesFilters);

    // After the filter, so a handler that reads the table sees the new row set.
    onControlChange?.(control.dataset.filter, control.value, { table, setControlOptions });
  });

  return table;
}


export {
  SUITE_OPTIONS,
  resolveContainer,
  matchIncludes,
  matchEquals,
  matchInArray,
  optionsFromRows,
  previewRows,
  renderStaticTable,
  createFilterableTable,
};

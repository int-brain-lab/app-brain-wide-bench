// Shared scaffolding for the Tabulator tables in this directory: the filter bar
// above the grid, the row count below it, and the plumbing that connects the two.
// A domain module (tables/submissions.js, tables/models.js) supplies only its rows,
// columns and filter controls — nothing here knows what it is listing.
//
// `Tabulator` is a global from the unpkg <script>, not this module graph (the same
// arrangement as js/leaderboard.js), so a page mounting one of these tables needs
// both the tabulator JS and CSS tags — copy them from dashboard.html.

import { escapeHtml, formatDate } from "../utils.js";
import { SUITES, buildSuiteBadgeList } from "../utils/score-cards.js";


// ─── SUITES ─────────────────────────────────────────────────────────────────

// Both tables carry a Suites column and a suite filter, so the options and the
// formatter live here. Hardcoded from SUITES rather than derived from the rows, so
// an option doesn't disappear exactly when nothing on the page covers that suite.
const SUITE_OPTIONS = SUITES.map(suite => ({ value: suite, label: suite.toUpperCase() }));

function suiteBadgesFormatter(cell) {
  return `<span class="row left gap-sm">${buildSuiteBadgeList(cell.getValue() ?? [])}</span>`;
}

// Singular counterpart, for a row that belongs to exactly one suite (a task)
// rather than covering several (a submission, a model). Same badge markup, so the
// column reads the same down the page.
function suiteBadgeFormatter(cell) {
  const suite = cell.getValue();

  return suite ? buildSuiteBadgeList([suite]) : "—";
}

// Puts a row's suites in SUITES order rather than discovery order, so the badges
// line up column-to-column down the table.
function sortSuites(suites) {
  return SUITES.filter(suite => suites.includes(suite));
}


// ─── CONTAINER ──────────────────────────────────────────────────────────────

// `caller` only shapes the error message: a bad id is the likeliest mistake at a
// mount site, and "no such container" is a lot easier to act on than the
// TypeError that setting .className on null would otherwise give.
function resolveContainer(container, caller) {
  const element = typeof container === "string"
    ? document.getElementById(container)
    : container;

  if (!element) {
    throw new Error(`${caller}: no such container "${container}"`);
  }

  return element;
}


// ─── FORMATTERS ─────────────────────────────────────────────────────────────

// Tabulator inserts a formatter's returned string as HTML, so every formatter is
// an innerHTML sink. Model names, labels and team names are all user-supplied,
// hence escapeHtml on every interpolation here and in the callers.

// Curried on the page rather than taking a full href, so a caller can't
// accidentally pass an unencoded id: the id always goes through
// encodeURIComponent here.
function linkFormatter(page, labelField, idField = "id") {
  return cell => {
    const row = cell.getData();

    return `<a href="${page}?id=${encodeURIComponent(row[idField])}">${escapeHtml(row[labelField])}</a>`;
  };
}

function metadataFormatter(cell) {
  return `<span class="metadata">${escapeHtml(cell.getValue() ?? "—")}</span>`;
}

function dateFormatter(cell) {
  return `<span class="metadata">${escapeHtml(formatDate(cell.getValue()))}</span>`;
}

// Metric names as `.badge.metric` pills — the same primitive the suite cards on
// index.html use, down to the `row left gap-sm` wrapper, so a metric reads the
// same in a table cell as it does there.
//
// Takes a single name or an array: a task row carries just its primary metric
// today, but TaskScoreOut also has a `metrics` dict, so a cell showing several is
// the obvious next step and needs no second formatter.
function metricPillsFormatter(cell) {
  const value = cell.getValue();
  const metrics = Array.isArray(value) ? value : value == null ? [] : [value];

  if (metrics.length === 0) return "—";

  const pills = metrics
    .map(metric => `<span class="badge metric">${escapeHtml(metric)}</span>`)
    .join("");

  return `<span class="row left gap-sm">${pills}</span>`;
}

// Timestamps are nullable throughout the API, and Tabulator's built-in "datetime"
// sorter needs luxon — which this app doesn't load. ISO 8601 strings already order
// correctly under a plain comparison, so sort on the raw value and treat a missing
// date as the smallest, which puts those rows last under a desc sort.
function dateSorter(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}


// ─── FILTER MATCHERS ────────────────────────────────────────────────────────

// Each builds a control's `match`. They're only ever called with a non-empty
// value — createFilterableTable skips a blank control — so none of them has to
// treat "" as "match everything".

function matchIncludes(field) {
  return (row, value) =>
    String(row[field] ?? "").toLowerCase().includes(value.toLowerCase());
}

function matchEquals(field) {
  return (row, value) => String(row[field] ?? "") === value;
}

// For a field holding an array (a submission's `suites`), where the test is
// membership rather than equality.
function matchInArray(field) {
  return (row, value) => (row[field] ?? []).includes(value);
}


// ─── FILTER CONTROLS ────────────────────────────────────────────────────────

// For a select whose options are whatever the data happens to contain (team
// names) rather than a fixed server-side enum (statuses, suites) — those should
// stay hardcoded, so an option doesn't vanish exactly when a user has no rows
// with that value to search for.
function optionsFromRows(rows, field) {
  return [...new Set(rows.map(row => row[field]).filter(value => value != null && value !== ""))]
    .sort((a, b) => String(a).localeCompare(String(b)))
    .map(value => ({ value, label: value }));
}

// The empty-valued first option doubles as the control's label, so an unset filter
// reads as "All suites" rather than needing a separate <label> above it.
function buildSelect(control) {
  return `
    <select class="input-select" data-filter="${escapeHtml(control.name)}">
      <option value="">${escapeHtml(control.placeholder)}</option>
      ${control.options.map(option => `
        <option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>
      `).join("")}
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

// A grid rather than a flex row: the controls each carry width:100% from
// .input-select/.input-text, so only a grid actually gives them equal shares.
// An unsupported count falls back to stacking, which is ugly but never broken.
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

// Plain `.table` markup from the same column definitions the Tabulator grids use, for
// a small fixed preview — the model dashboard's "recent submissions" three-row table.
//
// Not a stripped-down createFilterableTable: that one needs the `Tabulator` global, and
// pulling its <script> and stylesheet onto a page for a three-row preview isn't worth
// it. Sharing the *columns* is what matters — the link target, date formatting and
// badge markup then can't drift between a preview and the full table.

// Tabulator hands a formatter a cell object, so a static render has to present one.
// This is the one place that shape is faked; the formatters themselves stay unchanged
// and work in both renderers.
function staticCell(row, field) {
  return {
    getValue: () => row[field],
    getData: () => row,
  };
}

// A column with no formatter falls back to its escaped raw value, matching what
// Tabulator would show. Tabulator-only options (width, widthGrow, sorter, headerSort)
// have no meaning here and are ignored.
function staticCellHtml(column, row) {
  if (typeof column.formatter === "function") {
    return column.formatter(staticCell(row, column.field));
  }

  const value = row[column.field];

  return value == null || value === "" ? "—" : escapeHtml(value);
}

/**
 * @param columns Tabulator column definitions — `title`, `field`, `formatter`.
 * @param rows    already mapped, sorted and sliced. Which rows to show is the
 *                caller's policy, not the table's.
 * @returns an HTML string; the caller does its own DOM write.
 */
function renderStaticTable({ columns, rows }) {
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
    </div>
  `;
}


// ─── TABLE ──────────────────────────────────────────────────────────────────

/**
 * Mounts a Tabulator grid with a filter bar above it and a live row count below.
 *
 * @param container      element, or the id of one. Its contents are replaced.
 * @param rows           plain row objects — map your API records first.
 * @param columns        Tabulator column definitions.
 * @param controls       [{type: "search"|"select", name, placeholder, match, options}].
 *                       `name` keys the filter state; `match(row, value)` decides a
 *                       row; `options` is required for a select.
 * @param noun           plural noun for the count and empty-state text.
 * @param initialSort    Tabulator initialSort, optional.
 * @param paginationSize rows per page.
 * @param caller         name used in error messages.
 * @returns the Tabulator instance, so a caller can replaceData() on it later.
 */
function createFilterableTable({
  container,
  rows,
  columns,
  controls = [],
  noun = "rows",
  initialSort,
  paginationSize = 10,
  selectable = false,
  onSelectionChange,
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
    <p class="metadata" data-role="count"></p>
  `;

  const count = root.querySelector("[data-role='count']");

  // Scoped to this call rather than module state, so two tables on one page can't
  // share (and fight over) one set of filter values.
  const filters = Object.fromEntries(controls.map(control => [control.name, ""]));

  // A blank control is skipped rather than matched, so "All statuses" means "don't
  // narrow" instead of "status equals empty string".
  function matchesFilters(row) {
    return controls.every(control => {
      const value = filters[control.name].trim();
      return !value || control.match(row, value);
    });
  }

  const table = new Tabulator(root.querySelector("[data-role='grid']"), {
    data: rows,

    layout: "fitColumns",

    // Only page when there's a second page to go to — otherwise Tabulator still
    // renders its footer with a lone "1" button, which reads as a control that
    // does nothing. Keyed off the unfiltered total rather than the filtered count,
    // since this is fixed at construction: deciding it per-filter would make the
    // footer appear and vanish as the user types.
    pagination: rows.length > paginationSize,
    paginationSize,

    placeholder: `No ${noun} match these filters.`,

    columns,

    ...(initialSort ? { initialSort } : {}),

    // Tabulator 6 renamed this from `selectable`. Selection survives filtering — a row
    // filtered out of view stays selected — which is what makes "search, tick, search
    // again, tick" work as a way to build up a set.
    ...(selectable ? { selectableRows: true } : {}),

    ...(onSelectionChange ? { rowSelectionChanged: data => onSelectionChange(data) } : {}),

    // Fires on every filter change, so the count reflects what's actually on
    // screen rather than the total the table was built with.
    dataFiltered: (_filters, filteredRows) => {
      count.textContent = filteredRows.length === rows.length
        ? `${rows.length} ${noun}`
        : `${filteredRows.length} of ${rows.length} ${noun}`;
    },

    // A formatter may emit `<i data-lucide>` placeholders (an Edit button, say).
    // createIcons() consumes them, and Tabulator rebuilds its rows on every filter,
    // sort and page change — so this has to run per render, not once at mount.
    renderComplete: () => globalThis.lucide?.createIcons?.(),
  });

  count.textContent = `${rows.length} ${noun}`;

  // Delegated, and on `input` rather than `change`: a <select> fires both, while a
  // text input only fires `change` on blur — which would leave the table stale
  // until the user clicked away.
  root.addEventListener("input", event => {
    const control = event.target.closest("[data-filter]");
    if (!control) return;

    filters[control.dataset.filter] = control.value;
    table.setFilter(matchesFilters);
  });

  return table;
}


export {
  SUITE_OPTIONS,
  suiteBadgesFormatter,
  suiteBadgeFormatter,
  sortSuites,
  resolveContainer,
  linkFormatter,
  metadataFormatter,
  dateFormatter,
  metricPillsFormatter,
  dateSorter,
  matchIncludes,
  matchEquals,
  matchInArray,
  optionsFromRows,
  buildSelect,
  buildSearch,
  buildFilterBar,
  renderStaticTable,
  createFilterableTable,
};

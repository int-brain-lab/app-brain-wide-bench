// Shared scaffolding for every Tabulator table in the app: the filter bar above the grid,
// the row count in its footer, and the plumbing that connects the two. Each table beside it
// in this folder supplies only its rows, columns and controls — nothing here knows what it
// is listing, and how a cell renders is in formatters.js.
//
// The bar itself is components/filters.js, shared with the card view of a list. This mounts
// it, hands its predicate to Tabulator, and knows nothing more about it.
//
// `Tabulator` is a global from the unpkg <script>, not this module graph, so a page
// mounting one of these tables needs both the tabulator JS and CSS tags — copy them from
// dashboard.html.

import { buildTableCount } from "../components/count.js";
import { escapeHtml } from "../core/utils.js";
import {
  SUITE_OPTIONS,
  buildFilterBar,
  createFilterState,
  matchEquals,
  matchInArray,
  matchIncludes,
  optionsFromRows,
} from "../components/filters.js";


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
 * @param index          the row field Tabulator identifies a row by, for a caller that
 *                       later selects or deselects one by value. Defaults to Tabulator's
 *                       own "id", which most of these rows have.
 * @param paginationSize rows per page.
 * @param onRowClick     optional (rowData, {event, element}) => void, on every row click.
 *                       The element is the row's own, for a caller that marks which one is
 *                       open; the event is there to be read, since a row holding a link has
 *                       two meanings for one click.
 * @param selection      optional {max, onChange} — makes rows pickable by clicking them,
 *                       highlighted rather than ticked, at most `max` at
 *                       a time, and calls `onChange(rows, {selected, deselected})` with the
 *                       selected row data — and the row components that just changed —
 *                       whenever that set changes. What is picked is said by the row's own
 *                       highlight — see `.tabulator-selected` in style.css — rather than by
 *                       a column of checkboxes beside it.
 *
 *                       `claimLinks: true` gives the whole row to picking, links included.
 *                       For a table building something out of what is picked — a
 *                       comparison — where following a link would throw the half-built
 *                       thing away. Off by default: a table that picks one row at a time to
 *                       show it below has no such thing to lose, and a link that looks live
 *                       and isn't reads as a bug.
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
  index,
  onControlChange,
  onRowClick,
  selection,
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

  // The bar's markup is already in `root`; this is the state behind it. Applying a change
  // is ours because only we have the table — see the onChange below.
  const filters = createFilterState({
    controls,
    root,
    onChange: (name, value) => {
      table.setFilter(filters.matches);

      // After the filter, so a handler that reads the table sees the new row set.
      onControlChange?.(name, value, { table, setControlOptions });
    },
  });

  // Swapping a control's options leaves the table showing the old one's rows, so the
  // refilter belongs here rather than in the caller's handler. createFilterState stops short
  // of it: it has no table to refilter.
  function setControlOptions(name, options, selected) {
    const value = filters.setControlOptions(name, options, selected);

    table.setFilter(filters.matches);

    return value;
  }

  const table = new Tabulator(root.querySelector("[data-role='grid']"), {
    data: rows,

    ...(index ? { index } : {}),

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

    // Tabulator 6's name for it — `selectable` is silently ignored, which reads as
    // selection simply not working rather than as a bad option.
    ...(selection ? { selectableRows: selection.max ?? true } : {}),
  });

  // What the cursor keys off: a row that can be picked says so under the pointer. Set on
  // every mount rather than only when selecting, so a container that held a picking table
  // and now holds a plain one doesn't go on claiming its rows do something.
  root.dataset.rowsSelectable = selection ? "true" : "false";

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

  // The row data rather than Tabulator's row components: everything downstream — the cards,
  // the chart — works on the same plain objects the table was given, and a component would
  // tie them to a table that re-creates them on every filter.
  if (selection) {
    // The deltas as well as the whole set: a caller holding the selection itself — the list
    // page, which keeps it across a filter and across the switch to cards — needs what
    // changed, not what Tabulator currently has selected.
    table.on("rowSelectionChanged", (data, _rows, selected, deselected) =>
      selection.onChange(data, { selected, deselected }));

    // There is no checkbox column: the row itself is the control, and the largest target in
    // most rows is a link to the thing the row is about. Where the caller asks for it, a
    // click on one picks the row rather than leaving the page — Tabulator's own row-click
    // selection runs either way, and this only cancels the navigation that would follow it.
    // Bound to the instance, so it goes when the table is rebuilt without a selection.
    if (selection.claimLinks) {
      table.on("rowClick", event => {
        if (event.target.closest("a")) event.preventDefault();
      });
    }
  }

  if (onRowClick) {
    table.on("rowClick", (event, row) => onRowClick(row.getData(), { event, element: row.getElement() }));
  }

  return table;
}


// TODO: the matchers and SUITE_OPTIONS are re-exported only so the tables beside this one
// keep their existing imports. They belong to components/filters.js now — move each table
// over to importing them from there, and drop them from this list.
export {
  SUITE_OPTIONS,
  matchEquals,
  matchInArray,
  matchIncludes,
  optionsFromRows,
};

export {
  resolveContainer,
  previewRows,
  renderStaticTable,
  createFilterableTable,
};

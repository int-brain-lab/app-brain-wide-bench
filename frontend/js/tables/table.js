// Shared scaffolding for the Tabulator tables: createTable is the grid and its row count,
// createFilterableTable is that with a filter bar above it. Each table beside them supplies
// its rows, columns and controls.
//
// `Tabulator` is a global from the unpkg <script>, so a page mounting one of these needs
// both its JS and CSS tags — copy them from dashboard.html.

import { buildTableCount } from "../components/count.js";
import { resolveContainer } from "../core/dom.js";
import { escapeHtml } from "../core/html.js";
import { refreshIcons, renderHtml, setText } from "../core/render.js";
import { buildFilterBar, createFilterState } from "../components/filters.js";

// ─── STATIC TABLE ────────────────────────────────────────────────────────────

// Plain `.table` markup from the column definitions the Tabulator grids use.

// `href` leaves the page, `view` is a router view. A `view` keeps `href="#"` beside it: the
// router falls through to the href on a page that doesn't own the view.
function buildViewAllLink(noun, viewAll) {
  if (!viewAll) return "";

  const target = viewAll.view
    ? `href="#" data-view="${escapeHtml(viewAll.view)}"`
    : `href="${escapeHtml(viewAll.href)}"`;

  return `<a class="link" data-role="view-all" ${target}>View all ${escapeHtml(noun)}s →</a>`;
}

// Formatters are handed a Tabulator cell object; this presents the same shape.
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

function previewRows(rows, compare, limit) {
  const ordered = [...rows].sort(compare);

  return limit == null ? ordered : ordered.slice(0, limit);
}

/**
 * A table as plain markup — no filters, no paging, no Tabulator.
 *
 * @param columns Tabulator column definitions — `title`, `field`, `formatter`.
 * @param rows    already mapped, ordered and sliced — see previewRows.
 * @param noun    *singular* noun — the footer adds the "s". Omit for no footer.
 * @param total   rows before the slice, for "3 out of 12". Defaults to `rows.length`.
 * @param viewAll {href} or {view} for the footer's "View all" link. Omit for no link.
 *
 * @returns the markup.
 */
function buildStaticTable({
  columns,
  rows,
  noun,
  total = rows.length,
  viewAll,
}) {
  return `
    <div class="table">
      <table>
        <thead>
          <tr>${columns.map((column) => `<th>${escapeHtml(column.title)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
            <tr>${columns.map((column) => `<td>${staticCellHtml(column, row)}</td>`).join("")}</tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
      ${
        noun
          ? `
        <div class="table-footer">
          <span>${buildTableCount(rows.length, total, noun)}</span>
          ${buildViewAllLink(noun, viewAll)}
        </div>
      `
          : ""
      }
    </div>
  `;
}

// ─── TABLE ───────────────────────────────────────────────────────────────────

/**
 * A live Tabulator grid over a set of rows.
 *
 * @param container      element, or the id of one, to build into. Omit for a table the
 *                       caller mounts itself — see `element` below.
 * @param rows           plain row objects — map the API records first.
 * @param columns        Tabulator column definitions.
 * @param noun           *singular* noun — the count and the empty-state text add the "s".
 * @param initialSort    Tabulator initialSort. Omit to leave the rows in their given order.
 * @param initialFilter  Tabulator initialFilter, in place before the first render, for a
 *                       grid narrowed by a control outside it. Omit for none.
 * @param paginationSize rows per page.
 * @param index          the row field Tabulator identifies a row by, for a caller that
 *                       later selects or deselects one by value. Defaults to "id".
 * @param onRowClick     (rowData, {event, element}) => void, on every row click. The
 *                       element is the row's own. Omit for no click handling.
 * @param selection      {max, onChange, claimLinks} — makes rows pickable by clicking
 *                       them, at most `max` at a time, and calls
 *                       `onChange(rows, {selected, deselected})` with the selected row data
 *                       and the row components that changed. A pick shows as the row's own
 *                       highlight — see `.tabulator-selected` in style.css.
 *                       `claimLinks: true` picks the row on a click on a link inside it
 *                       instead of following the link. Omit for a table nothing selects.
 * @param header         markup above the grid, inside the same root — see
 *                       createFilterableTable, which puts the filter bar there.
 *
 * @returns { element, table } — the root holding the grid, and the Tabulator instance.
 */
function createTable({
  container,
  rows,
  columns,
  noun = "row",
  initialSort,
  initialFilter,
  paginationSize = 10,
  index,
  onRowClick,
  selection,
  header = "",
}) {
  if (typeof Tabulator === "undefined") {
    throw new Error(
      `Tabulator is not loaded — add its <script> and <link> to the page.`,
    );
  }

  const root = container
    ? resolveContainer(container)
    : document.createElement("div");

  root.className = "column gap-md";

  renderHtml(
    root,
    `
      ${header}
      <div data-role="grid"></div>
    `,
  );

  // Tabulator builds its footer asynchronously, so the element is looked up per write.
  // "display" rows are the filter and the current page applied.
  function setCount() {
    const count = root.querySelector("[data-role='count']");
    if (!count) return;

    setText(
      count,
      buildTableCount(table.getDataCount("display"), rows.length, noun),
    );
  }

  const table = new Tabulator(root.querySelector("[data-role='grid']"), {
    data: rows,

    ...(index ? { index } : {}),

    layout: "fitColumns",

    // Off for a single page, where Tabulator renders a lone "1" button. Keyed off the
    // unfiltered total, so the buttons don't appear and vanish as the user types.
    pagination: rows.length > paginationSize,
    paginationSize,

    // Tabulator lays its footer out as a flex row and gives the paginator
    // `flex: 1; text-align: right`, so this sits left of the page buttons. Setting
    // footerElement also keeps the footer when pagination is off.
    footerElement: `<span data-role="count"></span>`,

    placeholder: `No ${noun}s match these filters.`,

    columns,

    ...(initialSort ? { initialSort } : {}),

    ...(initialFilter ? { initialFilter } : {}),

    ...(selection
      ? {
          // Tabulator 6's name for it — `selectable` is silently ignored.
          selectableRows: selection.max ?? true,
          // At the cap Tabulator's default deselects the oldest row and takes the new tick.
          // Refused instead, which is what the cards do: a pick stays until it is dropped.
          selectableRowsRollingSelection: false,
        }
      : {}),
  });

  // The row cursor keys off this — see `[data-rows-selectable]` in style.css.
  root.dataset.rowsSelectable = selection ? "true" : "false";

  // Tabulator 6 dropped callbacks-as-options: a `renderComplete:` key in the constructor is
  // discarded in silence. The event fires after the display rows have settled, which
  // `dataFiltered` — before the display pipeline reruns — does not.
  table.on("renderComplete", () => {
    setCount();
    refreshIcons();
  });

  if (selection) {
    table.on("rowSelectionChanged", (data, _rows, selected, deselected) =>
      selection.onChange(data, { selected, deselected }),
    );

    // Tabulator's own row-click selection runs either way; this cancels the navigation
    // that would follow it.
    if (selection.claimLinks) {
      table.on("rowClick", (event) => {
        if (event.target.closest("a")) event.preventDefault();
      });
    }
  }

  if (onRowClick) {
    table.on("rowClick", (event, row) =>
      onRowClick(row.getData(), { event, element: row.getElement() }),
    );
  }

  return { element: root, table };
}

// ─── FILTERABLE TABLE ────────────────────────────────────────────────────────

/**
 * createTable with a filter bar above the grid, narrowing it as the controls change.
 *
 * @param controls       [{type: "search"|"select", name, placeholder, match, options,
 *                       required}]. `name` keys the filter state; `match(row, value)`
 *                       decides a row; `options` is required for a select; `required`
 *                       drops the blank option and starts on options[0]. Empty for no bar.
 * @param onControlChange (name, value, {table, setControlOptions}) => void, run after a
 *                       control changes and the rows have been refiltered. Omit for none.
 * @param rest           as createTable.
 *
 * @returns { element, table } — as createTable; the root holds the bar and the grid.
 */
function createFilterableTable({ controls = [], onControlChange, ...rest }) {
  const { element, table } = createTable({
    ...rest,
    header: buildFilterBar(controls),
  });

  const filters = createFilterState({
    controls,
    root: element,
    onChange: (name, value) => {
      table.setFilter(filters.matches);

      // After the filter, so a handler reading the table sees the new row set.
      onControlChange?.(name, value, { table, setControlOptions });
    },
  });

  // createFilterState has no table of its own to refilter.
  function setControlOptions(name, options, selected) {
    const value = filters.setControlOptions(name, options, selected);

    table.setFilter(filters.matches);

    return value;
  }

  return { element, table };
}

export { previewRows, buildStaticTable, createTable, createFilterableTable };

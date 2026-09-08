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
import { buildFilterBar } from "../components/filters.js";
import { createFilterState } from "../components/filterState.js";

// ─── STATIC TABLE ────────────────────────────────────────────────────────────

// Plain `.table` markup from the column definitions the Tabulator grids use.

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
 *
 * @returns the markup.
 */
function buildStaticTable({
  columns,
  rows,
  noun,
  total = rows.length,
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
          <span class="metadata">${buildTableCount(rows.length, total, noun)}</span>
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
 * @param selection      {max, onChange, rolling, enabled} — makes rows pickable by
 *                       clicking them, at most `max` at a time, and calls
 *                       `onChange(rows, {selected, deselected})` with the selected row data
 *                       and the row components that changed. A pick shows as an edge down
 *                       the row's left — see `.tabulator-selected` in style.css.
 *                       `claimLinks` is () => whether a link inside a row is part of the row
 *                       rather than a way out of it: where it holds, a click on one picks the
 *                       row and the navigation is cancelled. Defaults to "whenever the row
 *                       may be picked"; a list that is only ever picking passes its own, since
 *                       there the links are the one way out.
 *                       `rolling: true` lets a pick past the cap push the oldest out, which
 *                       is what a panel showing one row at a time wants — clicking another
 *                       row plainly means "that one".
 *                       `enabled` is () => whether a click may pick at all, read live: a
 *                       board that only becomes pickable on demand cannot rebuild its rows
 *                       to say so — see canPick. Omit for rows that are always pickable.
 *                       Omit `selection` itself for a table nothing selects.
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
  layout = "fitColumns",
}) {
  if (typeof Tabulator === "undefined") {
    throw new Error(
      `Tabulator is not loaded — add its <script> and <link> to the page.`,
    );
  }

  const root = container
    ? resolveContainer(container)
    : document.createElement("div");

  root.className = "column gap-lg";

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

    layout: layout,

    // Off for a single page, where Tabulator renders a lone "1" button. Keyed off the
    // unfiltered total, so the buttons don't appear and vanish as the user types.
    pagination: rows.length > paginationSize,
    paginationSize,

    // Tabulator lays its footer out as a flex row and gives the paginator
    // `flex: 1; text-align: right`, so this sits left of the page buttons. Setting
    // footerElement also keeps the footer when pagination is off.
    footerElement: `<span class="metadata" data-role="count"></span>`,

    placeholder: `No ${noun}s match these filters.`,

    columns,

    ...(initialSort ? { initialSort } : {}),

    ...(initialFilter ? { initialFilter } : {}),

    ...(selection
      ? {
          // Tabulator 6's name for it — `selectable` is silently ignored.
          selectableRows: selection.max ?? true,
          // At the cap Tabulator's default deselects the oldest row and takes the new tick.
          // Refused unless asked for, which is what the cards do: a pick stays until it is
          // dropped. A single-row panel asks for it — see `rolling` above.
          selectableRowsRollingSelection: selection.rolling ?? false,
        }
      : {}),
  });

  // Whether a click may pick, read live so a caller can turn picking on and off without
  // rebuilding the rows — see selectableRows, which is fixed at row-init.
  const canPick = selection?.enabled ?? (() => true);

  // And whether a link inside a row is the row's rather than a way out of it.
  const claimsLinks = selection?.claimLinks ?? canPick;

  // The row cursor keys off this — see `[data-rows-selectable]` in style.css. Written again by
  // a caller that turns picking on or off.
  root.dataset.rowsSelectable = String(Boolean(selection) && canPick());

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

    // Where the row is the control, a link inside it goes nowhere: the pick wins and the
    // navigation is cancelled.
    table.on("rowClick", (event) => {
      if (claimsLinks() && event.target.closest("a")) event.preventDefault();
    });

    // Captured on the root, so it runs before the listener Tabulator put on the row and stops
    // the event reaching it — which is what keeps a row from being picked while picking is
    // off. `stopPropagation` leaves the default action alone, so the links still navigate.
    //
    // Rows only. The header sorts and the footer pages through the same root, and stopping
    // every click here left both of them dead whenever picking was off.
    root.addEventListener(
      "click",
      (event) => {
        if (!canPick() && event.target.closest(".tabulator-row")) {
          event.stopPropagation();
        }
      },
      true,
    );
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
 * @param controls as createFilterState's, in bar order. Empty for no bar.
 * @param rest     as createTable.
 *
 * @returns { element, table } — as createTable; the root holds the bar and the grid.
 */
function createFilterableTable({ controls = [], ...rest }) {
  const { element, table } = createTable({
    ...rest,
    header: buildFilterBar(controls),
  });

  const filters = createFilterState({
    controls,
    root: element,
    onChange: () => table.setFilter(filters.matches),
  });

  return { element, table };
}

export {
  buildStaticTable,
  createFilterableTable,
  createTable,
  previewRows,
};

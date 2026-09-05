// A view kept in step with a comparison's picks, and the picks with the view.
//
// Two directions: `selectionOptions` is what the view is built with, so a click reaches the
// comparison; `attach` wires the comparison back, so a change repaints the view.

import { highlightSelectedCards } from "../cards/cardGrid.js";

/**
 * A table bound to a comparison.
 *
 * @param comparison what to bind to.
 * @param rowIndex   (pick) => the value the table identifies its row by.
 * @param claimLinks as createTable. Left on, since a table bound to a comparison is usually
 *                   there to build the selection; a panel whose rows also link somewhere
 *                   passes false.
 * @param rolling    as createTable.
 * @returns { attach, quietly, selectionOptions, sync }. `selectionOptions()` is what
 *          createTable takes; `attach(table)` takes the instance, or null to detach.
 */
function createTableBinding(
  comparison,
  { rowIndex = (pick) => pick.key, claimLinks = true, rolling = false } = {},
) {
  let table = null;

  // Set while syncing the picks into the table, so those events aren't read back.
  let syncing = false;

  function sync() {
    // getRows throws on a table that is still building.
    if (!table?.initialized || syncing) return;

    const wanted = new Set(
      comparison.picks().map((pick) => String(rowIndex(pick))),
    );

    syncing = true;

    // Every row, not the displayed ones: a row hidden by a filter is still picked.
    const turning = table
      .getRows()
      .map((row) => [row, wanted.has(String(row.getIndex()))])
      .filter(([row, picked]) => picked !== row.isSelected());

    // Dropped before picked, both over the whole set: the table refuses a tick past its cap
    // rather than rolling the oldest out — see selectableRowsRollingSelection in
    // tables/table.js.
    for (const [row, picked] of turning) if (!picked) row.deselect();
    for (const [row, picked] of turning) if (picked) row.select();

    syncing = false;

    paint();
  }

  // The colour each row is marked in — see `--pick-ink` in style.css. Every row, so one that
  // has been dropped gives its colour up.
  function paint() {
    if (!table?.initialized) return;

    const inks = new Map(
      comparison
        .picks()
        .map((pick) => [
          String(rowIndex(pick)),
          comparison.colourFor(pick.key),
        ]),
    );

    for (const row of table.getRows()) {
      row
        .getElement()
        .style.setProperty("--pick-ink", inks.get(String(row.getIndex())) ?? "");
    }
  }

  /**
   * Runs a change to the table whose selection events are not the reader's.
   *
   * @param change () => void, over the table.
   */
  function quietly(change) {
    syncing = true;

    try {
      change();
    } finally {
      syncing = false;
    }

    sync();
  }

  function selectionOptions() {
    return {
      max: comparison.max,
      claimLinks,
      rolling,
      // The deltas, not the whole set: a row hidden by a filter is still picked.
      onChange: (_data, { selected = [], deselected = [] } = {}) => {
        if (syncing) return;

        for (const row of deselected) {
          comparison.drop(comparison.toKey(row.getData()));
        }

        for (const row of selected) comparison.pick(row.getData());

        // Takes back a tick the comparison refused past its cap.
        sync();
      },
    };
  }

  function attach(instance) {
    const target = instance ?? null;

    // Re-attaching the same instance must not stack a second listener.
    if (target === table) {
      sync();

      return;
    }

    table = target;

    if (!table) return;

    // Tabulator builds asynchronously; there are no rows to sync against yet.
    table.on("tableBuilt", sync);

    // Sorting, filtering and turning a page rebuild the row elements, which drops what was
    // painted onto them.
    table.on("renderComplete", paint);

    sync();
  }

  comparison.subscribe(sync);

  return { attach, quietly, selectionOptions, sync };
}

/**
 * A card grid bound to a comparison.
 *
 * @param comparison what to bind to.
 * @returns { attach, selectionOptions }. `selectionOptions()` is what the card grid takes;
 *          `attach(element)` takes the element it drew into, or null to detach.
 */
function createCardBinding(comparison) {
  let attached = null;

  function repaint() {
    if (attached) {
      highlightSelectedCards(
        attached,
        comparison.keySet(),
        comparison.colourFor,
      );
    }
  }

  function selectionOptions() {
    return {
      keys: comparison.keySet(),
      onToggle: (row) => comparison.toggle(row),
    };
  }

  function attach(element) {
    attached = element ?? null;
    repaint();
  }

  comparison.subscribe(repaint);

  return { attach, selectionOptions };
}

export { createCardBinding, createTableBinding };

// Several things side by side, whatever they are.
//
// Owns the picks, the detail behind each one, and the empty state. What is drawn from them is
// the `render` its caller supplies — see recordComparison.js and its siblings.
//
//   set(rows)              the whole selection
//   pick / toggle / drop   one at a time
//   subscribe(fn)          when the set changes
//
// createPicker below is the same set of picks with nothing drawn from them, for a list whose
// rows are chosen and then acted on elsewhere.
//
// bindTableSelection and bindCardSelection, below, sync a view to the picks — which is also
// where a reader takes one out again. What a row of the comparison looks like is
// components/comparisonGrid.js.

import { disposeAll } from "../core/disposable.js";
import { resolveContainer } from "../core/dom.js";
import { refreshIcons, renderHtml } from "../core/render.js";
import { createSelection } from "../core/selection.js";
import { highlightSelectedCards } from "../cards/cardGrid.js";
import { buildEmptyMessage } from "../components/messages.js";

// ─── CONTROLLER ──────────────────────────────────────────────────────────────

/**
 * @param container  element, or the id of one. Its contents are replaced.
 * @param max        how many can be compared at once. Refused past it, not swapped, unless
 *                   `rolling`.
 * @param rolling    a pick past `max` pushes the oldest out — for a controller holding one
 *                   thing at a time. A table bound to it wants the same flag, since
 *                   Tabulator enforces its own cap: see bindTableSelection.
 * @param prompt     what to say with nothing picked.
 * @param loadDetail (entry) => the record to attach as `entry.detail`. Absent until it
 *                   lands, so every render has to expect it missing.
 * @param cacheKey   (entry) => what loadDetail is cached under, across selections.
 * @param palette    the colours a pick can take, one per slot — see slotOf in
 *                   core/selection.js. A pick keeps its colour for as long as it is held,
 *                   so dropping one leaves the others as they were. Omit for no colouring.
 * @param render     ({ root, entries, colourOf, context, refresh, track }) => void, on every
 *                   change.
 *                   `root` holds whatever the last call left there. Anything needing
 *                   teardown goes to `track`; listeners go on elements the render just
 *                   made. `refresh()` draws again.
 * @param toEntry    (row) => entry, or null for a row this comparison can't take.
 * @param order      optional (entries) => entries. Defaults to pick order.
 */
function createComparison({
  container,
  max = Infinity,
  rolling = false,
  prompt = "Select things to compare them.",
  loadDetail,
  cacheKey = (entry) => entry.key,
  palette = [],
  render: draw,
  clearUp,
  toEntry,
  order = null,
}) {
  const root = resolveContainer(container);

  const selection = createSelection({
    max,
    slots: palette.length,
    rolling,
    onChange: () => {
      announce();
      render();
    },
  });

  // cacheKey => a promise for the detail.
  const details = new Map();

  // // What the entries are being compared on, as the host named it. Opaque here.
  let activeContext = "";

  // What the last render asked to have torn down.
  let tracked = [];

  const listeners = new Set();

  function entries() {
    const held = selection.entries();

    return order ? order(held) : held;
  }

  function announce() {
    for (const listener of listeners) listener(selection.keys());
  }

  // The colour this pick is drawn in, wherever it is drawn: its plot series, its row in the
  // table it was picked from, its row or column in the comparison itself.
  function colourOf(key) {
    const slot = selection.slotOf(key);

    return slot == null ? null : (palette[slot] ?? null);
  }

  // ── picking ──

  function keyOf(row) {
    return toEntry(row)?.key;
  }

  function pick(row) {
    const entry = toEntry(row);

    if (!entry || !selection.add(entry)) return false;

    ensureDetail(entry);

    return true;
  }

  function toggle(row) {
    const entry = toEntry(row);

    if (!entry) return false;

    return selection.has(entry.key) ? selection.remove(entry.key) : pick(row);
  }

  function drop(key) {
    return selection.remove(key);
  }

  /**
   * The whole selection at once. Rows `toEntry` returns nothing for are dropped.
   *
   * @param rows    every row that should now be picked.
   * @param context optionally, what they are compared on.
   */
  function set(rows, context) {
    const contextChanged =
      context === undefined ? false : applyContext(context);

    const changed = selection.replace(rows.map(toEntry).filter(Boolean));

    for (const entry of selection.entries()) ensureDetail(entry);

    if (!changed && contextChanged) render();

    return changed;
  }

  /** Empties the selection, and puts the prompt back whether or not it held anything. */
  function clear() {
    if (!selection.clear()) render();
  }

  /**
   * Forgets what has been fetched, keeping the picks: whatever is held is asked for again.
   *
   * For a host whose picks outlive the thing they describe — a leaderboard refetches its board
   * under them, and a detail fetched against the entries the old board named is no longer
   * about what is on screen. The picks are the reader's; the data behind them is not.
   */
  function clearDetails() {
    if (!details.size) return;

    details.clear();

    for (const entry of selection.entries()) {
      entry.detail = undefined;
      ensureDetail(entry);
    }

    render();
  }

  // ── loading ──

  function ensureDetail(entry) {
    if (entry.detail) return;

    const key = cacheKey(entry);

    if (!details.has(key)) {
      details.set(
        key,
        Promise.resolve()
          .then(() => loadDetail(entry))
          .catch((error) => {
            console.error(error);

            // Uncached, so a later pick retries.
            details.delete(key);

            return {};
          }),
      );
    }

    details.get(key).then((detail) => {
      entry.detail = detail;

      // Identity, not the key: unticking and reticking makes a new entry.
      if (selection.get(entry.key) === entry) render();
    });
  }

  // // ── context ──

  function applyContext(context) {
    if ((context ?? "") === activeContext) return false;

    activeContext = context ?? "";

    return true;
  }

  function setContext(context) {
    if (applyContext(context)) render();
  }

  // ── drawing ──

  // function track(handle) {
  //   if (handle) tracked = tracked.concat(handle);
  //
  //   return handle;
  // }

  function render() {
    clearUp()
    // disposeAll(tracked);
    // tracked = [];

    if (!selection.size) {
      renderHtml(root, buildEmptyMessage(prompt));

      return;
    }

    draw()

    refreshIcons();
  }

  function destroy() {
    disposeAll(tracked);
    tracked = [];
    listeners.clear();
  }

  render();

  return {
    clear,
    clearDetails,
    colourOf,
    destroy,
    drop,
    entries,
    keyOf,
    keySet: selection.keySet,
    keys: selection.keys,
    max,
    pick,
    refresh: render,
    set,
    activeContext,
    get size() {
      return selection.size;
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    toggle,
  };
}

// ─── PICKER ──────────────────────────────────────────────────────────────────

/**
 * Picks with nothing behind them: the shape the two binders below take, for a list whose rows
 * are chosen and then acted on somewhere else rather than opening a panel beside them.
 *
 * No detail, no prompt, no drawing — so no container either. The caller reads `keys()` when
 * its own control is pressed, and `subscribe` tells it when there is something to press.
 *
 * A comparison's shape and not a plainer one, because that is what makes the syncing and the
 * painting reusable: a picked row highlights, a filter that rebuilt the table puts the
 * highlights back, and the cards agree with the table, all without a second copy of any of it.
 *
 * @param max     how many can be held at once. Refused past it, as a comparison refuses.
 * @param palette the colours a pick can take, one per slot, as createComparison's. Given one,
 *                a pick is marked in the colour it will be drawn in wherever it is handed on
 *                — slots go out in pick order, so a list and the page it hands its picks to
 *                agree without either being told the other's colours. Omit for no colouring.
 * @param toEntry (row) => { key }, or null for a row this picker can't take.
 */
function createPicker({ max = Infinity, palette = [], toEntry }) {
  const listeners = new Set();

  const selection = createSelection({
    max,
    slots: palette.length,
    onChange: () => {
      for (const listener of listeners) listener(selection.keys());
    },
  });

  function pick(row) {
    const entry = toEntry(row);

    return Boolean(entry) && selection.add(entry);
  }

  function toggle(row) {
    const entry = toEntry(row);

    if (!entry) return false;

    return selection.has(entry.key) ? selection.remove(entry.key) : pick(row);
  }

  return {
    clear: selection.clear,
    // As createComparison's: the colour is the slot's, held for as long as the pick is, so
    // dropping one leaves the others as they were. Null without a palette, which leaves the
    // app's own pick edge — see `--pick-ink` in style.css.
    colourOf(key) {
      const slot = selection.slotOf(key);

      return slot == null ? null : (palette[slot] ?? null);
    },
    drop: (key) => selection.remove(key),
    entries: selection.entries,
    keyOf: (row) => toEntry(row)?.key,
    keySet: selection.keySet,
    keys: selection.keys,
    max,
    pick,
    get size() {
      return selection.size;
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    toggle,
  };
}

// ─── VIEWS ───────────────────────────────────────────────────────────────────
//
// A view reports what the reader did and paints what the comparison — or the picker above —
// then holds.

/**
 * @param comparison what to bind to.
 * @param rowIndex   (entry) => the value the table identifies its row by. Defaults to the
 *                   entry's key.
 * @param claimLinks as createFilterableTable. Left on, since a table bound to a comparison
 *                   is usually there to build the selection; a panel whose rows also link
 *                   somewhere passes false.
 * @param rolling    as createFilterableTable. On for a controller holding one thing at a
 *                   time, so a click on another row replaces what is shown rather than
 *                   being refused.
 * @returns { apply, attach, sync, selection }. `selection()` is the option the table
 *          factories take; `attach(table)` takes the instance, or null to detach.
 */
function bindTableSelection(
  comparison,
  { rowIndex = (entry) => entry.key, claimLinks = true, rolling = false } = {},
) {
  let table = null;

  // Set while syncing the selection into the table, so those events aren't read back.
  let syncing = false;

  function sync() {
    // getRows throws on a table that is still building.
    if (!table?.initialized || syncing) return;

    const wanted = new Set(
      comparison.entries().map((entry) => String(rowIndex(entry))),
    );

    syncing = true;

    // Every row, not the displayed ones: a row hidden by a filter is still picked.
    const turning = table
      .getRows()
      .map((row) => [row, wanted.has(String(row.getIndex()))])
      .filter(([row, picked]) => picked !== row.isSelected());

    // Dropped before picked, both passes over the whole set: the table refuses a tick past
    // its cap rather than rolling the oldest out, so a wholesale replacement has to make room
    // before it asks for it — see selectableRowsRollingSelection in tables/table.js.
    for (const [row, picked] of turning) if (!picked) row.deselect();
    for (const [row, picked] of turning) if (picked) row.select();

    syncing = false;

    paint();
  }

  comparison.subscribe(sync);

  // The colour each row is marked in — see `--pick-ink` in style.css. Painted here rather
  // than through a Tabulator rowFormatter, because the formatter is a table option and not
  // every host builds the table from `selection()`: the leaderboard writes its own, since
  // which comparison a tick belongs to isn't settled until the board exists.
  //
  // Every row, so one that has been dropped gives its colour up — an empty value removes the
  // property, which puts the app's own edge back.
  function paint() {
    if (!table?.initialized) return;

    const inks = new Map(
      comparison
        .entries()
        .map((entry) => [
          String(rowIndex(entry)),
          comparison.colourOf(entry.key),
        ]),
    );

    for (const row of table.getRows()) {
      row
        .getElement()
        .style.setProperty(
          "--pick-ink",
          inks.get(String(row.getIndex())) ?? "",
        );
    }
  }

  function selection() {
    return {
      max: comparison.max,
      claimLinks,
      rolling,
      // The deltas, not the whole set: a row hidden by a filter is still picked.
      onChange: (_data, { selected = [], deselected = [] } = {}) => {
        if (syncing) return;

        for (const row of deselected) {
          comparison.drop(comparison.keyOf(row.getData()));
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

  /**
   * Run a mutation that disturbs the ticks — a filter — and put them right afterwards.
   *
   * @param mutate what to run with the selection events ignored.
   */
  function apply(mutate) {
    syncing = true;

    try {
      mutate();
    } finally {
      syncing = false;
    }

    sync();
  }

  return { apply, attach, sync, selection };
}

/**
 * @param comparison what to bind to.
 * @returns { attach, selection }. `selection()` is the option the card grid takes;
 *          `attach(element)` takes the element it drew into, or null to detach.
 */
function bindCardSelection(comparison) {
  let attached = null;

  function repaint() {
    if (attached)
      highlightSelectedCards(
        attached,
        comparison.keySet(),
        comparison.colourOf,
      );
  }

  comparison.subscribe(repaint);

  function selection() {
    return {
      keys: comparison.keySet(),
      onToggle: (row) => comparison.toggle(row),
    };
  }

  function attach(element) {
    attached = element ?? null;
    repaint();
  }

  return { attach, selection };
}

export {
  bindCardSelection,
  bindTableSelection,
  createComparison,
  createPicker,
};

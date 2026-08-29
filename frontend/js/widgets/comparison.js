// Several things side by side, whatever they are.
//
// Owns the picks, the detail behind each one, the ✕ and the empty state. What is drawn from
// them is the `render` its caller supplies — see comparisons/.
//
//   set(rows)              the whole selection
//   pick / toggle / drop   one at a time
//   subscribe(fn)          when the set changes
//
// bindTableSelection and bindCardSelection, below, sync a view to the picks.

import { escapeHtml } from "../core/html.js";
import { refreshIcons, renderHtml } from "../core/render.js";
import { buildEmptyMessage } from "../components/messages.js";
import { disposeAll } from "../core/disposable.js";
import { resolveContainer } from "../core/dom.js";
import { createSelection } from "../core/selection.js";
import { highlightSelectedCards } from "../cards/cardGrid.js";
import { getIcon } from "../components/icons.js";

// ─── ROW HEADERS ─────────────────────────────────────────────────────────────

// Read back by onClick, below.
function buildDropButton(key, name) {
  return `
    <button
      type="button"
      class="chip-remove"
      data-role="drop"
      data-key="${escapeHtml(key)}"
      title="Remove ${escapeHtml(name)}"
      aria-label="Remove ${escapeHtml(name)}"
    >
      <i class="field-icon" data-lucide="${escapeHtml(getIcon("remove"))}"></i>
    </button>`;
}

/**
 * A comparison grid's row header: the ✕, what the row is, and a quieter line under it.
 *
 * @param key   the entry's, which is what the ✕ hands back.
 * @param title markup — a link, a label, a run of badges.
 * @param meta  text, escaped here.
 * @param name  the thing's name in plain words, for the button's label.
 */
function buildRowHeader({ key, title, meta = "", name = "" }) {
  return `
    <span class="column gap-xs">
      <span class="row left gap-sm">
        ${buildDropButton(key, name)}
        ${title}
      </span>
      ${meta ? `<span class="metadata">${escapeHtml(meta)}</span>` : ""}
    </span>`;
}

// ─── CONTROLLER ──────────────────────────────────────────────────────────────

/**
 * @param container  element, or the id of one. Its contents are replaced.
 * @param max        how many can be compared at once. Refused past it, not swapped.
 * @param prompt     what to say with nothing picked.
 * @param loadDetail (entry) => the record to attach as `entry.detail`. Absent until it
 *                   lands, so every render has to expect it missing.
 * @param cacheKey   (entry) => what loadDetail is cached under, across selections.
 * @param render     ({ root, entries, context, refresh, track }) => void, on every change.
 *                   `root` holds whatever the last call left there. Anything needing
 *                   teardown goes to `track`; listeners go on elements the render just
 *                   made. `refresh()` draws again.
 * @param toEntry    (row) => entry, or null for a row this comparison can't take.
 * @param order      optional (entries) => entries. Defaults to pick order.
 */
function createComparison({
  container,
  max = Infinity,
  prompt = "Select things to compare them.",
  loadDetail,
  cacheKey = (entry) => entry.key,
  render: draw,
  toEntry,
  order = null,
}) {
  const root = resolveContainer(container);

  const selection = createSelection({
    max,
    onChange: () => {
      announce();
      render();
    },
  });

  // cacheKey => a promise for the detail.
  const details = new Map();

  // What the entries are being compared on, as the host named it. Opaque here.
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

  // ── context ──

  function applyContext(context) {
    if ((context ?? "") === activeContext) return false;

    activeContext = context ?? "";

    return true;
  }

  function setContext(context) {
    if (applyContext(context)) render();
  }

  // ── drawing ──

  function track(handle) {
    if (handle) tracked = tracked.concat(handle);

    return handle;
  }

  function render() {
    disposeAll(tracked);
    tracked = [];

    if (!selection.size) {
      renderHtml(root, buildEmptyMessage(prompt));

      return;
    }

    draw({
      root,
      entries: entries(),
      context: activeContext,
      refresh: render,
      track,
    });

    refreshIcons();
  }

  // ── events ──

  function onClick(event) {
    const button = event.target.closest("[data-role='drop']");

    if (button) drop(button.dataset.key);
  }

  root.addEventListener("click", onClick);

  function destroy() {
    disposeAll(tracked);
    tracked = [];
    listeners.clear();
    root.removeEventListener("click", onClick);
  }

  render();

  return {
    clear,
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
    setContext,
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
// A view reports what the reader did and paints what the comparison then holds.

/**
 * @param comparison what to bind to.
 * @param rowIndex   (entry) => the value the table identifies its row by. Defaults to the
 *                   entry's key.
 * @param claimLinks as createFilterableTable.
 * @returns { apply, attach, sync, selection }. `selection()` is the option the table
 *          factories take; `attach(table)` takes the instance, or null to detach.
 */
function bindTableSelection(
  comparison,
  { rowIndex = (entry) => entry.key, claimLinks = true } = {},
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
    for (const row of table.getRows()) {
      const picked = wanted.has(String(row.getIndex()));

      if (picked === row.isSelected()) continue;

      if (picked) row.select();
      else row.deselect();
    }

    syncing = false;
  }

  comparison.subscribe(sync);

  function selection() {
    return {
      max: comparison.max,
      claimLinks,
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
    if (attached) highlightSelectedCards(attached, comparison.keySet());
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
  buildRowHeader,
  createComparison,
};

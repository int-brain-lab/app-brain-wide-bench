// Several things side by side, whatever they are.
//
// One controller behind every comparison in the app. It holds what the reader picked, turns
// each pick into an entry, fetches the detail behind it, and draws the panels — the grids
// and the plots — from those entries. What is being compared it does not know: that comes in
// as the panels, the loaders and the header, from the module in comparisons/.
//
// The picks live here rather than in whatever table or grid the reader picked from. That is
// the whole design, and it is what the hosts used to do badly: a picked row can be filtered
// out of a table, be on another page of the cards, or be in a table that has since been
// destroyed and rebuilt for the other view, so what is picked cannot be read back off the
// view. Views reconcile to this instead — see bindTable and bindCards below, which is where
// every `for (const key of overflow) table.deselectRow(key)` went.
//
// Hosts hand it rows and get nothing back but a promise-free API:
//
//   set(rows)      the whole selection, from a view that reports what it has
//   pick / toggle / drop   one at a time, from a view that reports what changed
//   subscribe(fn)  when the set changes, for a view or a URL that mirrors it

import { escapeHtml, refreshIcons } from "../core/utils.js";
import { showEmpty, showMessage } from "../core/message.js";
import { disposeAll } from "../core/disposable.js";
import { resolveContainer } from "../core/dom.js";
import { createSelection } from "../core/selection.js";
import { markCardSelection } from "../cards/cardGrid.js";
import { getIcon } from "../components/icons.js";
import { buildViewToggle, viewFromClick } from "../components/viewToggle.js";

// ─── ROW HEADERS ────────────────────────────────────────────────────────────

// The ✕ is the controller's rather than the panel's: what it removes is the selection, and
// the selection is here. A panel only asks for `headerFor(entry)` and puts it in its grid.
function buildDropButton(entry, name) {
  return `
    <button
      type="button"
      class="chip-remove"
      data-role="drop"
      data-key="${escapeHtml(entry.key)}"
      title="Remove ${escapeHtml(name)}"
      aria-label="Remove ${escapeHtml(name)}"
    >
      <i class="field-icon" data-lucide="${escapeHtml(getIcon("remove"))}"></i>
    </button>`;
}

// One shape for every comparison's row header, because both of them had already arrived at
// it independently: what the row is, on a line with the ✕ and whatever badges qualify it,
// and a quieter line under that saying which thing's it is.
//
// `title` is markup — a link, a label, a run of badges — and `meta` is text, escaped here.
function buildRowHeader(entry, header) {
  const { title, meta = "", name = "" } = header(entry);

  return `
    <span class="column gap-xs">
      <span class="row left gap-sm">
        ${buildDropButton(entry, name)}
        ${title}
      </span>
      ${meta ? `<span class="metadata">${escapeHtml(meta)}</span>` : ""}
    </span>`;
}

// ─── CONTROLLER ─────────────────────────────────────────────────────────────

/**
 * @param container element, or the id of one. Its contents are replaced.
 *
 * What a comparison of this thing is. Supplied by its module in comparisons/, the same for
 * every host that mounts one:
 *
 * @param max        how many can be compared at once. Refused past it, not swapped.
 * @param prompt     what to say with nothing picked. Per instance, so the leaderboard can
 *                   say "rows" where the scores page says "task scores".
 * @param loadDetail (entry) => the record the panels are drawn from.
 * @param cacheKey   (entry) => what loadDetail is cached under. Across selections, so
 *                   unticking and reticking — which readers do constantly — is free.
 * @param loadFields optional () => field definitions, fetched once per comparison and
 *                   handed to every panel. Nothing renders until it lands.
 * @param header     (entry) => { title, meta, name } — see buildRowHeader.
 * @param panels     [{ id, title, views, defaultView, controls, ready, available, render }]:
 *
 *                     views      the toggle this panel offers, as buildViewToggle takes them.
 *                     controls   true if the context control mounts in this panel's header.
 *                     ready      "all" to hold the panel until every entry's detail has
 *                                landed. For a panel that cannot tell "nothing to show"
 *                                from "not here yet" — which is most of them that read
 *                                scores. Default: draw as they arrive.
 *                     available  ({entries, fields, context}) => true, or the note to show
 *                                instead. A panel with nothing to compare has no view to
 *                                choose between either, so its toggle goes with it.
 *                     render     ({container, entries, fields, context, view, headerFor,
 *                                refresh}) => whatever needs disposing before the next one.
 *
 * @param context    optional { label, options({entries, fields}) } — the control naming what
 *                   the scores are read on, which is the suite. Only where the host names
 *                   none: one that does owns it, and a second select beside it could only
 *                   disagree.
 * @param loadingMessage what a panel says while it waits.
 *
 * What this host contributes:
 *
 * @param toEntry    (row) => entry, or null for a row this comparison can't take. The same
 *                   comparison is fed by a board row, a model row and a card, and only the
 *                   host knows which it has.
 * @param order      optional (entries) => entries, for a host with a first among them — the
 *                   compare page's reference. Otherwise the order they were picked in.
 */
function createComparison({
  container,
  max = Infinity,
  prompt = "Select things to compare them.",
  loadDetail,
  cacheKey = (entry) => entry.key,
  loadFields = null,
  header,
  panels = [],
  context = null,
  loadingMessage = "Loading…",
  toEntry,
  order = null,
}) {
  const root = resolveContainer(container);

  const selection = createSelection({ max, onChange: () => settled() });

  // A view that reports its picks one at a time — a table handing back three newly selected
  // rows — would otherwise redraw the panels once per row, each time throwing away the last
  // draw's charts. Depth rather than a flag, so a batch inside a batch still settles once.
  let batching = 0;
  let pending = false;

  function settled() {
    if (batching) {
      pending = true;

      return;
    }

    announce();
    render();
  }

  function batch(mutate) {
    batching += 1;

    try {
      mutate();
    } finally {
      batching -= 1;
    }

    if (!batching && pending) {
      pending = false;
      settled();
    }
  }

  // Keyed on cacheKey rather than on the entry, so a thing unticked and reticked — or picked
  // again from a table that has been rebuilt since — is not fetched twice.
  const details = new Map();

  let fields = null;
  let fieldsPending = false;

  // The context the host named, "" for "you choose". Held apart from the value in force,
  // which is whatever is on screen: the two differ exactly when this controller is choosing.
  let hostContext = "";
  let contextValue = "";

  // Whether the context on screen is the reader's choice or this controller's guess. The
  // details arrive one request at a time, so a guess made when the first landed would
  // otherwise stick even after a later one brought an earlier option with it.
  let contextChosen = false;

  // Which way each panel is being read, and what its last render left to dispose. Views are
  // sticky for the life of the controller: a reader who came for the numbers on one suite
  // wants them on the next one too.
  const views = Object.fromEntries(
    panels.map((panel) => [
      panel.id,
      panel.defaultView ?? panel.views?.[0]?.value ?? null,
    ]),
  );
  const handles = {};

  const listeners = new Set();

  // The panel skeleton survives every render; only the bodies are rewritten. Rebuilt after
  // the empty state, which replaces the whole root.
  let built = false;

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
   * The whole selection at once, for a view that reports what it has. Rows this comparison
   * can't take are dropped rather than refused loudly — the leaderboard's board holds rows
   * with no score on the chosen task.
   *
   * @param next optionally the context, for a host that names it — the suite the compare
   *             page picked above its table.
   */
  function set(rows, next) {
    const contextChanged = next === undefined ? false : applyContext(next);
    const changed = selection.replace(rows.map(toEntry).filter(Boolean));

    for (const entry of selection.entries()) ensureDetail(entry);

    // selection.replace renders through its own onChange; this is the case where only the
    // context moved and the panels still have to be redrawn on it.
    if (!changed && contextChanged) render();

    return changed;
  }

  function clear() {
    // Rendered even when there was nothing to clear: a host clearing an empty comparison is
    // asking for its prompt back — see the leaderboard entering compare mode.
    if (!selection.clear()) render();
  }

  // ── loading ──

  function ensureDetail(entry) {
    if (entry.detail) return;

    ensureFields();

    const key = cacheKey(entry);

    if (!details.has(key)) {
      details.set(
        key,
        Promise.resolve()
          .then(() => loadDetail(entry))
          .catch((error) => {
            console.error(error);

            // Dropped from the cache so a retry is possible, and answered with an empty
            // record so the panels draw the row with its values missing rather than waiting
            // for something that will never come.
            details.delete(key);

            return {};
          }),
      );
    }

    details.get(key).then((detail) => {
      entry.detail = detail;

      // The entry may have been dropped while the request was in flight — and re-picked,
      // which makes a new one, so identity rather than the key.
      if (selection.get(entry.key) === entry) render();
    });
  }

  function ensureFields() {
    if (!loadFields || fields || fieldsPending) return;

    fieldsPending = true;

    Promise.resolve()
      .then(loadFields)
      .catch((error) => {
        console.error(error);

        return {};
      })
      .then((loaded) => {
        fields = loaded;
        fieldsPending = false;
        render();
      });
  }

  // ── context ──

  function applyContext(value) {
    const next = value ?? "";

    if (next === hostContext) return false;

    hostContext = next;

    // The host's choice wins outright and is not the reader's to override here; without one,
    // the value in force keeps whatever the reader last chose and settleContext decides it.
    if (hostContext) {
      contextValue = hostContext;
      contextChosen = false;
    }

    return true;
  }

  function setContext(value) {
    if (applyContext(value)) render();
  }

  function contextOptions() {
    return context?.options({ entries: entries(), fields }) ?? [];
  }

  // Settled only once every detail has landed, because the options are read off them: until
  // then "nothing to offer" and "not here yet" look alike, and the control would empty and
  // refill as each request came back.
  function settleContext() {
    if (!context || hostContext || !allLoaded()) return;

    const options = contextOptions().map((option) => String(option.value));

    if (!contextChosen || !options.includes(contextValue)) {
      contextValue = options[0] ?? "";
    }
  }

  function buildContextControl() {
    const options = contextOptions();

    if (!options.length) return "";

    return `
      <span class="row left gap-md">
        <span class="metadata">${escapeHtml(context.label)}</span>
        <span class="inline-select">
          <select class="input-select" data-role="context">
            ${options
              .map(
                (option) => `
              <option value="${escapeHtml(option.value)}" ${String(option.value) === contextValue ? "selected" : ""}>
                ${escapeHtml(option.label)}
              </option>`,
              )
              .join("")}
          </select>
        </span>
      </span>`;
  }

  function renderContext() {
    const slot = contextSlot();

    if (!context || !slot) return;

    // The host's control names it, and a second one beside it could only disagree.
    slot.innerHTML = hostContext || !allLoaded() ? "" : buildContextControl();
  }

  // ── rendering ──

  function allLoaded() {
    return selection.entries().every((entry) => entry.detail);
  }

  function panelElement(id) {
    return root.querySelector(`[data-panel='${CSS.escape(id)}']`);
  }

  function slotIn(id, name) {
    return panelElement(id)?.querySelector(`[data-slot='${name}']`);
  }

  // A fresh element per render rather than a rewritten one, so that a panel can put a
  // listener on the container it was handed — the metric select, the baseline select —
  // without every redraw leaving another one behind on a node that outlives it.
  function bodyFor(id) {
    const current = slotIn(id, "body");

    if (!current) return null;

    const next = document.createElement("div");

    next.dataset.slot = "body";
    current.replaceWith(next);

    return next;
  }

  function contextSlot() {
    return root.querySelector("[data-slot='controls']");
  }

  // One role per panel rather than one shared: the toggles are all delegated to the same
  // root, so a shared role would have each of them switching the others.
  function toggleRole(id) {
    return `comparison-${id}-view`;
  }

  function buildPanel(panel) {
    const heading = panel.title || panel.views || panel.controls;

    return `
      <div class="column gap-md" data-panel="${escapeHtml(panel.id)}">
        ${
          heading
            ? `
          <div class="row">
            ${panel.title ? `<h3 class="section-title">${escapeHtml(panel.title)}</h3>` : ""}
            <div class="row right gap-md">
              ${panel.controls ? `<span data-slot="controls"></span>` : ""}
              <div data-slot="toggle"></div>
            </div>
          </div>`
            : ""
        }
        <div data-slot="body"></div>
      </div>`;
  }

  function ensureLayout() {
    if (built) return;

    root.innerHTML = `<div class="column gap-lg">${panels.map(buildPanel).join("")}</div>`;
    built = true;
  }

  // Only where there are two ways to read: a panel with nothing in it would be a toggle
  // between two empty states.
  function renderToggle(panel, shown) {
    const bar = slotIn(panel.id, "toggle");

    if (!bar) return;

    bar.innerHTML =
      shown && panel.views
        ? buildViewToggle({
            views: panel.views,
            active: views[panel.id],
            role: toggleRole(panel.id),
          })
        : "";

    // Its own refresh: a panel redrawn on its own — a view change, a control inside it —
    // never reaches the one at the end of render().
    if (shown) refreshIcons();
  }

  function ready(panel) {
    if (loadFields && !fields) return false;

    return panel.ready === "all" ? allLoaded() : true;
  }

  function renderPanel(panel) {
    // Before the body is replaced, not after: a Tabulator whose element has gone keeps
    // answering resizes from a detached one, and a Chart.js instance on a replaced canvas
    // makes the next chart on it throw.
    disposeAll([handles[panel.id]].flat().filter(Boolean));
    handles[panel.id] = null;

    const body = bodyFor(panel.id);

    if (!body) return;

    if (!ready(panel)) {
      renderToggle(panel, false);
      showMessage(body, panel.loadingMessage ?? loadingMessage);

      return;
    }

    const shown = entries();
    const available =
      panel.available?.({ entries: shown, fields, context: contextValue }) ??
      true;

    if (available !== true) {
      renderToggle(panel, false);
      showEmpty(body, available);

      return;
    }

    renderToggle(panel, Boolean(panel.views));

    handles[panel.id] =
      panel.render({
        container: body,
        entries: shown,
        fields,
        context: contextValue,
        view: views[panel.id],
        headerFor,
        refresh,
      }) ?? null;
  }

  function headerFor(entry) {
    return buildRowHeader(entry, header);
  }

  function render() {
    if (!selection.size) {
      teardown();
      showEmpty(root, prompt);
      built = false;

      return;
    }

    ensureLayout();
    settleContext();
    renderContext();

    for (const panel of panels) renderPanel(panel);

    refreshIcons();
  }

  /**
   * Redraw one panel, for a control inside it that changed what it shows rather than what is
   * picked — the baseline a difference is measured against, the metric a plot is drawn in.
   * Handed to every render for exactly that.
   */
  function refresh(id) {
    for (const panel of panels) {
      if (id === undefined || panel.id === id) renderPanel(panel);
    }
  }

  function teardown() {
    for (const id of Object.keys(handles)) {
      disposeAll([handles[id]].flat().filter(Boolean));
      handles[id] = null;
    }
  }

  // ── events ──

  // Delegated: every panel is rewritten on every change, and the controls inside them go
  // with it.
  function onClick(event) {
    for (const panel of panels) {
      if (!panel.views) continue;

      const chosen = viewFromClick(event, toggleRole(panel.id));

      if (!chosen) continue;

      if (chosen !== views[panel.id]) {
        views[panel.id] = chosen;
        renderPanel(panel);
      }

      return;
    }

    const button = event.target.closest("[data-role='drop']");

    if (button) drop(button.dataset.key);
  }

  function onChange(event) {
    if (!event.target.closest("[data-role='context']")) return;

    contextValue = event.target.value;
    contextChosen = true;

    for (const panel of panels) renderPanel(panel);
  }

  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);

  function destroy() {
    teardown();
    listeners.clear();
    root.removeEventListener("click", onClick);
    root.removeEventListener("change", onChange);
  }

  render();

  return {
    batch,
    clear,
    destroy,
    drop,
    entries,
    keyOf,
    keySet: selection.keySet,
    keys: selection.keys,
    max,
    pick,
    refresh,
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

// ─── VIEWS ──────────────────────────────────────────────────────────────────
//
// A view is bound rather than told: it hands the controller what the reader did, and paints
// whatever the controller then holds. Nothing is handed back for the host to put right,
// which is what the overflow loops in four different pages used to be.
//
// `attach` replaces, so there is no subscription to tear down: a binding points at whatever
// is mounted now, and `attach(null)` when a view goes leaves its pushes as no-ops.

/**
 * @param comparison what to bind to.
 * @param rowIndex   (entry) => the value the table identifies its row by. The same as the
 *                   entry's key on most tables, and not on the leaderboard, where a row is a
 *                   standing and the key is the task submission inside it.
 * @param claimLinks as createFilterableTable — the row is the control while comparing, so a
 *                   click on a link in it picks the row rather than following the link and
 *                   losing the half-built comparison.
 * @returns { selection(), attach(table) }. `selection()` is the option the table factories
 *          take; `attach` is called with the instance once it has been built.
 */
function bindTable(comparison, { rowIndex = (entry) => entry.key, claimLinks = true } = {}) {
  let table = null;

  // Set while pushing the selection into the table, so the events that causes aren't read
  // back as the reader picking those rows.
  let pushing = false;

  function reconcile() {
    // getRows on a table still building throws rather than answering empty.
    if (!table?.initialized || pushing) return;

    const wanted = new Set(
      comparison.entries().map((entry) => String(rowIndex(entry))),
    );

    pushing = true;

    // Every row rather than the displayed ones: a row filtered out of sight is still picked,
    // and unticking it because the reader typed in the search box is exactly the bug this
    // whole arrangement exists to prevent.
    for (const row of table.getRows()) {
      const picked = wanted.has(String(row.getIndex()));

      if (picked === row.isSelected()) continue;

      if (picked) row.select();
      else row.deselect();
    }

    pushing = false;
  }

  comparison.subscribe(reconcile);

  function selection() {
    return {
      max: comparison.max,
      claimLinks,
      // What changed rather than what is now selected: a row filtered out of the table is
      // still in the comparison, and reading the whole selection back would drop it.
      onChange: (_data, { selected = [], deselected = [] } = {}) => {
        if (pushing) return;

        comparison.batch(() => {
          for (const row of deselected) {
            comparison.drop(comparison.keyOf(row.getData()));
          }

          for (const row of selected) comparison.pick(row.getData());
        });

        // The controller refuses a pick past its cap, so the row that was just ticked may
        // not be in the comparison. This is what takes the tick back.
        reconcile();
      },
    };
  }

  function attach(next) {
    const target = next ?? null;

    // Idempotent: a host that re-attaches the same instance — the leaderboard, on every
    // selection change — would otherwise stack a listener per call.
    if (target === table) {
      reconcile();

      return;
    }

    table = target;

    if (!table) return;

    // Tabulator builds asynchronously, so the rows to reconcile against don't exist yet when
    // the instance is handed over.
    table.on("tableBuilt", reconcile);
    reconcile();
  }

  /**
   * Run something that changes the table underneath the selection — a filter — without the
   * ticks it disturbs being read back as the reader's doing, and put them right afterwards.
   */
  function apply(mutate) {
    pushing = true;

    try {
      mutate();
    } finally {
      pushing = false;
    }

    reconcile();
  }

  // `reconcile` is public for a host that keeps its own `onChange` — the leaderboard, whose
  // one table feeds two comparisons and so cannot hand the whole handler over.
  return { apply, attach, reconcile, selection };
}

/**
 * @param comparison what to bind to.
 * @returns { selection(), attach(container) }. `selection()` is the option renderCardGrid
 *          takes; `attach` is the element it drew into.
 */
function bindCards(comparison) {
  let container = null;

  function repaint() {
    if (container) markCardSelection(container, comparison.keySet());
  }

  comparison.subscribe(repaint);

  function selection() {
    return {
      keys: comparison.keySet(),
      max: comparison.max,
      onToggle: (key, row) => comparison.toggle(row),
    };
  }

  function attach(next) {
    container = next ?? null;
    repaint();
  }

  return { attach, selection };
}

export { bindCards, bindTable, createComparison };

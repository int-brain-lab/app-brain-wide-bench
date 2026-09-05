// Several things side by side, whatever they are.
//
// Owns the detail behind each pick and when to draw. The picks themselves are picks.js, and
// what is drawn from them is the `render` its caller supplies — see recordComparison.js and
// its siblings.

import { createPicks } from "./picks.js";

/**
 * A set of picks with a record fetched for each, redrawn whenever either moves.
 *
 * @param loadDetail (pick) => the record to attach as `pick.detail`. Absent until it lands,
 *                   so every render has to expect it missing.
 * @param detailKey  (pick) => what loadDetail is cached under, across selections.
 * @param render     (picks) => void, on every change. Empty for nothing picked, which is the
 *                   caller's to say something about.
 * @param teardown   () => void, before every render.
 * @param rest       as createPicks.
 * @returns createPicks' own, plus { clearDetails, refresh }. `pick`, `toggle` and `setPicks`
 *          fetch what they take on. Nothing is drawn until the first change, so the caller
 *          draws its own empty state.
 */
function createComparison({
  loadDetail,
  detailKey = (pick) => pick.key,
  render: draw,
  teardown,
  ...rest
}) {
  const held = createPicks(rest);

  // detailKey => a promise for the detail.
  const details = new Map();

  function render() {
    teardown();
    draw(held.picks());
  }

  // ─── LOADING ───────────────────────────────────────────────────────────────

  function ensureDetail(pick) {
    if (pick.detail) return;

    const key = detailKey(pick);

    if (!details.has(key)) {
      details.set(
        key,
        Promise.resolve()
          .then(() => loadDetail(pick))
          .catch((error) => {
            console.error(error);

            // Uncached, so a later pick retries.
            details.delete(key);

            return {};
          }),
      );
    }

    details.get(key).then((detail) => {
      pick.detail = detail;

      // Identity, not the key: unticking and reticking makes a new pick.
      if (held.pickFor(pick.key) === pick) render();
    });
  }

  // Forgets what has been fetched, keeping the picks: whatever is held is asked for again.
  function clearDetails() {
    if (!details.size) return;

    details.clear();

    for (const pick of held.picks()) {
      pick.detail = undefined;
      ensureDetail(pick);
    }

    render();
  }

  // ─── PICKING ───────────────────────────────────────────────────────────────

  function pick(row) {
    const made = held.pick(row);

    if (made) ensureDetail(made);

    return Boolean(made);
  }

  function toggle(row) {
    const key = held.toKey(row);

    if (key === undefined) return false;

    return held.has(key) ? held.drop(key) : pick(row);
  }

  function setPicks(rows) {
    const changed = held.setPicks(rows);

    for (const made of held.picks()) ensureDetail(made);

    if (!changed) render();

    return changed;
  }

  function clear() {
    if (!held.clear()) render();
  }

  held.subscribe(render);

  return {
    clear,
    clearDetails,
    colourFor: held.colourFor,
    drop: held.drop,
    has: held.has,
    keySet: held.keySet,
    keys: held.keys,
    max: held.max,
    pick,
    pickFor: held.pickFor,
    picks: held.picks,
    refresh: render,
    setPicks,
    get size() {
      return held.size;
    },
    subscribe: held.subscribe,
    toggle,
    toKey: held.toKey,
  };
}

export { createComparison };

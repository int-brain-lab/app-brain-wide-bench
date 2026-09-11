// What a reader has picked, in pick order, and the colour each holds while it is held.
//
// A pick is `{ key, … }` — whatever `toPick` makes of a row. A slot is a position in the
// palette, so the same thing is the same colour wherever it is drawn.

/**
 * The picks, and the colours they hold.
 *
 * @param max     how many can be held at once. Refused past it unless `rolling`.
 * @param rolling a pick past `max` pushes the oldest out instead of being refused, for a view
 *                holding one thing at a time.
 * @param palette the colours a pick can take, one per slot. Omit for no colouring.
 * @param toPick  (row) => pick, or null for a row this cannot take.
 * @param order   (picks) => picks. Omit for pick order.
 * @returns { clear, colourFor, drop, has, keySet, keys, max, pick, pickFor, picks, setPicks,
 *          size, subscribe, toggle, toKey }. `subscribe` returns its own unsubscribe.
 */
function createPicks({
  max = Infinity,
  rolling = false,
  palette = [],
  toPick = (row) => row,
  order = null,
} = {}) {
  const picksByKey = new Map();
  const slotByKey = new Map();
  const listeners = new Set();

  // The next free slot is taken going forward from here, not from the lowest free, so a
  // colour just given up isn't handed straight to the next pick.
  let lastSlot = -1;

  // ─── SLOTS ─────────────────────────────────────────────────────────────────

  function slotFor(key) {
    return slotByKey.get(key) ?? null;
  }

  function assignSlot(key) {
    if (!palette.length || slotByKey.has(key)) return;

    const used = new Set(slotByKey.values());

    for (let step = 1; step <= palette.length; step += 1) {
      const slot = (lastSlot + step) % palette.length;

      if (used.has(slot)) continue;

      slotByKey.set(key, slot);
      lastSlot = slot;

      return;
    }
  }

  function colourFor(key) {
    const slot = slotFor(key);

    return slot == null ? null : (palette[slot] ?? null);
  }

  // ─── READING ───────────────────────────────────────────────────────────────

  function keys() {
    return [...picksByKey.keys()];
  }

  function keySet() {
    return new Set(picksByKey.keys());
  }

  function picks() {
    const held = [...picksByKey.values()];

    return order ? order(held) : held;
  }

  function pickFor(key) {
    return picksByKey.get(key);
  }

  function has(key) {
    return picksByKey.has(key);
  }

  function toKey(row) {
    return toPick(row)?.key;
  }

  function notify() {
    for (const listener of listeners) listener(keys());
  }

  function subscribe(listener) {
    listeners.add(listener);

    return () => listeners.delete(listener);
  }

  // ─── PICKING ───────────────────────────────────────────────────────────────

  function hold(pick) {
    picksByKey.set(pick.key, pick);
    assignSlot(pick.key);
  }

  function release(key) {
    picksByKey.delete(key);
    slotByKey.delete(key);
  }

  /**
   * One row picked.
   *
   * @param row
   * @returns the pick made, or null where it was refused or the row could not be picked.
   */
  function pick(row) {
    const made = toPick(row);

    if (!made || picksByKey.has(made.key)) return null;

    if (picksByKey.size >= max) {
      if (!rolling) return null;

      // Not through `drop`: the pick and the drop it made room for are one notification.
      release(keys()[0]);
    }

    hold(made);
    notify();

    return made;
  }

  function drop(key) {
    if (!picksByKey.has(key)) return false;

    release(key);
    notify();

    return true;
  }

  function toggle(row) {
    const key = toKey(row);

    if (key === undefined) return false;

    return has(key) ? drop(key) : Boolean(pick(row));
  }

  function differs(next) {
    if (next.length !== picksByKey.size) return true;

    const current = keys();

    return next.some(([key], index) => current[index] !== key);
  }

  /**
   * The whole set at once.
   *
   * @param rows every row that should now be picked. Ones `toPick` refuses are dropped, ones
   *             already held keep their slot, and the rest are appended.
   * @returns whether the set moved.
   */
  function setPicks(rows) {
    const wanted = new Map(
      rows
        .map(toPick)
        .filter(Boolean)
        .map((made) => [made.key, made]),
    );

    const kept = keys().filter((key) => wanted.has(key));
    const added = [...wanted.keys()].filter((key) => !picksByKey.has(key));

    const next = [...kept, ...added]
      .slice(0, max)
      .map((key) => [key, picksByKey.get(key) ?? wanted.get(key)]);

    if (!differs(next)) return false;

    picksByKey.clear();
    for (const [key, made] of next) picksByKey.set(key, made);

    for (const key of [...slotByKey.keys()]) {
      if (!picksByKey.has(key)) slotByKey.delete(key);
    }

    for (const key of picksByKey.keys()) assignSlot(key);

    notify();

    return true;
  }

  function clear() {
    if (!picksByKey.size) return false;

    picksByKey.clear();
    slotByKey.clear();
    lastSlot = -1;
    notify();

    return true;
  }

  return {
    clear,
    colourFor,
    drop,
    has,
    keySet,
    keys,
    max,
    pick,
    pickFor,
    picks,
    setPicks,
    get size() {
      return picksByKey.size;
    },
    subscribe,
    toggle,
    toKey,
  };
}

export { createPicks };

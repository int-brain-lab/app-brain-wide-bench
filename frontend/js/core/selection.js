// What a reader has picked, keyed on the entry key, in pick order.

/**
 * @param max      how many can be held at once. Extras are refused unless `rolling`.
 * @param slots    how many slots there are to hand out — see slotOf. 0 for none.
 * @param onChange () => void, once per mutation that changed the set.
 * @param rolling  a pick past the cap pushes the oldest out instead of being refused. For a
 *                 view holding one thing at a time, where clicking another plainly means
 *                 "that one"; a comparison refuses instead, so a pick stays until it is
 *                 dropped.
 */
function createSelection({
  max = Infinity,
  slots = 0,
  onChange = () => {},
  rolling = false,
} = {}) {
  const held = new Map();

  // key => slot, for as long as the entry is held.
  const places = new Map();

  // The slot handed out last. A new one takes the next free slot going forward from here,
  // rather than the lowest free: dropping one and picking another then hands the new pick a
  // slot of its own instead of the one that has just been given up.
  let cursor = -1;

  function slotOf(key) {
    return places.get(key) ?? null;
  }

  function takeSlot(key) {
    if (!slots || places.has(key)) return;

    const used = new Set(places.values());

    for (let step = 1; step <= slots; step += 1) {
      const slot = (cursor + step) % slots;

      if (used.has(slot)) continue;

      places.set(key, slot);
      cursor = slot;

      return;
    }
  }

  function has(key) {
    return held.has(key);
  }

  function keys() {
    return [...held.keys()];
  }

  function keySet() {
    return new Set(held.keys());
  }

  function entries() {
    return [...held.values()];
  }

  function get(key) {
    return held.get(key);
  }

  function add(entry) {
    if (held.has(entry.key)) return false;

    if (held.size >= max) {
      if (!rolling) return false;

      // Evicted here rather than through `remove`, so the pick and the drop it made room for
      // are one mutation and one render. Its slot goes with it, which is what lets the
      // incoming entry take it.
      const oldest = keys()[0];

      held.delete(oldest);
      places.delete(oldest);
    }

    held.set(entry.key, entry);
    takeSlot(entry.key);
    onChange();

    return true;
  }

  function remove(key) {
    if (!held.delete(key)) return false;

    places.delete(key);
    onChange();

    return true;
  }

  function toggle(entry) {
    return held.has(entry.key) ? remove(entry.key) : add(entry);
  }

  /**
   * Set the whole selection at once. Entries already held keep their places; new ones are
   * appended.
   *
   * @param incoming every entry that should now be held.
   */
  function replace(incoming) {
    const wanted = new Map(incoming.map((entry) => [entry.key, entry]));

    const kept = keys().filter((key) => wanted.has(key));
    const added = [...wanted.keys()].filter((key) => !held.has(key));

    const next = [...kept, ...added]
      .slice(0, max)
      .map((key) => [key, held.get(key) ?? wanted.get(key)]);

    if (!changed(next)) return false;

    held.clear();
    for (const [key, entry] of next) held.set(key, entry);

    for (const key of [...places.keys()]) {
      if (!held.has(key)) places.delete(key);
    }

    for (const key of held.keys()) takeSlot(key);

    onChange();

    return true;
  }

  function changed(next) {
    if (next.length !== held.size) return true;

    const current = keys();

    return next.some(([key], index) => current[index] !== key);
  }

  function clear() {
    if (!held.size) return false;

    held.clear();
    places.clear();
    cursor = -1;
    onChange();

    return true;
  }

  return {
    add,
    clear,
    entries,
    get,
    has,
    keySet,
    keys,
    max,
    remove,
    replace,
    slotOf,
    get size() {
      return held.size;
    },
    toggle,
  };
}

export { createSelection };

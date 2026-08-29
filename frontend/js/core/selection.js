// What a reader has picked, keyed on the entry key, in pick order.

/**
 * @param max      how many can be held at once. Extras are refused, not swapped in.
 * @param onChange () => void, once per mutation that changed the set.
 */
function createSelection({ max = Infinity, onChange = () => {} } = {}) {
  const held = new Map();

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
    if (held.has(entry.key) || held.size >= max) return false;

    held.set(entry.key, entry);
    onChange();

    return true;
  }

  function remove(key) {
    if (!held.delete(key)) return false;

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
    get size() {
      return held.size;
    },
    toggle,
  };
}

export { createSelection };

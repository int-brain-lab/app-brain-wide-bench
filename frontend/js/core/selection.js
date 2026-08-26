// What a reader has picked, in the order they picked it.
//
// A Map rather than a Set because each pick carries something with it — the entry a
// comparison was given, not just its key — and because insertion order is part of the
// answer: the first thing picked leads the comparison, which is what makes it the reference
// on the models list and on the compare page.
//
// The cap is enforced here rather than by whatever is on screen. That is the whole point of
// the store: a picked row can be filtered out of a table, or be on another page of the
// cards, or be in a table that has since been destroyed and rebuilt — so what is picked
// cannot be read back off the view, and the view has to reconcile to this instead.

/**
 * @param max      how many can be held at once. Extras are refused, not swapped in: quietly
 *                 dropping someone's first pick to make room for their sixth is worse than
 *                 doing nothing.
 * @param onChange () => void, once per mutation that actually changed the set. A no-op
 *                 mutation — re-adding what is already held, removing what isn't — is
 *                 silent, so a view reconciling in response can't loop.
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
   * Set the whole selection at once, for a view that reports what it has rather than what
   * just changed — a table handing back every selected row.
   *
   * The order held wins over the order given: a table reports its rows in its own order,
   * which sorting or filtering can change under a reader who has picked nothing new. So
   * entries already held keep their places and only the genuinely new ones are appended.
   */
  function replace(incoming) {
    const wanted = new Map(incoming.map((entry) => [entry.key, entry]));

    const kept = keys().filter((key) => wanted.has(key));
    const added = [...wanted.keys()].filter((key) => !held.has(key));

    const next = [...kept, ...added]
      .slice(0, max)
      .map((key) => [key, held.get(key) ?? wanted.get(key)]);

    // Compared before writing, so a table re-reporting the same rows after a sort doesn't
    // notify anything or, through a listener that reconciles, start a loop.
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

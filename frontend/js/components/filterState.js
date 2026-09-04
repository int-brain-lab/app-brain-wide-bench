// The values behind a set of filter controls already in the DOM, and the predicate they add
// up to.
//
// A control's `type` names its kind, and the kind owns everything that varies by shape: the
// value at rest, how it is read off the DOM, how two values compare, which events move it,
// and how it is carried in the URL. A control itself is data — a name, its options, and a
// `match` against one value.

import { refreshIcons } from "../core/render.js";
import { UNPIN, pinFromEvent, pinnedIn } from "./filters.js";
import { RANGE, markRange, rangeFromEvent, rangeIn } from "./ranges.js";

// ─── KINDS ───────────────────────────────────────────────────────────────────

const HOOK = "filter";

function hookOf(control) {
  return control.hook ?? HOOK;
}

function elementIn(root, control) {
  return root.querySelector(
    `[data-${hookOf(control)}="${CSS.escape(control.name)}"]`,
  );
}

// A select and a search hold one string and differ only in their markup. `input`, not
// `change`: a text input fires `change` on blur.
const TEXT_KIND = {
  events: ["input"],
  empty: () => "",
  read: (root, control) => elementIn(root, control)?.value ?? "",
  key: (value) => value.trim(),
  match: (control, row, value) => control.match(row, value.trim()),
};

const KINDS = {
  search: TEXT_KIND,
  select: TEXT_KIND,

  // Any of what is pinned: the kind lifts the control's own one-value matcher over the set,
  // so `matchEquals("suite")` backs a select and a pinned select alike.
  pinned: {
    events: ["change", "click"],
    empty: () => [],
    read: (root, control) => pinnedIn(root, control.name),
    key: (values) => values.join(","),
    match: (control, row, values) =>
      values.some((value) => control.match(row, value)),
    changed: (event, root, control) => {
      if (!pinFromEvent(event, root, hookOf(control))) return false;

      refreshIcons();

      return true;
    },
    fromUrl: (params, control) => {
      const known = control.options.map((option) => String(option.value));

      return (params.get(control.name) ?? "")
        .split(",")
        .filter((value) => known.includes(value));
    },
    toUrl: (params, control, values) => {
      if (values?.length) params.set(control.name, values.join(","));
      else params.delete(control.name);
    },
  },

  range: {
    events: ["input"],
    empty: () => null,
    read: (root, control) => rangeIn(root, control.name),
    key: (value) => `${value.min}-${value.max}`,
    match: (control, row, value) => control.match(row, value),
    changed: (event, root, control) => {
      if (!rangeFromEvent(event)) return false;

      markRange(root, control.name, control.format);

      return true;
    },
    mark: (root, control) => markRange(root, control.name, control.format),

    // Both bounds or neither. A thumb is always somewhere, so a link carrying half a pair
    // is read as no filter; bounds outside the span the control offers have no thumb
    // position and are refused the same way.
    fromUrl: (params, control) => {
      const written = [
        params.get(`${control.name}_min`),
        params.get(`${control.name}_max`),
      ];

      if (written.some((bound) => bound == null || bound === "")) return null;

      const [from, to] = written.map(Number);

      const known = (bound) =>
        Number.isFinite(bound) &&
        bound >= control.range.min &&
        bound <= control.range.max;

      if (!known(from) || !known(to) || from > to) return null;

      return { min: from, max: to };
    },
    toUrl: (params, control, value) => {
      for (const [suffix, bound] of [
        ["min", value?.min],
        ["max", value?.max],
      ]) {
        if (bound == null) params.delete(`${control.name}_${suffix}`);
        else params.set(`${control.name}_${suffix}`, String(bound));
      }
    },
  },
};

function kindOf(control) {
  return KINDS[control.type];
}

function isEmpty(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.trim() === "";

  return false;
}

// ─── STATE ───────────────────────────────────────────────────────────────────

/**
 * The values behind controls already rendered into `root`.
 *
 * @param controls [{type, name, match, options, hook, format, range}]. `type` is the kind —
 *                 "search", "select", "pinned" or "range". `name` keys the state and finds
 *                 the control in `root`. `match(row, value)` decides a row against one
 *                 value; omit for a filter applied by the server, which leaves `matches`
 *                 ignoring it.
 * @param root     the element the controls were rendered into. The listeners are delegated
 *                 to it, so the controls can be rewritten under it.
 * @param onChange (name, value) => void, after a control moved and the state was updated.
 *                 Acting on the new values is the caller's: a table refilters, a board waits
 *                 for its button.
 *
 * @returns {matches, read, empty, same, mark, readUrl, writeUrl}. `readUrl` and `writeUrl`
 *          carry the pinned and range controls only.
 */
function createFilterState({ controls, root, onChange }) {
  const byName = new Map(controls.map((control) => [control.name, control]));
  const hooks = [...new Set(controls.map(hookOf))];

  const values = {};

  // Off the DOM rather than from the descriptors: the markup is the state, and a select
  // with no blank option already shows its first choice.
  function read() {
    for (const control of controls) {
      values[control.name] = kindOf(control).read(root, control);
    }

    return { ...values };
  }

  function empty() {
    return Object.fromEntries(
      controls.map((control) => [control.name, kindOf(control).empty()]),
    );
  }

  function keyOf(control, value) {
    return isEmpty(value) ? "" : kindOf(control).key(value);
  }

  function same(left, right) {
    return controls.every(
      (control) =>
        keyOf(control, left[control.name]) ===
        keyOf(control, right[control.name]),
    );
  }

  // An empty control doesn't narrow: "All suites" means every row, not `suite === ""`.
  function matches(row) {
    return controls.every((control) => {
      const value = values[control.name];

      if (isEmpty(value) || !control.match) return true;

      return kindOf(control).match(control, row, value);
    });
  }

  // What each control reads as, and anything else the markup carries but doesn't hold — a
  // range's readout and the band between its thumbs. After every render.
  function mark() {
    for (const control of controls) {
      kindOf(control).mark?.(root, control);
    }
  }

  function readUrl(search = location.search) {
    const params = new URLSearchParams(search);

    return Object.fromEntries(
      controls.map((control) => {
        const kind = kindOf(control);

        return [
          control.name,
          kind.fromUrl ? kind.fromUrl(params, control) : kind.empty(),
        ];
      }),
    );
  }

  // replaceState: working a filter shouldn't build a stack of history entries.
  function writeUrl(next) {
    const url = new URL(location.href);

    for (const control of controls) {
      kindOf(control).toUrl?.(url.searchParams, control, next[control.name]);
    }

    history.replaceState(null, "", url);
  }

  // ─── EVENTS ────────────────────────────────────────────────────────────────

  // By name and then by kind, never by kind alone: a pinned select is also a
  // `select[data-filter]`, whose value is "" the moment its pick became a chip.
  function controlFor(event) {
    const target = event.target;

    if (!target?.closest) return null;

    const unpin = target.closest(`[data-${UNPIN}]`);

    if (unpin) return byName.get(unpin.dataset[UNPIN]) ?? null;

    const range = target.closest(`[data-${RANGE}]`);

    if (range) return byName.get(range.dataset[RANGE]) ?? null;

    for (const hook of hooks) {
      const element = target.closest(`[data-${hook}]`);

      if (element) return byName.get(element.dataset[hook]) ?? null;
    }

    return null;
  }

  function handle(event) {
    const control = controlFor(event);

    if (!control) return;

    const kind = kindOf(control);

    if (!kind.events.includes(event.type)) return;
    if (kind.changed && !kind.changed(event, root, control)) return;

    values[control.name] = kind.read(root, control);

    onChange?.(control.name, values[control.name]);
  }

  for (const type of ["input", "change", "click"]) {
    root.addEventListener(type, handle);
  }

  read();

  return { matches, read, empty, same, mark, readUrl, writeUrl };
}

export { createFilterState };

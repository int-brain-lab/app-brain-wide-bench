// A pair of bounds over one span: two thumbs on one track, and the band between them is what
// is being asked for.
//
// The inputs work in *positions* rather than in values, and the value is derived from the
// position — which is what lets one widget carry a linear span and a logarithmic one. A
// parameter count runs from a thousand to two hundred billion, where a linear step is either
// invisible at the bottom or a hundred million at the top; on a log track a step is a constant
// *factor*, so the thumb moves the way a reader expects at both ends.
//
// No state of its own, like the controls in components/filters.js: the thumbs are the state,
// and `rangeIn` reads them back off whatever element the caller put them in. So a caller
// listening on a persistent ancestor can rebuild the control under it whenever it likes, and
// there is no second copy of what is asked for to disagree with what is on screen.
//
// The same three calls as those — build it, mark it, read a change off an event — because a
// caller wiring one should not have to learn a second shape. `markRange` is what writes the
// readout and the band, and it takes the format: how a bound reads is the domain's ("200B",
// "2.5 s"), and a function cannot live in a data attribute.

import { escapeHtml } from "../core/html.js";

// The pair's name, on the wrapper and on both of its inputs.
const RANGE = "range";

// Which thumb an input is.
const BOUND = "bound";
const LOW = "low";
const HIGH = "high";

// How many positions a track has where the caller names no step. Enough that a thumb moves
// smoothly and few enough that the value it lands on is a round-ish number.
const STEPS = 100;

// ─── SCALE ───────────────────────────────────────────────────────────────────

// A span as the wrapper carries it. Read back off the DOM rather than held, so `rangeIn` needs
// nothing from the caller but the name.
function specOf(wrapper) {
  return {
    min: Number(wrapper.dataset.min),
    max: Number(wrapper.dataset.max),
    steps: Number(wrapper.dataset.steps),
    log: wrapper.dataset.scale === "log",
    decimals: Number(wrapper.dataset.decimals ?? 0),
  };
}

// Three significant figures for a log span: the value at a position is a fraction of a decade
// and comes out as 1023.74, where what the reader moved the thumb to is "about a thousand".
function significant(value) {
  return Number(value.toPrecision(3));
}

// What a position means. Geometric on a log span — a constant factor per step — and linear
// otherwise, rounded to the decimals the caller's own step needs so a bound reads as the
// number the reader stopped on rather than as floating-point noise.
function valueAt(spec, position) {
  const fraction = position / spec.steps;

  if (spec.log) {
    return significant(spec.min * (spec.max / spec.min) ** fraction);
  }

  const value = spec.min + (spec.max - spec.min) * fraction;

  return Number(value.toFixed(spec.decimals));
}

// The nearest position to a value — how a bound the caller starts with, or one restored from a
// URL, finds its thumb. Clamped, because a stale bound may be outside the span the widget now
// carries.
function positionAt(spec, value) {
  const fraction = spec.log
    ? Math.log(value / spec.min) / Math.log(spec.max / spec.min)
    : (value - spec.min) / (spec.max - spec.min);

  if (!Number.isFinite(fraction)) return null;

  return Math.round(Math.min(1, Math.max(0, fraction)) * spec.steps);
}

// ─── BUILD ───────────────────────────────────────────────────────────────────

function buildInput(name, bound, steps, position) {
  return `
    <input
      class="range-input"
      type="range"
      data-${RANGE}="${escapeHtml(name)}"
      data-${BOUND}="${bound}"
      min="0"
      max="${steps}"
      step="1"
      value="${position}"
      aria-label="${bound === LOW ? "Lowest" : "Highest"} ${escapeHtml(name)}">`;
}

/**
 * One pair of bounds: a label, what the pair currently reads as, and the track.
 *
 * @param name     what a listener finds it by, on the wrapper and on both inputs.
 * @param label    what the pair is called, above it.
 * @param min      the bottom of the span. Must be above zero on a log scale, which has no
 *                 position for it.
 * @param max      the top of the span.
 * @param scale    "log" for a span whose steps are factors, anything else for one whose steps
 *                 are amounts.
 * @param step     the smallest difference a linear thumb can land on. Ignored on a log span,
 *                 which divides the whole range into `steps` factors instead.
 * @param steps    how many positions a log track has.
 * @param decimals how many places a linear bound is written to. Derived from `step` where the
 *                 caller leaves it out, since a step of 0.5 wants one and a step of 1 none.
 * @param value    `{ min, max }` to open at, or null for the whole span — which is what a
 *                 caller reads back as "don't narrow".
 * @returns the markup. `markRange` fills in the readout and the band.
 */
function buildRange({
  name,
  label = "",
  min,
  max,
  scale = "linear",
  step = null,
  steps = STEPS,
  decimals = null,
  value = null,
}) {
  const log = scale === "log";

  // A linear track's positions are its steps, so a thumb can only land on a multiple of one.
  const places = log ? 0 : (decimals ?? decimalsIn(step));
  const count = log || !step ? steps : Math.max(1, Math.round((max - min) / step));

  const spec = { min, max, steps: count, log, decimals: places };

  const low = value?.min == null ? 0 : (positionAt(spec, value.min) ?? 0);
  const high = value?.max == null ? count : (positionAt(spec, value.max) ?? count);

  return `
    <div
      class="column gap-sm"
      data-${RANGE}="${escapeHtml(name)}"
      data-min="${min}"
      data-max="${max}"
      data-steps="${count}"
      data-scale="${log ? "log" : "linear"}"
      data-decimals="${places}"
    >
      <span class="row left gap-sm">
        ${label ? `<span class="metadata">${escapeHtml(label)}</span>` : ""}
        <output class="metadata range-readout"></output>
      </span>
      <span class="range">
        <span class="range-track"><span class="range-band"></span></span>
        ${buildInput(name, LOW, count, low)}
        ${buildInput(name, HIGH, count, high)}
      </span>
    </div>`;
}

// How many places a step needs written out: 0.5 wants one, 1 wants none. Off the number rather
// than asked for, so a caller states the step once.
function decimalsIn(step) {
  if (!step) return 0;

  const written = String(step);
  const at = written.indexOf(".");

  return at < 0 ? 0 : written.length - at - 1;
}

// ─── READ ────────────────────────────────────────────────────────────────────

function wrapperIn(root, name) {
  return root.querySelector(`div[data-${RANGE}="${CSS.escape(name)}"]`);
}

function inputsIn(wrapper) {
  return {
    low: wrapper.querySelector(`input[data-${BOUND}="${LOW}"]`),
    high: wrapper.querySelector(`input[data-${BOUND}="${HIGH}"]`),
  };
}

/**
 * The bounds the thumbs are at, or null for a pair still at both ends.
 *
 * Null rather than the span itself, because "the whole of it" is not a filter: a caller reads
 * it the way it reads an empty set of chips, and leaves the parameter out.
 */
function rangeIn(root, name) {
  const wrapper = wrapperIn(root, name);

  if (!wrapper) return null;

  const spec = specOf(wrapper);
  const { low, high } = inputsIn(wrapper);

  const from = Number(low.value);
  const to = Number(high.value);

  if (from <= 0 && to >= spec.steps) return null;

  return { min: valueAt(spec, from), max: valueAt(spec, to) };
}

/**
 * Write what the pair now reads as, and draw the band between its thumbs.
 *
 * @param format (value) => how a bound reads. The domain's: a parameter count is "200B" and a
 *               window is "2.5 s", and neither is something this module can know.
 */
function markRange(root, name, format = (value) => String(value)) {
  const wrapper = wrapperIn(root, name);

  if (!wrapper) return;

  const spec = specOf(wrapper);
  const { low, high } = inputsIn(wrapper);

  const from = Number(low.value);
  const to = Number(high.value);

  const readout = wrapper.querySelector(".range-readout");

  if (readout) {
    readout.textContent = `${format(valueAt(spec, from))} – ${format(valueAt(spec, to))}`;
  }

  const band = wrapper.querySelector(".range-band");

  if (band) {
    band.style.left = `${(from / spec.steps) * 100}%`;
    band.style.width = `${((to - from) / spec.steps) * 100}%`;
  }
}

/**
 * Which pair a change just moved, having first stopped its thumbs crossing.
 *
 * The thumb being dragged pushes the other rather than passing it, so the band never inverts
 * and a reader never has to work out which of the two they are now holding.
 *
 * @returns { name }, or null for an event that wasn't a range's.
 */
function rangeFromEvent(event) {
  const input = event.target?.closest?.(`input[data-${RANGE}]`);

  if (!input) return null;

  const wrapper = input.closest(`div[data-${RANGE}]`);
  const { low, high } = inputsIn(wrapper);

  if (Number(low.value) > Number(high.value)) {
    const pushed = input.dataset[BOUND] === LOW ? high : low;

    pushed.value = input.value;
  }

  return { name: input.dataset[RANGE] };
}

export { RANGE, buildRange, markRange, rangeFromEvent, rangeIn };

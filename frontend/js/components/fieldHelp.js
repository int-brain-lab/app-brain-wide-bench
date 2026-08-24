// Where a field's help popover goes, so that it is always fully on screen.
//
// The popover is `position: fixed` and placed from here rather than being offset from the
// trigger in CSS. Fixed because the alternative is being clipped: it sits inside a `.card`
// and inside `.content`, both of which hide their overflow, and `.content`'s is load-bearing
// — it is what lets the page's inner region scroll instead of growing. A fixed box is
// positioned against the viewport and cropped by neither.
//
// Placed from here because "always visible" is a question about measurements, which CSS
// can't ask: how wide the text turned out, where the trigger currently is, how much room is
// left beside it.
//
// Visibility itself is still CSS (`:hover`, `:focus-visible`) — this only ever writes
// coordinates, so a popover cannot get stuck open if a listener misses.

// Between the trigger and the box, and between the box and the edge of the viewport.
const GAP = 8;
const MARGIN = 8;

// Which trigger is currently showing, so a scroll or a resize under a held hover can move
// its box rather than leaving it behind: wheel-scrolling doesn't move the pointer, so
// `:hover` — and the popover with it — survives a scroll that has moved the field.
let active = null;

let installed = false;


function clamp(value, min, max) {
  // `max` before `min` so a box wider than the viewport pins to the left edge and overflows
  // right, rather than the other way about.
  return Math.max(min, Math.min(value, max));
}


function place(trigger) {
  const box = trigger.nextElementSibling;

  if (!box?.classList?.contains("field-help-text")) return;

  const anchor = trigger.getBoundingClientRect();

  // Readable while hidden: the box is `visibility: hidden`, not `display: none`, so it has
  // real dimensions to measure before anything is shown. Its width doesn't depend on where
  // it is placed — `max-width` is in rem and vw — so a previous placement can't skew this.
  const { width, height } = box.getBoundingClientRect();

  // Opens away from the nearer side of the viewport, so the long edge has the room: a
  // trigger in the left half anchors the box's top-left to the trigger's top-right, and one
  // in the right half anchors its top-right to the trigger's top-left.
  const opensRight = anchor.left + anchor.width / 2 < window.innerWidth / 2;

  const left = opensRight ? anchor.right + GAP : anchor.left - width - GAP;

  // Top-aligned with the trigger, then clamped, which is also what flips a box near the
  // bottom of a tall page up into view instead of off the end of it.
  box.style.left = `${clamp(left, MARGIN, window.innerWidth - width - MARGIN)}px`;
  box.style.top = `${clamp(anchor.top, MARGIN, window.innerHeight - height - MARGIN)}px`;
}


function show(event) {
  const trigger = event.target?.closest?.(".field-help-trigger");

  if (!trigger) return;

  active = trigger;
  place(trigger);
}


function hide(event) {
  if (event.target?.closest?.(".field-help-trigger") === active) {
    active = null;
  }
}


/**
 * Install the listeners, once per page.
 *
 * Delegated on `document` rather than attached per trigger, because the fields are
 * re-rendered — a task form redraws all of them whenever one invalidates another — and a
 * listener per "?" would have to be reattached every time.
 *
 * `pointerover` and `focusin` rather than the enter/blur pair: those don't bubble, so they
 * can't be delegated. Positioning on the same event that brings `:hover` on means the
 * coordinates are written before the next paint, so there is no frame at a stale position.
 */
function installFieldHelp() {
  if (installed) return;

  installed = true;

  document.addEventListener("pointerover", show);
  document.addEventListener("focusin", show);
  document.addEventListener("pointerout", hide);
  document.addEventListener("focusout", hide);

  // Capture, because a scroll on an inner region doesn't bubble to the window.
  window.addEventListener("scroll", () => active && place(active), { capture: true, passive: true });
  window.addEventListener("resize", () => active && place(active));
}


export { installFieldHelp };

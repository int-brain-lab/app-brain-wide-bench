// Record links, and the hint one carries about whose record it is.
//
// A record page is one URL for both audiences: its markup paints the public shell, and
// templates/page.js swaps in the sidebar once the record comes back saying it is the
// reader's own. That answer takes a round trip, so a page that already knows — a listing
// marking its own rows, a create form redirecting to what it just made — says so in the
// link, and the shell is right in the first frame.
//
// A hint, not an authority: the API decides what a reader may see and do, and the loaded
// record corrects a hint that turns out to be wrong. It is only read for a signed-in
// reader — see templates/page.js — since nothing is anyone's own without one.

const MINE_PARAM = "mine";

/**
 * Where a record lives.
 *
 * @param page the record page — "/html/models/models.html".
 * @param id   the record's id.
 * @param mine true where the reader's own team owns it. Omit where the caller cannot say.
 *
 * @returns the href. Further params can be appended: it always carries `id` first.
 */
function hrefForRecord(page, id, { mine = false } = {}) {
  const hint = mine ? `&${MINE_PARAM}=1` : "";

  return `${page}?id=${encodeURIComponent(id)}${hint}`;
}

// Whether this page was reached as one of the reader's own.
function readMineHint() {
  return new URLSearchParams(location.search).get(MINE_PARAM) === "1";
}

export { hrefForRecord, MINE_PARAM, readMineHint };

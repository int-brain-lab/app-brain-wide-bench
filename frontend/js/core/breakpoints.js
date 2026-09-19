// The widths more than one component answers to, named once.
//
// A component with a width of its own declares it there — the landing's tabs, the members
// table, the task panel. These three carry the shape of the whole app, and style.css names
// them again as `--bp-chrome`, `--bp-cards` and `--bp-phone`: a custom property cannot be
// used in a media condition, so those are there to be read rather than resolved.

// Both navs fold into one drawer, the board's controls stack, and a comparison stops being
// two columns.
const CHROME_QUERY = "(max-width: 1200px)";

// A table of a record's fields stops fitting across the page, and a list or a section shows
// its cards in place of it.
const CARDS_QUERY = "(max-width: 800px)";

// A phone: one column of whatever was a row, and the chrome at a thumb's measurements.
const PHONE_QUERY = "(max-width: 600px)";

export { CARDS_QUERY, CHROME_QUERY, PHONE_QUERY };

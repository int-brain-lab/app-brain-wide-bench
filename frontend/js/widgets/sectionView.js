// A section's content in the shape the width allows: its table above CARDS_QUERY, its cards
// below it.
//
// For a section that draws a fixed table straight into its body, where there is no toggle to
// carry the choice — see templates/listView.js, which does this for a list that has one.

import { CARDS_QUERY } from "../core/breakpoints.js";

// One teardown per section, so a view rendered twice does not leave the first still listening.
const attached = new Map();

/**
 * Draw a section now, and again whenever the width crosses the query.
 *
 * @param id     the section's, which is also what a second call replaces.
 * @param render (content) => void — how the page writes that section, footer and all.
 * @param table  () => the table markup.
 * @param cards  () => the card markup.
 * @param query  the width below which the cards are drawn. Omit for CARDS_QUERY, which is
 *               where a table of a record's fields stops fitting.
 */
function attachSectionView(id, { render, table, cards, query = CARDS_QUERY }) {
  attached.get(id)?.();

  const media = matchMedia(query);
  const draw = () => render(media.matches ? cards() : table());

  media.addEventListener("change", draw);
  attached.set(id, () => media.removeEventListener("change", draw));

  draw();
}

export { attachSectionView };

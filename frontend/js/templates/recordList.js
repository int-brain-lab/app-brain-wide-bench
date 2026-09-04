// A record-page view containing a list.
//
// createListView owns the list itself — filtering, cards/table modes and the list controls.
// This module only provides the record-page shell and mounts the list into its section.

import { buildEmptyMessage } from "../components/messages.js";
import {
  buildHeader,
  buildPage,
  buildSection,
  getSectionBody,
} from "../components/sections.js";
import { refreshIcons, renderHtml } from "../core/render.js";
import { createListView } from "./listView.js";
import { renderPage } from "./pageChrome.js";

/**
 * A record-page view holding one list, in its own section.
 *
 * @param noun        *singular* — "submission". Names the section.
 * @param back        the back link — `{ text, view }`, or `{ text, href }` to leave the
 *                    page. Omit for no back link.
 * @param renderTitle (record?) => void. Writes the page header.
 * @param empty       what the section says when there are no rows.
 * @param rows        every row, already mapped into the shape createListView takes.
 * @param ...list     everything else — `createCards`, `createTable`, `filterControls`,
 *                    `modes`, `picking`, `maxCards` — is createListView's, and is spread
 *                    through rather than named, so an option added there needs no edit here.
 *
 * @returns the list view, or null when there are no rows.
 */
function renderRecordListView({
  noun,
  back,
  renderTitle,
  empty,
  rows,
  ...list
}) {
  renderPage(
    buildPage({
      back,
      header: buildHeader(),
      body: buildSection({ id: noun }),
    }),
  );

  renderTitle();

  const sectionBody = getSectionBody(noun);

  if (!rows.length) {
    renderHtml(sectionBody, buildEmptyMessage(empty));
    return null;
  }

  const listView = createListView({
    container: sectionBody,
    rows,
    ...list,
  });

  refreshIcons();

  return listView;
}

export { renderRecordListView };

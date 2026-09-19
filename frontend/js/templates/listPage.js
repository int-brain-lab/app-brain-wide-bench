// Template for pages whose main content is a list.
//
// This owns the page shell, loading, heading, create action and empty state.
// listView.js owns the actual list behaviour — cards, table, filtering and selection —
// and can therefore be mounted here or inside a record page.

import { PHONE_QUERY } from "../core/breakpoints.js";
import { buildCreateCard } from "../cards/createCard.js";
import { getElement, refreshIcons } from "../core/render.js";
import { pluralise } from "../core/utils.js";
import { buildMessageCard } from "../components/messages.js";
import { loadPage } from "./page.js";
import { createListView } from "./listView.js";
import { renderHeader, renderPage } from "./pageChrome.js";
import { buildHeader, buildPage } from "../components/sections.js";
import { buildCreateButton, CREATE_BUTTON_ID } from "../components/buttons.js";

const LIST_ID = "list";

// Where it moves to — see buildCompareControls in listView.js.
const TOOLBAR_ROW = ".list-toolbar > .row.right";

// ─── LIST PAGE ───────────────────────────────────────────────────────────────

/**
 * A list page in its two views, cards and a table, over one set of rows and one filter bar.
 *
 * @param noun           *singular* — "model". The empty states say the plural; the create
 *                       card, the create button and loadPage's messages say it as given.
 * @param title          page heading.
 * @param description    page subheading.
 * @param requiresAuth   the page is for a signed-in viewer only.
 * @param getRecords     () => the API records.
 * @param recordsToRows  (records) => rows, in the one shape both views take.
 * @param cardsQuery     the width below which the cards are the only view — see
 *                       createListView. Omit for the shared CARDS_QUERY.
 * @param createCards    () => a card grid — see cards/cardGrid.js. Omit for a table-only
 *                       list.
 * @param createTable    ({ rows, selection }) => { element, table } — see tables/table.js.
 * @param createLink     href for the create action. Omit for no create button.
 * @param filterControls (rows) => controls for the bar — see components/filters.js. Omit
 *                       for no filter bar.
 * @param panel          the comparison drawn from the list's picks — see createListView.
 *                       Omit for a list whose rows open nothing beside them.
 * @param picking        `{ max, label, toPick, onCompare }` for a list whose rows are picked
 *                       and then acted on elsewhere — see createListView, which this is
 *                       passed straight through to.
 * @param maxCards       rows at or below which the page opens on the cards rather than the
 *                       table.
 *
 * @returns loadPage's promise, settled once the page has rendered or reported its failure.
 */
function loadListPage({
  noun,
  title,
  description = "",
  requiresAuth = true,

  getRecords,
  recordsToRows,

  createCards,
  createTable,
  cardsQuery,

  createLink = null,
  filterControls = null,
  panel = null,
  picking = null,

  maxCards = 6,
}) {
  let rows = [];

  const createEnabled = requiresAuth && createLink;

  // ─── MARKUP ────────────────────────────────────────────────────────────────

  function buildEmptyState() {
    if (createEnabled) {
      return buildCreateCard({
        href: createLink,
        label: `You don't have any ${pluralise(noun)} yet. Create your first ${noun}`,
      });
    }

    return buildMessageCard(`No public ${pluralise(noun)} yet`, "empty-msg");
  }

  function buildBody() {
    if (!rows.length) {
      return `
        <div class="column gap-lg">
          ${buildEmptyState()}
        </div>
      `;
    }

    return `<div id="${LIST_ID}"></div>`;
  }

  function buildHeaderButtons() {
    if (!createEnabled) return [];

    return [
      buildCreateButton({
        href: createLink,
        noun,
      }),
    ];
  }

  // ─── PLACEMENT ─────────────────────────────────────────────────────────────

  /**
   * Put the create button where the width says: the list's toolbar on a phone, the page header
   * at every other width.
   *
   * Moved rather than drawn twice, as the account controls are — see placeAccount in
   * nav/navDrawer.js. A list with nothing to compare has no toolbar row, and keeps its header
   * button at every width.
   */
  function attachCreatePlacement() {
    const button = getElement(CREATE_BUTTON_ID);

    if (!button) return;

    // Read before the first move loses it.
    const header = button.parentElement;
    const media = matchMedia(PHONE_QUERY);

    function place() {
      const toolbar = document.querySelector(TOOLBAR_ROW);

      (media.matches && toolbar ? toolbar : header).appendChild(button);
    }

    media.addEventListener("change", place);
    place();
  }

  // ─── PAGE BOOTSTRAP ────────────────────────────────────────────────────────

  return loadPage({
    noun,
    requiresId: false,
    requiresAuth,

    load: getRecords,

    render(records) {
      rows = recordsToRows(records);

      renderPage(
        buildPage({
          header: buildHeader(buildHeaderButtons()),
          body: buildBody(),
        }),
      );

      renderHeader(title, description);
      refreshIcons();

      if (!rows.length) return;

      createListView({
        container: getElement(LIST_ID),
        rows,
        noun,
        createCards,
        createTable,
        cardsQuery,
        filterControls,
        panel,
        picking,
        maxCards,
      });

      // After the list: the row it may move into is the list's own markup.
      attachCreatePlacement();

      refreshIcons();
    },
  });
}

export { loadListPage };

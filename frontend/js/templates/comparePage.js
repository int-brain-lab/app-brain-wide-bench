// Template for the compare pages: a handful of records read against each other.
//
// Owns the page shell, the URL the set is carried in, the select that puts one more in, and
// the empty state. The reading itself is the record comparison in whichever preset the caller
// passes — see comparisons/recordComparison.js — which holds what is picked and whose own
// chips take one back out.
//
// A single view, so it boots through loadPage rather than loadRecordPage: there is no second
// screen to route to, and the state that does vary belongs in the URL as a comparison anyone
// can send to someone else, not as a stack of history entries left behind by working the
// controls.

import { getElement, renderHtml } from "../core/render.js";
import { pluralise } from "../core/utils.js";
import { buildSelect } from "../components/filters.js";
import { buildEmptyMessage } from "../components/messages.js";
import {
  attachCollapse,
  buildHeader,
  buildPage,
  buildSection,
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";
import { loadPage } from "./page.js";
import { CONTAINER_ID, renderHeader, renderPage } from "./pageChrome.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// `with` rather than the noun: it reads as the sentence the URL is making.
const WITH_PARAM = "with";

const ADD_ROLE = "add";

const INTRO_SECTION = "intro";
const COMPARISON_SECTION = "comparison";

// Beside the page's own title, and beside the chips naming what is in the comparison: both
// are written into once the rows are in hand.
const ADD_ID = "compare-add";
const PICKS_ID = "compare-page-picks";

// ─── URL STATE ───────────────────────────────────────────────────────────────

// Nothing is validated here: a record named in `with` may have been deleted, or made private,
// since the URL was written. Which of them survive is settled once the rows are in hand — see
// toAllowedIds.
function readWithIds() {
  const params = new URLSearchParams(location.search);

  return (params.get(WITH_PARAM) ?? "").split(",").filter(Boolean);
}

// replaceState, not pushState: a comparison is built by adding and dropping records one at a
// time, and each change would otherwise be a history entry the reader has to press Back
// through to leave the page. The URL still survives a refresh and can still be sent to
// someone.
function writeWithIds(withIds) {
  const params = new URLSearchParams(location.search);

  if (withIds.length) params.set(WITH_PARAM, withIds.join(","));
  else params.delete(WITH_PARAM);

  history.replaceState(history.state, "", `?${params}`);
}

// ─── MARKUP ──────────────────────────────────────────────────────────────────

/**
 * The control that puts one more record in.
 *
 * @param rows  what may be added, in the order they should read.
 * @param noun  *singular*, for the placeholder — "model".
 * @param full  whether the comparison holds as many as it can.
 * @param toKey (row) => the key it is picked by, which is the option's value.
 * @param toLabel (row) => what the option calls it.
 * @returns the markup.
 */
function buildAddSelect(rows, { noun, full, toKey, toLabel }) {
  // The placeholder carries the control's state: nothing left to add, or no room for it.
  const placeholder = full
    ? `Remove a ${noun} to add another`
    : rows.length
      ? `Add a ${noun}...`
      : `No other ${pluralise(noun)} to add`;

  // Inline rather than stretched: .input-select is full-width, and a lone select across the
  // page reads as a field to fill in rather than a scope to pick. `add-select` is the text
  // size: this is the page's own control, not one of a bar of filters.
  return `
    <span class="inline-select add-select">
      ${buildSelect({
        name: ADD_ROLE,
        hook: "role",
        options: rows.map((row) => ({
          value: toKey(row),
          label: toLabel(row),
        })),
        placeholder,
        disabled: full || !rows.length,
      })}
    </span>
  `;
}

// ─── COMPARE PAGE ────────────────────────────────────────────────────────────

/**
 * A compare page: a set of records read against each other, carried in the URL.
 *
 * @param noun             *singular* — "model".
 * @param requiresAuth     as loadPage.
 * @param load             as loadPage. The page has no id of its own, so a module opening on
 *                         one reads it from the URL itself — see pages/modelCompare.js.
 * @param toRows           (context) => every record that may be compared, as rows.
 * @param createComparison ({ container, fixedKeys }) => the comparison — a preset,
 *                         see comparisons/modelComparison.js.
 * @param header           (context) => { title, subtitle, badges }.
 * @param optionLabel      (row) => what the add select calls it. Omit for `row.name`.
 * @param seedIds          (context) => the ids the page opens on, held for its life and kept
 *                         out of `with`. Omit for a page that opens on the URL alone.
 *
 * @returns loadPage's promise, settled once the page has rendered or reported its failure.
 */
function loadComparePage({
  noun,
  requiresAuth = false,

  load,
  toRows,
  createComparison,

  header,

  optionLabel = (row) => row.name,
  seedIds = () => [],
}) {
  function renderComparePage(context) {
    const rows = toRows(context);

    // Held for the life of the page: the reader arrived from them, and the chips inside the
    // comparison are drawn without a ✕.
    const seeded = seedIds(context);

    renderPage(
      buildPage({
        header: buildHeader([`<span id="${ADD_ID}"></span>`]),

        body:
          // Untitled: it holds whatever is standing in for the page — a URL whose records
          // have all gone — and a heading over that would be a heading over an apology.
          buildSection({ id: INTRO_SECTION }) +
          buildSections([
            {
              id: COMPARISON_SECTION,

              // What is being compared, over the plots and tables reading it.
              controls: `<span class="row left gap-sm compare-picks" id="${PICKS_ID}"></span>`,
            },
          ]),
      }),
    );

    // Every title on the page, the comparison's own included: one listener over the container
    // they all sit in, so the widget's sections are covered though they are not built yet.
    attachCollapse(CONTAINER_ID);

    // The whole of the reading, stacked down the page.
    const comparison = createComparison({
      container: getSectionBody(COMPARISON_SECTION),
      fixedKeys: seeded,

      // The chips read above the panels rather than inside them.
      picksContainer: PICKS_ID,
    });

    const rowByKey = new Map(rows.map((row) => [comparison.toKey(row), row]));

    let withIds = readWithIds();

    // The URL follows the comparison, whichever way a record went in or out. The seeded ones
    // are not in it: the page's own id carries them.
    comparison.subscribe(() => {
      withIds = comparison.keys().filter((key) => !seeded.includes(key));

      writeWithIds(withIds);
      renderAdd();
    });

    function showSection(id, shown) {
      const section = getSection(id);

      if (section) section.hidden = !shown;
    }

    // Narrows the ids in the URL to the records that still exist, in the order they were
    // asked for, and no more than the comparison has room for beside the seeded ones.
    function toAllowedIds(ids) {
      return ids
        .filter((key) => rowByKey.has(key) && !seeded.includes(key))
        .slice(0, comparison.max - seeded.length);
    }

    // ─── SECTIONS ──────────────────────────────────────────────────────────────

    // The seeded records lead, then the rest in the order the URL names them, which is the
    // order the list that sent the reader here marked its rows in — so a record keeps the
    // colour it was picked in. One added by the select is not in the URL yet and goes last,
    // which is the next colour.
    function applySelection() {
      comparison.setPicks([...seeded, ...withIds].map((key) => rowByKey.get(key)).filter(Boolean));
    }

    // Delegated: the select is rebuilt whenever what is held changes.
    function attachAddEvents() {
      getElement(ADD_ID).addEventListener("change", (event) => {
        const select = event.target.closest(`[data-role="${ADD_ROLE}"]`);

        if (!select?.value) return;

        const row = rowByKey.get(select.value);

        // A refused pick redraws nothing.
        select.value = "";

        if (row) comparison.pick(row);
      });
    }

    function renderAdd() {
      const offered = rows
        .filter((row) => !comparison.has(comparison.toKey(row)))
        .sort((a, b) => optionLabel(a).localeCompare(optionLabel(b)));

      renderHtml(
        getElement(ADD_ID),
        buildAddSelect(offered, {
          noun,
          full: comparison.size >= comparison.max,
          toKey: comparison.toKey,
          toLabel: optionLabel,
        }),
      );
    }

    // ─── START ─────────────────────────────────────────────────────────────────

    // Nothing that could be compared at all: the results have nothing to say, so they are
    // hidden rather than left standing empty under their titles. A page with records on offer
    // and none picked is not this — the comparison's own prompt says so there.
    function renderIntro() {
      comparison.clear();

      showSection(COMPARISON_SECTION, false);
      showSection(INTRO_SECTION, true);

      renderHtml(
        getSectionBody(INTRO_SECTION),
        buildEmptyMessage(`There are no ${pluralise(noun)} to compare`),
      );
    }

    function start() {
      const { title, subtitle = "", badges = [] } = header(context);

      renderHeader(title, subtitle, badges);

      // The URL was written against a field that may since have changed, so it is settled
      // here before anything is drawn from it.
      withIds = toAllowedIds(withIds);
      writeWithIds(withIds);

      if (!rows.length) {
        renderIntro();

        return;
      }

      showSection(INTRO_SECTION, false);
      showSection(COMPARISON_SECTION, true);

      attachAddEvents();
      renderAdd();
      applySelection();
    }

    return start();
  }

  return loadPage({
    noun,

    // The page is about a set named in the URL rather than one record, so there is no id for
    // loadPage to find or to refuse the page for want of.
    requiresId: false,
    requiresAuth,

    load,
    render: renderComparePage,
  });
}

export { loadComparePage };

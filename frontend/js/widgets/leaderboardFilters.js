// The filters a leaderboard is narrowed by: which they are, the fold that holds all but the
// first three, and the three buttons.
//
// The controls hold what is pending; `applied` is what the board was fetched with. The fetch
// itself is the caller's — see onApply.

import { getElement, renderHtml } from "../core/render.js";
import { formatCount } from "../core/utils.js";
import { MODEL_FIELDS } from "../schemas/modelSchema.js";
import { TASK_FIELDS, trainingFieldKeys } from "../schemas/taskSubmissionSchema.js";
import { buildButton } from "../components/buttons.js";
import { buildFilterControl } from "../components/filters.js";
import { createFilterState } from "../components/filterState.js";
import { getIcon } from "../components/icons.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const APPLY_ID = "apply-filters";
const CLEAR_ID = "clear-filters";
const MORE_ID = "more-filters";

// The one row the controls and the fold button flow in, rewritten in place.
const FLOW_ID = "filter-flow";

const MORE_LABEL = "More filters";
const FEWER_LABEL = "Less";

// ─── FILTERS ─────────────────────────────────────────────────────────────────

// Only the two answers: the endpoint reads an unanswered flag as neither.
const PRETRAINED_OPTIONS = [
  { value: "true", label: "Pretrained" },
  { value: "false", label: "Not pretrained" },
];

// What the model was pretrained on, and to produce.
const MODEL_KEYS = ["pretrained_in_modalities", "pretrained_out_modalities"];

// Off the schema, so a methodology field added there is a filter here.
const METHODOLOGY_KEYS = trainingFieldKeys();

/**
 * Every filter the board can be narrowed by, in the order they are drawn.
 *
 * No `match`: these are the server's, since a narrowed field is a different set of ranks.
 * `fold` marks the ones behind "Show more filters" — the first three are what a reader asks
 * first, and five more on the row at rest would bury them.
 *
 * Options come from the server's own enums, filled into both schemas in place — see
 * loadModelMeta and loadTaskFields, which is why this is read after the page's own load.
 *
 * @returns the controls — see components/filterState.js.
 */
function filterControls() {
  return [
    {
      type: "pinned",
      name: "pretrained",
      label: "Pretrained",
      options: PRETRAINED_OPTIONS,
    },
    ...MODEL_KEYS.map((key) => ({
      type: "pinned",
      name: key,
      label: MODEL_FIELDS[key].label,
      options: MODEL_FIELDS[key].options ?? [],
    })),
    {
      type: "range",
      name: "n_parameters",
      label: "Parameters",
      range: { min: 1e3, max: 2e11, scale: "log" },
      format: formatCount,
      fold: true,
    },
    {
      type: "range",
      name: "temporal_context_s",
      label: "Temporal context",
      range: { min: 0, max: 20, step: 0.5 },
      format: (value) => `${value} s`,
      fold: true,
    },
    ...METHODOLOGY_KEYS.map((key) => ({
      type: "pinned",
      name: key,
      label: TASK_FIELDS[key].label,
      options: TASK_FIELDS[key].options ?? [],
      fold: true,
    })),
  ];
}

// ─── MARKUP ──────────────────────────────────────────────────────────────────

function buildShell() {
  return `<div class="filter-flow" id="${FLOW_ID}"></div>`;
}

// One cell. Folded controls stay in the DOM, hidden: a pinned value is read back off them.
function buildCell(control, values, className = "") {
  const markup = buildFilterControl({ control, value: values[control.name] });

  return className ? `<span class="${className}">${markup}</span>` : markup;
}

// `sm`, as Clear and Apply are: it works the bar the same way they do, and `metadata` drew it
// as a caption that happened to be clickable. It is also the only one of the three live at
// rest, the other two waiting on a change to the filters.
function buildMore(showingMore) {
  return buildButton({
    id: MORE_ID,
    label: showingMore ? FEWER_LABEL : MORE_LABEL,
    icon: getIcon(showingMore ? "collapse" : "expand"),
    className: "sm",
  });
}

/**
 * The buttons, for a caller placing them anywhere on the page. The bar finds them by id and
 * owns what they say and when they are live.
 *
 * @returns the markup for each, in the order they should read.
 */
function buildFilterActions() {
  return [
    buildButton({
      id: CLEAR_ID,
      label: "Clear",
      icon: getIcon("cancel"),
      className: "sm",
      disabled: true,
    }),
    buildButton({
      id: APPLY_ID,
      label: "Apply",
      icon: getIcon("filter"),
      className: "sm",
      disabled: true,
    }),
  ];
}

// ─── WIDGET ──────────────────────────────────────────────────────────────────

/**
 * The filter bar over a board.
 *
 * @param container the element the controls are written into.
 * @param hasBoard  () => whether a board is on screen. Apply stays live without one.
 * @param onApply   () => void, once the filter is settled and in the URL. Fetch `applied()`.
 *
 * @returns { applied, setBusy }. `applied()` is what the board should be fetched with.
 */
function createLeaderboardFilters({ container, hasBoard, onApply }) {
  const controls = filterControls();

  const lead = controls.filter((control) => !control.fold);
  const folded = controls.filter((control) => control.fold);

  const filters = createFilterState({
    controls,
    root: container,
    onChange: updateButtons,
  });

  let applied = filters.readUrl();

  let showingMore = false;

  // ─── RENDERING ─────────────────────────────────────────────────────────────

  // Every control every time: they are one set of values, and a folded one still holds what
  // was pinned in it. `refresh` because a chip carries a ✕.
  //
  // The button is the last cell. Folded, the row it ends is the three lead controls — see
  // `.filter-flow.compact`.
  function renderFilters(values) {
    const flow = getElement(FLOW_ID);

    const cells = [
      ...lead.map((control) => buildCell(control, values)),
      ...folded.map((control) => buildCell(control, values, showingMore ? "" : "folded")),
      buildMore(showingMore),
    ];

    renderHtml(flow, cells.join(""), { refresh: true });

    flow?.classList.toggle("compact", !showingMore);

    filters.mark();
  }

  // ─── BUTTONS ───────────────────────────────────────────────────────────────

  function getApplyButton() {
    return getElement(APPLY_ID);
  }

  function getClearButton() {
    return getElement(CLEAR_ID);
  }

  // Apply is live where the controls differ from `applied`, or where there is no board.
  // Clear resets both, so it is live while either holds a filter.
  function updateButtons() {
    const pending = filters.read();
    const empty = filters.empty();

    const apply = getApplyButton();
    const clear = getClearButton();

    if (apply) {
      apply.disabled = hasBoard() && filters.same(pending, applied);
      if (apply.disabled) {
        apply.classList.remove("primary");
      } else {
        apply.classList.add("primary");
      }
    }

    if (clear) {
      clear.disabled = filters.same(pending, empty) && filters.same(applied, empty);
    }
  }

  // Both dead while a board is on its way, and judged again once it is not.
  function setBusy(busy) {
    if (!busy) {
      updateButtons();

      return;
    }

    for (const button of [getApplyButton(), getClearButton()]) {
      if (button) button.disabled = true;
    }
  }

  // ─── APPLYING ──────────────────────────────────────────────────────────────

  // The URL and the fetch together: the two must never name different fields.
  function applyFilters(values) {
    applied = values;

    filters.writeUrl(applied);

    return onApply?.();
  }

  // ─── EVENTS ────────────────────────────────────────────────────────────────

  function attachEvents() {
    // Delegated: the fold button is rewritten with the controls it sits among. Re-rendered
    // from what the controls currently hold, since the fold moves which cell the button is in.
    container.addEventListener("click", (event) => {
      if (!event.target.closest(`#${MORE_ID}`)) return;

      showingMore = !showingMore;

      renderFilters(filters.read());
    });

    // The controls and the board together: one press is the whole way back to the full field.
    getClearButton()?.addEventListener("click", () => {
      const cleared = filters.empty();

      // Before the fetch, so the controls and the request agree when the board lands.
      renderFilters(cleared);

      applyFilters(cleared);
    });

    getApplyButton()?.addEventListener("click", () => {
      applyFilters(filters.read());
    });
  }

  // ─── START ─────────────────────────────────────────────────────────────────

  renderHtml(container, buildShell());

  renderFilters(applied);
  attachEvents();

  return { applied: () => applied, setBusy };
}

export { buildFilterActions, createLeaderboardFilters };

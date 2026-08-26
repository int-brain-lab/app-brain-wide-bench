// The button pair that switches one thing between two ways of reading it.
//
// Three widgets draw the same switch — the task breakdown, the task comparison and the
// model comparison — and it was copied markup in each before this. It lives here rather
// than in a widget because the styling is the whole of it: which button is lit says which
// view is open, and three copies of that rule drift apart the first time one is restyled.

import { escapeHtml } from "../core/utils.js";
import { getIcon } from "./icons.js";

// The plot-or-table pair, which is every current caller: a figure to see the shape and a
// grid to read the numbers off. The plot leads because it is the faster answer to the
// question a reader opens either widget with.
const PLOT_TABLE_VIEWS = [
  { value: "plot", label: "Plot", icon: "score" },
  { value: "table", label: "Table", icon: "table" },
];

/**
 * @param views  [{ value, label, icon }] — the buttons, in order.
 * @param active which of them is open.
 * @param role   the `data-role` the buttons carry, which is what a host listens for. Named
 *               per widget rather than shared, because a delegated listener on a shared
 *               root would otherwise hear another widget's toggle — see the panes in
 *               pages/leaderboard.js.
 * @returns markup. The caller refreshes the icons: the toggle is rendered as part of
 *          something larger, and one refresh at the end of that beats one per fragment.
 */
function buildViewToggle({ views = PLOT_TABLE_VIEWS, active, role }) {
  return `
    <div class="row right gap-sm">
      ${views
        .map(
          (option) => `
        <button
          type="button"
          class="btn with-icon ${option.value === active ? "primary-inv" : ""}"
          data-role="${escapeHtml(role)}"
          data-view="${escapeHtml(option.value)}"
          aria-pressed="${option.value === active}"
        >
          <i class="btn-icon" data-lucide="${escapeHtml(getIcon(option.icon))}"></i>
          ${escapeHtml(option.label)}
        </button>`,
        )
        .join("")}
    </div>`;
}

/**
 * The view a click asked for, or null if it landed anywhere else.
 *
 * Delegated at every call site, because the buttons carry which view is open and so are
 * part of what each re-render replaces.
 */
function viewFromClick(event, role) {
  return event.target.closest(`[data-role='${role}']`)?.dataset.view ?? null;
}

export { PLOT_TABLE_VIEWS, buildViewToggle, viewFromClick };

// Page entry for index.html — everything on the landing page that is data rather than copy.
//
// Three jobs: the icons the markup names by concept, the four figures under the hero, and the
// task and metric chips on the suite cards. The copy around them is index.html's.
//
// Only the two counts among the hero's figures need the API. They start at "—", so a failed
// load leaves them saying nothing rather than saying zero; everything else, the two facts
// beside them included, is drawn before the request.

import { getElement, refreshIcons, renderHtml } from "../core/render.js";
import { metricsForSuite, SUITES, taskLabel, tasksForSuite } from "../core/suites.js";
import { getStats } from "../api/metaApi.js";
import { buildMetricBadgeList, buildTaskBadge } from "../components/badges.js";
import { buildIcon } from "../components/icons.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// An icon the markup names by concept — see components/icons.js, which owns which glyph each
// concept is drawn with.
const ICON_ATTRIBUTE = "data-icon";

// A suite card, and the two chip slots in it this fills.
const SUITE_ATTRIBUTE = "data-suite";

// A count the API has not answered with yet.
const UNKNOWN = "—";

// Chips beyond this many are counted rather than named. Three and the overflow chip are one
// line of a suite card; a fourth wraps, and the wrap lengthens the tasks row of all three.
const MAX_TASK_CHIPS = 3;

// Every task the benchmark holds, one of the four figures. Off the suites rather than written
// here, so a task added to TASK_NAMES is in this total.
const N_TASKS = SUITES.flatMap(tasksForSuite).length;

// ─── ICONS ───────────────────────────────────────────────────────────────────

// The concept is in the markup and the glyph stays in components/icons.js, so the page says
// what an icon is *for* without naming a Lucide icon anywhere.
function renderIcons() {
  for (const slot of document.querySelectorAll(`[${ICON_ATTRIBUTE}]`)) {
    renderHtml(slot, buildIcon(slot.dataset.icon));
  }

  // Once, after all of them: createIcons walks the whole document each time it is called.
  refreshIcons();
}

// ─── HERO FIGURES ────────────────────────────────────────────────────────────

function buildHeroStat({ icon, value, label }) {
  return `
    <span class="hero-stat">
      <span class="row centre gap-md">
        ${buildIcon(icon)}
        <span class="hero-stat-value">${value}</span>
      </span>
      <span class="hero-stat-label">${label}</span>
    </span>
  `;
}

// Every figure a hero can name, keyed by the name a page's `data-figures` uses. The first two
// are facts about the benchmark and need no request; the last two are counts of what has been
// entered into it.
const FIGURES = {
  suites: { icon: "suite", label: "task suites", value: () => SUITES.length },
  tasks: { icon: "task", label: "tasks", value: () => N_TASKS },
  models: { icon: "model", label: "models", value: (stats) => stats?.n_models },
  submissions: { icon: "submission", label: "submissions", value: (stats) => stats?.n_submissions },
};

/**
 * What the benchmark holds, and what has been entered into it — whichever of them the page
 * asked for, in the order it named them.
 *
 * @param stats the /api/meta/stats response. Omit before it has arrived, which leaves the
 *              counts it carries reading "—" and the facts beside them already drawn.
 */
function renderHeroStats(stats = null) {
  const container = getElement("hero-stats");

  const named = (container.dataset.figures ?? "").split(/\s+/).filter(Boolean);

  const figures = named
    .filter((name) => name in FIGURES)
    .map((name) => {
      const { icon, label, value } = FIGURES[name];

      return { icon, label, value: value(stats) ?? UNKNOWN };
    });

  renderHtml(container, figures.map(buildHeroStat).join(""), { refresh: true });
}

// ─── SUITE CARDS ─────────────────────────────────────────────────────────────

// The first few tasks, and how many more there are. The overflow chip is neutral rather than
// the suite's colour: it stands for the rest of them, not for a task.
function buildTaskChips(suite) {
  const tasks = tasksForSuite(suite);
  const shown = tasks.slice(0, MAX_TASK_CHIPS);

  const chips = shown.map((taskId) => buildTaskBadge(taskLabel(taskId), suite, "sm"));

  if (tasks.length > shown.length) {
    chips.push(buildTaskBadge(`+${tasks.length - shown.length}`, "ts-neutral", "sm"));
  }

  return `<span class="row left gap-sm">${chips.join("")}</span>`;
}

// Both names come from the maps every chip in the app reads — TASK_NAMES and METRIC_NAMES in
// core/suites.js. The cards used to spell their own metrics, and had drifted from them.
function renderSuiteCards() {
  for (const card of document.querySelectorAll(`[${SUITE_ATTRIBUTE}]`)) {
    const suite = card.dataset.suite;

    renderHtml(card.querySelector('[data-slot="tasks"]'), buildTaskChips(suite));
    renderHtml(
      card.querySelector('[data-slot="metrics"]'),
      buildMetricBadgeList(metricsForSuite(suite), "sm"),
    );
  }
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

async function loadLandingPage() {
  renderIcons();
  renderSuiteCards();
  renderHeroStats();

  // Undefined when the fetch failed, which getStats has already logged.
  const stats = await getStats();

  if (stats) renderHeroStats(stats);
}

loadLandingPage();

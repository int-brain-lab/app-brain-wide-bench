// Several task scores side by side: what each came to, how it was measured, and what it did
// per recording.
//
//   picks        a chip per score with an ✕, which is what names every column and series
//                below — all of those carry only the colour. Left out by a host that names
//                them already, and whose picks these are: see `picks`
//   means        a bar per score of its mean for one metric, with the spread of that mean.
//                One plot per *combination* of metrics, so the scores in a plot are the ones
//                measured the same way and its dropdown offers exactly what they share
//   methodology  a score per column, a training field per row
//   recordings   every recording behind those scores — a plot per score as points or as bars,
//                or a heatmap
//
// Two panels, one at a time, behind a strip of tabs:
//
//   Scores       the means and the recordings behind them — what each score came to
//   Methodology  the grid — how each was produced
//
// Split that way because they are read at different moments: a reader compares the numbers,
// and then asks what was done differently. Either panel can also be sent below the other with
// the arrow beside its tab, for the reader who is checking one against the other — the same
// arrangement the record comparison gives its three.
//
// A host whose own table already carries the training fields leaves the methodology out — see
// `methodology` — which leaves the scores alone and no strip above them.
//
// The metric is per plot rather than per comparison. A task carries a primary metric and
// whatever else it was scored in, and two tasks either share that whole set or have nothing to
// compare metric-wise — so the set is what groups the scores, and each group is read in one of
// its own metrics at a time. A score's group settles the metric its recordings are drawn in
// too, which is what keeps a bar and the panel it summarises in step.
//
// The picks and the fetches are comparison.js, which this hands a `render` to; how a
// host's rows name a score is the host's, as `toEntry`.
//
// Colours come from the palette unless the host's rows bring their own — see inkOf.

import { disposeAll } from "../core/disposable.js";
import {
  clearContent,
  getElement,
  refreshIcons,
  renderHtml,
} from "../core/render.js";
import { escapeHtml } from "../core/html.js";
import { mean, sem } from "../core/utils.js";
import { taskLabel } from "../core/suites.js";
import {
  buildComparisonGrid,
  buildPicks,
  dropFromClick,
} from "../components/comparisonGrid.js";
import {
  buildRecordingHeatmaps,
  createRecordingBars,
  createRecordingPlots,
  toScoreSeries,
} from "../plots/recordingScorePlots.js";
import { createBarPlots } from "../plots/bar.js";
import { CATEGORIES_PER_LINE, SHARED_HEIGHT } from "../plots/figure.js";
import { SERIES_COLOURS } from "../plots/palette.js";
import { loadTaskSubmission } from "../api/taskSubmissionApi.js";
import { TASK_FIELDS } from "../schemas/taskSubmissionSchema.js";
import {
  methodologyCells,
  methodologyColumns,
} from "../components/methodologyGrid.js";
import { EMPTY_STORE, toRecordingStore } from "../utils/recordingScoreUtils.js";
import { createComparison } from "./comparison.js";
import {
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";
import {
  buildButton,
  buildToggle,
  setButtonLabel,
} from "../components/buttons.js";
import { getIcon } from "../components/icons.js";
import { buildTabs, markTabs, tabFromEvent } from "../components/tabs.js";
import { buildSelect } from "../components/filters.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// Maximum number of scores that can be compared at once.
const MAX_COMPARED = 6;

// The means, the methodology grid and the recordings. Named rather than "summary" and
// "scores": a section is found by document id, and the record comparison that opens this
// underneath itself owns those.
const MEANS_SECTION = "means";
const METHODOLOGY_SECTION = "methodology";
const RECORDINGS_SECTION = "recordings";

// The two panels the tabs open, each wrapping the sections it holds — the scores' two, the
// methodology's one. Wrappers rather than the sections themselves, because a panel here is
// more than one section and a tab opens one thing.
const SCORES_PANEL = "score-panel";
const METHODOLOGY_PANEL = "methodology-panel";

// The strip's name, and the panels in the order they read. Its own name and not the record
// comparison's, since one of these is mounted inside one of those.
const PANELS = "score-tab";

const TABS = [
  { value: SCORES_PANEL, label: "Scores" },
  { value: METHODOLOGY_PANEL, label: "Methodology" },
];

// The one panel that is always in the rotation: the reader's default tab, and the one thing
// that cannot be docked. The scores, because that is what a comparison is opened to see.
//
// Something has to be: every panel being dockable leaves a state with nothing in the strip to
// press, and a widget whose tabs are all disabled is one a reader cannot get out of. It has no
// arrow for the same reason — there is nothing to offer.
const ANCHOR = SCORES_PANEL;

// The order docked panels read in — which, with two panels and one of them the anchor, is the
// other one. Written as a list anyway, so a third panel lands in a stated order rather than in
// whichever one it happened to be added in.
const DOCK_ORDER = [METHODOLOGY_PANEL];

// The arrow beside each tab, which sends that panel out of the rotation to sit under whichever
// is still in it — see renderDock. One per panel, so an id says which.
const DOCK_ID = "score-dock";

function dockId(value) {
  return `${DOCK_ID}-${value}`;
}

// The row above them all, written once so the ✕ on it can be delegated to one listener. Absent
// where the host said no — see `picks`.
const PICKS_ID = "score-picks";

// Where the prompt goes for a host that wants no methodology panel: with one panel there is no
// section standing empty to put it in, and the scores panel is the two sections themselves.
const PROMPT_ID = "score-prompt";

// A metric select and the plot it belongs to. Read back off the two together, since the means
// row holds one select per plot.
const METRIC = "metric";
const GROUP = "group";

// The three ways the recordings behind the picked scores can be read: a plot per score with
// its marks as points, the same with its marks as bars, or a grid of cells. The buttons carry
// these ids, and a listener is attached to each once — see attachEvents.
const SEPARATE_VIEW = "separate-view";
const BARS_VIEW = "bars-view";
const HEATMAP_VIEW = "heatmap-view";

const VIEWS = [
  { id: SEPARATE_VIEW, label: "Separate", icon: "cards" },
  { id: BARS_VIEW, label: "Bars", icon: "score" },
  { id: HEATMAP_VIEW, label: "Heatmap", icon: "suite" },
];

// ─── ENTRIES ─────────────────────────────────────────────────────────────────

// Read off the detail rather than stamped onto the entry when it lands: a score unticked and
// reticked is a new entry answered from the cache, which never runs the fetch again. Keyed on
// the detail for the same reason, so the one that came back from the cache keeps its store.
const stores = new WeakMap();

function storeOf(entry) {
  const detail = entry.detail;

  if (!detail) return EMPTY_STORE;

  if (!stores.has(detail))
    stores.set(detail, toRecordingStore(detail.score?.metrics?.recordings));

  return stores.get(detail);
}

// The colour a score is drawn in, wherever it is drawn — its bar, its plot, its column in the
// grid.
//
// The one its row arrived with, where the host gave it one: a task opened from the record
// comparison is one row per record, and each keeps the colour its record wears in the plots
// above and in the table it was picked from. Otherwise the comparison's own reckoning, for a
// host whose rows have no colour to bring.
//
// Either way it is the pick's for as long as it is held, so a reader switching views or
// dropping another score doesn't have to find it again.
function inkOf(entry, colourOf) {
  return entry.colour ?? colourOf(entry.key);
}

// What a score is called wherever it is named: its chip above the panels, its series in a
// plot, the heading of its row in the grid. One function, because a reader matching a colour
// to a name has to be matching one name — which is why `entries` is required rather than
// defaulted: it decides what the name says, and a caller that forgot it would quietly get a
// different one.
function labelOf(entry, entries) {
  const name = entry.modelName ?? entry.submissionLabel;

  // The task only where the comparison spans more than one. A panel opened onto a single task
  // says which in its own heading, so naming it again on every chip, series and row heading is
  // the same word six times — and it is the model that differs between them, which is what a
  // label is for. Off the picks rather than off a flag, so the panel under a record comparison
  // and a scores page whose reader picked six models on one task read the same way.
  const spans = new Set(entries.map((one) => one.taskId)).size > 1;

  return [name, spans || !name ? entry.taskId : null]
    .filter(Boolean)
    .join(" · ");
}

// ─── METRIC GROUPS ───────────────────────────────────────────────────────────

// What a score was measured in, in the order the scorers emitted them — which puts the task's
// primary metric first, and so makes it the metric a group opens on.
function metricsOf(entry) {
  return Object.keys(storeOf(entry).metrics);
}

// Two scores belong in one plot when they were measured in the same set of metrics. Sorted, so
// a pair whose scorers emitted them in a different order still groups together; what the
// group *offers* keeps the emitted order, off its first member.
//
// The whole set and not one metric: a task's metrics come as a set, and two tasks either share
// it — in which case every one of them is a comparison worth offering — or they have no
// metric in common to compare on at all.
function combinationOf(entry) {
  return metricsOf(entry).slice().sort().join("|");
}

/**
 * The picked scores in groups, in the order their first member was picked — so a plot doesn't
 * jump around the row when an unrelated score is added.
 *
 * A score whose own request hasn't landed has no metrics yet and is left out rather than
 * grouped with the others that have none: it would be a bar of nothing under a select with
 * nothing in it, and it joins its real group the moment the request answers.
 *
 * @returns [{ key, metrics, entries }].
 */
function toMetricGroups(entries) {
  const groups = new Map();

  for (const entry of entries) {
    const metrics = metricsOf(entry);

    if (!metrics.length) continue;

    const key = combinationOf(entry);

    if (!groups.has(key)) groups.set(key, { key, metrics, entries: [] });

    groups.get(key).entries.push(entry);
  }

  return [...groups.values()];
}

// The tasks a group covers, which is what its plot is labelled with: one task in the ordinary
// case, and the several that share a metric set where a reader has picked across them.
function tasksIn(group) {
  const names = [];

  for (const entry of group.entries) {
    const name = taskLabel(entry.taskId);

    if (name && !names.includes(name)) names.push(name);
  }

  return names.join(" · ");
}

// ─── MEANS ───────────────────────────────────────────────────────────────────

/**
 * One score's figure for one metric: the mean over the recordings it was measured on, and the
 * spread of that mean.
 *
 * The spread is over the recordings rather than the seed-level sems the scorers wrote. Those
 * say how firm one recording's own number is; a reader looking at a single bar per score is
 * asking how much the score moves from recording to recording, which is what a whisker on
 * this bar can answer.
 */
function summaryOf(entry, metric) {
  const values = (storeOf(entry).metrics[metric]?.mean ?? []).filter(
    (value) => value != null,
  );

  return { mean: mean(values), sem: sem(values) };
}

// One series per score, each a single bar: the plot is the group, so its axis holds one
// category and the scores are what is told apart on it — by colour, as everywhere else here.
function toMeanSeries(group, metric, colourOf, name) {
  return group.entries.map((entry) => {
    const summary = summaryOf(entry, metric);

    return {
      colour: inkOf(entry, colourOf),
      label: name(entry),
      metric,
      group: group.key,
      index: new Map([[group.key, 0]]),
      values: { mean: [summary.mean], sem: [summary.sem] },
    };
  });
}

// The metric this plot is read in, above the plot itself: what the group shares is exactly
// what it offers, so the select can only name a metric every bar in it has.
//
// Which plot it belongs to is on the wrapper around both of them rather than here — see
// renderMeans, whose `data-group` is what a delegated change walks up to and what the figure
// is appended into.
function buildMetricSelect(group, metric) {
  return `
    <span class="row left gap-md">
      <span class="metadata">Metric</span>
      <span class="inline-select">
        ${buildSelect({
          name: METRIC,
          hook: "role",
          options: group.metrics.map((name) => ({ value: name, label: name })),
          selected: metric,
        })}
      </span>
    </span>`;
}

// ─── METHODOLOGY ─────────────────────────────────────────────────────────────

// A score per row, a training field per column — the grid's own default, and what a panel of
// its own can afford: five fields read across, where turned they would be five rows of one.
//
// Each row headed with the score's own chip, the same one the row above the grid names it with
// — and by the same `name`, so the two cannot come to read differently.
function buildMethodologyGrid(entries, fields, colourOf, name) {
  return buildComparisonGrid({
    attributes: methodologyColumns(fields),
    entities: entries.map((entry) => ({
      label: name(entry),
      ink: inkOf(entry, colourOf),
      cells: methodologyCells({
        // Absent until this score's own request lands.
        record: entry.detail ?? null,
        fields,
      }),
    })),
  });
}

// ─── WIDGET ──────────────────────────────────────────────────────────────────

/**
 * @param container   as createComparison.
 * @param toEntry     (row) => { key, taskId, submissionId, submissionLabel, modelName,
 *                    metric, colour? }. `key` is the task submission the score belongs to,
 *                    which is also what is fetched. `colour` is for a host whose rows are
 *                    already drawn in one — see inkOf.
 * @param prompt      what to say with nothing picked. The leaderboard's rows are one task's
 *                    scores across models, so it says "rows" where the scores page says "task
 *                    scores" — the same instruction about the same cap, in the words of
 *                    whatever table is above it.
 * @param picks       false to leave out the row of chips. For a host that sets these picks
 *                    rather than the reader: it names them itself, in the same colours, and a
 *                    ✕ here would take a score out only until the host next set them again.
 * @param layout      "rows" to put the means beside the recordings rather than above them.
 * @param methodology false to leave out the methodology panel, which leaves one panel and so
 *                    no tabs either. For a host whose own table already carries the fields.
 */
function createTaskComparison({
  container,
  picks = true,
  layout = "",
  methodology = true,
  ...options
}) {
  // The element holding the strip and the panels — the one tab presses are read off, and the
  // one the panels are reordered inside when the reader docks one.
  let root = null;
  const beside = layout === "rows";

  // One panel and no strip where the host wants no methodology: there is nothing to switch
  // between and nothing to dock.
  const panels = methodology
    ? TABS
    : TABS.filter((tab) => tab.value === ANCHOR);
  const strip = panels.length > 1;
  const dockable = panels.filter((tab) => tab.value !== ANCHOR);

  // With no strip the means and the recordings are read together rather than a tab apart, so a
  // mean stands at the height of a plot sharing the page instead of a lone plot's. Null for
  // the arrangement's own — see arrangePlots.
  const meanHeight = strip ? null : SHARED_HEIGHT;

  // The tab the reader chose, which is not necessarily the one open — see openPanel. The
  // anchor to begin with, which is the tab a reader who has said nothing is on. And which
  // panels they have sent below it, which is not necessarily in effect — see isDocked.
  let chosen = ANCHOR;
  const docked = new Set();

  let view = SEPARATE_VIEW;

  // The reader's choice per group, keyed by the combination rather than by the plot's place in
  // the row: a score added to another group would otherwise move this one's choice along with
  // its plot. Not necessarily what is drawn — see metricInForce.
  const selectedMetrics = new Map();

  let comparison = null;

  // Per row, because the two are redrawn separately: a metric change redraws both, a view
  // change only the recordings.
  let meanCharts = [];
  let plotCharts = [];

  // Chart.js keeps a registry keyed on the canvas, so an instance whose container is about to
  // be rewritten has to be told.
  function clearMeans() {
    disposeAll(meanCharts);
    meanCharts = [];
  }

  function clearPlots() {
    disposeAll(plotCharts);
    plotCharts = [];
  }

  function clearUp() {
    clearMeans();
    clearPlots();

    // The one render the controller does itself is the empty one, which never reaches
    // renderSections — so this is where the row is cleared.
    renderPicks();

    getSection(MEANS_SECTION).hidden = true;
    getSection(RECORDINGS_SECTION).hidden = true;

    // Before the prompt is written into it, and again once something is picked — which is
    // what takes it back off.
    if (!methodology) clearContent(getElement(PROMPT_ID));

    showPanel();
    renderDock();
  }

  // ─── PANELS ────────────────────────────────────────────────────────────────

  // How many scores are being compared, which is what decides whether the scores panel has
  // anything in it.
  function picked() {
    return (comparison?.entries() ?? []).length;
  }

  // Whether a panel is out of the rotation, on screen under the one still in it. Only once
  // something is picked: with nothing to compare the scores panel is empty and the methodology
  // panel is where the prompt goes, so that is the tab the reader is on. The presses are
  // remembered either way and take effect as soon as a score is picked.
  function isDocked(value) {
    return value !== ANCHOR && docked.has(value) && picked() > 0;
  }

  function dockedPanels() {
    return DOCK_ORDER.filter(isDocked);
  }

  // Whether a panel is one the tabs can open. Not a docked one, which is already on screen;
  // otherwise the methodology always — with nothing picked it is where the prompt goes — and
  // the scores once something is picked.
  function canOpen(value) {
    if (isDocked(value)) return false;

    // The only panel there is holds the prompt beside it, so it is on screen before anything
    // is picked as well as after.
    if (!strip) return true;

    return value === METHODOLOGY_PANEL || picked() > 0;
  }

  // The open panel: the reader's while it can be opened, else the first that can. There is
  // always one — the anchor cannot be docked, and with nothing picked the methodology is where
  // the prompt goes — so the empty answer below is a guard rather than a state.
  //
  // Derived rather than written back, so the scores — which cannot be opened before anything
  // is picked — are theirs again the moment they can be, rather than the reader being left on
  // the tab a fallback moved them to.
  function openPanel() {
    if (canOpen(chosen)) return chosen;

    return panels.map((tab) => tab.value).find(canOpen) ?? "";
  }

  // Which panel is on screen, and the strip that says which.
  function showPanel() {
    const open = openPanel();

    for (const { value } of panels) {
      const element = getElement(value);

      // A docked panel shows whichever tab is open: that is the whole of what docking is.
      if (element) element.hidden = !isDocked(value) && value !== open;
    }

    if (root && strip) markTabs(root, PANELS, open, canOpen);
  }

  // Where the panels sit, and which way each arrow points: the open tab first, then every
  // docked panel under it. Appended in that order, which is the order they read.
  //
  // Moved rather than drawn twice: each is one wrapper over sections the comparison renders
  // into by id, so a second copy would be a second thing to keep saying the same.
  function renderDock() {
    if (root && strip) {
      for (const value of [openPanel(), ...dockedPanels()]) {
        const element = value && getElement(value);

        if (element) root.appendChild(element);
      }
    }

    for (const { value, label } of dockable) {
      const down = isDocked(value);

      setButtonLabel(getElement(dockId(value)), {
        label: `${down ? "Undock" : "Dock"} ${label.toLowerCase()}`,
        icon: getIcon(down ? "up" : "down"),
      });

      // Lit for what is true now rather than for what the reader last pressed: with nothing
      // picked both panels are tabs whatever the arrows say.
      getElement(dockId(value))?.classList.toggle("primary-inv", down);
    }

    refreshIcons();
  }

  // Every panel on screen, and only those: a plot built inside a hidden element sizes its
  // canvas to nothing, and a panel is redrawn on the way in anyway.
  function renderPanel() {
    const shown = new Set([openPanel(), ...dockedPanels()]);

    if (shown.has(SCORES_PANEL)) {
      // Put away by clearUp, and back once there is something to read. The means row shows
      // itself — see renderMeans, which is the only thing that knows whether it has groups.
      getSection(RECORDINGS_SECTION).hidden = false;

      renderMeans();
      renderPlot();
    }

    if (shown.has(METHODOLOGY_PANEL)) renderGrid();
  }

  // ─── METRICS ───────────────────────────────────────────────────────────────

  // The metric a group is read in: the reader's while the group still offers it, else the
  // first it offers — which is the task's primary metric, since that is the order the scorers
  // emitted them in. Derived rather than written back, so `selectedMetrics` means what the
  // reader chose and nothing else.
  function metricInForce(group) {
    const wanted = selectedMetrics.get(group.key);

    if (wanted && group.metrics.includes(wanted)) return wanted;

    return group.metrics[0] ?? "";
  }

  // Every score's own metric, by key: what its group is being read in. The recordings below
  // are drawn in it, so a bar and the panel it summarises are always the same measurement.
  function metricsByScore() {
    const held = new Map();

    for (const group of toMetricGroups(comparison.entries())) {
      const metric = metricInForce(group);

      for (const entry of group.entries) held.set(entry.key, metric);
    }

    return held;
  }

  // ─── RENDER ────────────────────────────────────────────────────────────────

  // How each score is named, wherever it is named — see labelOf. Off the whole set of picks
  // rather than off whichever subset a caller happens to hold, so a bar in one metric group
  // and the row heading beside it read the same.
  function nameOf(entry) {
    return labelOf(entry, comparison.entries());
  }

  // The scores being compared, in the colours they are drawn in. Rewritten on every render,
  // which is what keeps the chips in step with the panels below — and emptied by clearUp, so
  // with nothing picked the row collapses rather than naming scores that have gone.
  function renderPicks() {
    const row = getElement(PICKS_ID);

    if (!row) return;

    const held = comparison
      ? comparison.entries().map((entry) => ({
          key: entry.key,
          label: nameOf(entry),
          ink: inkOf(entry, comparison.colourOf),
        }))
      : [];

    renderHtml(row, buildPicks(held), { refresh: true });
  }

  // One plot per group, each under its own metric select. Built one figure at a time rather
  // than as one arrangement, because the select belongs to the plot and an arrangement has
  // nowhere to put a control.
  //
  // Laid out on the page's own grid, a track per group, so these bars are the width the task
  // plots elsewhere are drawn at — see CATEGORIES_PER_LINE in plots/figure.js. Which also
  // means a group is the same width whether the reader is comparing one combination or four,
  // and a line's worth fill it before the rest wrap.
  //
  // The figures inside are stacked rather than weighted: the grid cell is already one track
  // wide, and weighting again inside it would take a track of a track.
  function renderMeans() {
    const section = getSectionBody(MEANS_SECTION);

    clearMeans();

    const groups = toMetricGroups(comparison.entries());

    // The row's own visibility, since it is the only thing that knows whether there is
    // anything to draw: nothing until a score's request has landed and said what it measured.
    getSection(MEANS_SECTION).hidden = !groups.length;

    if (!groups.length) {
      renderHtml(section, "");

      return;
    }

    function tracks() {
      return beside ? 1: 4
    }

    renderHtml(
      section,
      `<div class="chart-weighted" style="--plot-tracks:${tracks()}">
        ${groups
          .map(
            (group, at) => `
          <div class="column gap-sm" data-${GROUP}="${escapeHtml(String(at))}">
            ${buildMetricSelect(group, metricInForce(group))}
          </div>`,
          )
          .join("")}
      </div>`,
    );

    groups.forEach((group, at) => {
      const metric = metricInForce(group);

      const plots = createBarPlots({
        entries: toMeanSeries(group, metric, comparison.colourOf, nameOf),
        // One group per plot, and one plot per call: the arrangement has nothing to arrange,
        // and stacking is the one layout that leaves the cell's width alone.
        facet: "metric",
        layout: "stack",
        size: "regular",
        order: "given",
        height: meanHeight,
        // The tasks the group covers. Its single category is the group itself, which is not a
        // thing a reader has a name for — the tasks in it are.
        tickLabel: () => tasksIn(group),
        // The chips above name the scores, and their colours are what tell the bars apart.
        legend: false,
      });

      section
        .querySelector(`[data-${GROUP}="${at}"]`)
        ?.appendChild(plots.element);

      meanCharts = meanCharts.concat(plots.charts);
    });
  }

  // Drawn as each score arrives rather than held until they all have: a row with its
  // methodology still missing is worth showing, and its plot fills in behind it. `refresh` for
  // whatever icon a cell brings with it.
  function renderGrid() {
    renderHtml(
      getSectionBody(METHODOLOGY_SECTION),
      buildMethodologyGrid(
        comparison.entries(),
        TASK_FIELDS,
        comparison.colourOf,
        nameOf,
      ),
      { refresh: true },
    );
  }

  function renderPlot() {
    const section = getSectionBody(RECORDINGS_SECTION);

    clearPlots();

    // Each score in the metric its own group is being read in, so a panel here and the bar
    // above it are the same measurement. The plots don't wait on the fields — nothing in them
    // is described by one.
    const metrics = metricsByScore();

    const entries = comparison.entries().map((entry) =>
      toScoreSeries(storeOf(entry), metrics.get(entry.key), {
        colour: inkOf(entry, comparison.colourOf),
        label: nameOf(entry),
      }),
    );

    if (view === HEATMAP_VIEW) {
      renderHtml(section, buildRecordingHeatmaps({ entries }));

      return;
    }

    // The same panels either way — one per score, the same recordings in the same order — and
    // only the mark different, which is the whole of the choice between these two buttons.
    //
    // Where the recordings are the panel: three to a line, filled left to right, so one is a
    // third of the width whether there are two of them or six. Where the methodology is a tab
    // beside them: stacked while there are few enough to be worth the width, two across after
    // that.
    //
    // Only a stack can share an axis, and these can: every panel draws the same recordings in
    // the same order, so the labels under the bottom one are read as the whole stack's. In a
    // grid nothing sits above anything and each carries its own.
    const stacked = entries.length < 4 ? "stack" : "pair";
    const layout = strip ? stacked : "grid";

    const draw = view === BARS_VIEW ? createRecordingBars : createRecordingPlots;

    const plots = draw({ entries, facet: "score", layout });

    section.replaceChildren(plots.element);
    plotCharts = plots.charts;
  }

  function setActiveView(view) {
    for (const { id } of VIEWS) {
      getElement(id)?.classList.toggle("primary-inv", id === view);
    }
  }

  function renderView(selectedView) {
    view = selectedView;
    setActiveView(view);

    // Only the recordings: which way they are read says nothing about the means above them or
    // the methodology beside them.
    renderPlot();
  }

  function renderSections() {
    setActiveView(view);

    renderPicks();

    // The scores panel is openable now, which clearUp said it was not — and whatever the
    // reader had docked takes effect with it.
    showPanel();
    renderDock();

    renderPanel();
  }

  function attachEvents() {
    // On the row rather than on each chip: the chips are rewritten on every render, and the
    // row they sit in is written once.
    getElement(PICKS_ID)?.addEventListener("click", (event) => {
      const key = dropFromClick(event);

      if (key) comparison.drop(key);
    });

    for (const { id } of VIEWS) {
      getElement(id)?.addEventListener("click", () => {
        if (id !== view) renderView(id);
      });
    }

    // Delegated on the element the strip and the panels share: the strip is written once, but
    // a listener per tab would be two where one reads the same. The recordings' own plots
    // carry a group each and no `data-tab`, so a click in one is never read as a tab's.
    root.addEventListener("click", (event) => {
      const tab = tabFromEvent(event);

      if (!tab || tab.name !== PANELS || tab.value === openPanel()) return;

      chosen = tab.value;

      showPanel();
      renderDock();

      // On the way in, not on the way out: a panel is drawn at the width it is about to be
      // read at, which a hidden one does not have.
      renderPanel();
    });

    // By id: the strip is written once, and only what is lit in it changes. Both steps after
    // every press, in this order — showPanel decides which tab is open once the set of
    // openable ones has changed, and renderDock puts the panels where that answer says.
    for (const { value } of dockable) {
      getElement(dockId(value))?.addEventListener("click", () => {
        if (docked.has(value)) docked.delete(value);
        else docked.add(value);

        showPanel();
        renderDock();
        renderPanel();
      });
    }

    // Delegated on the means section's body, which outlives the plots and the selects inside
    // it: both are rewritten whenever the picks or a metric change.
    //
    // Both rows: the group's bar is that metric's mean, and the recordings under it are the
    // measurements it is the mean of. The methodology is untouched — which metric a score is
    // read in says nothing about how it was produced.
    getSectionBody(MEANS_SECTION).addEventListener("change", (event) => {
      const select = event.target.closest(`[data-role='${METRIC}']`);

      if (!select) return;

      const at = Number(select.closest(`[data-${GROUP}]`)?.dataset[GROUP]);
      const group = toMetricGroups(comparison.entries())[at];

      if (!group) return;

      selectedMetrics.set(group.key, select.value);

      renderMeans();
      renderPlot();
    });
  }

  function setup() {
    const means = { id: MEANS_SECTION, title: "Mean scores", hidden: true };
    const grid = { id: METHODOLOGY_SECTION, title: "Methodology" };
    const recordings = {
      id: RECORDINGS_SECTION,
      title: "Recordings",
      actions: [buildToggle(VIEWS)],
      hidden: true,
    };

    root = renderHtml(
      container,
      `
        ${picks ? `<span class="row left gap-sm compare-picks" id="${PICKS_ID}"></span>` : ""}
        ${
          strip
            ? buildTabs({
                name: PANELS,
                // An arrow on each but the anchor: pressing a tab opens that panel, and
                // pressing the arrow beside it sends the panel below whichever tab is still
                // open — see renderDock. The anchor has none, being the one panel always in
                // the rotation.
                tabs: panels.map((tab) => ({
                  ...tab,
                  control:
                    tab.value === ANCHOR
                      ? ""
                      : buildButton({
                          id: dockId(tab.value),
                          label: `Dock ${tab.label.toLowerCase()}`,
                          icon: getIcon("down"),
                          className: "tab-control",
                        }),
                })),
              })
            : ""
        }
        <div id="${SCORES_PANEL}">${buildSections(
          // Spread, not nested: buildSections takes a list of descriptors, and a list *of* a
          // list is one descriptor with no id — which builds a section called nothing and
          // neither of the two the panel is made of.
          beside
            ? [{ sections: [means, recordings], ratio: 4 }]
            :  [means, recordings]
        )}</div>
        ${
          methodology
            ? `<div id="${METHODOLOGY_PANEL}">${buildSections([grid])}</div>`
            : `<div id="${PROMPT_ID}"></div>`
        }`,
    );

    attachEvents();

    comparison = createComparison({
      // With nothing picked, the prompt belongs where the grid would have been — the other
      // two sections are hidden anyway. Both elements outlive it, which is what lets the
      // listeners above be attached once.
      container: methodology
        ? getSectionBody(METHODOLOGY_SECTION)
        : getElement(PROMPT_ID),
      max: MAX_COMPARED,
      prompt: `Select up to ${MAX_COMPARED} task scores to compare them.`,
      palette: SERIES_COLOURS,

      loadDetail: (entry) => loadTaskSubmission(entry.submissionId, entry.key),

      render: renderSections,
      clearUp,

      ...options,
    });

    return comparison;
  }

  return setup();
}

export { MAX_COMPARED, createTaskComparison };

// ─── Constants ──────────────────────────────────────────────────────────────

const METRICS = ["overall", "ts1", "ts2", "ts3"];

const TOGGLEABLE_COLUMNS = [
  "overall",
  "ts1",
  "ts2",
  "ts3",
  "scores",
];

const MEDAL_CLASSES = {
  1: "rank-gold",
  2: "rank-silver",
  3: "rank-bronze",
};

const SUITES = [
  { key: "ts1", label: "TS1", cls: "ts1-bar" },
  { key: "ts2", label: "TS2", cls: "ts2-bar" },
  { key: "ts3", label: "TS3", cls: "ts3-bar" },
];

let activeMetric = "overall";


// ─── Data ───────────────────────────────────────────────────────────────────

async function fetchSubmissions() {
  try {
    return await apiFetch("/api/leaderboard");
  } catch (err) {
    console.error(err);
    showError("Could not load leaderboard.");
    return null;
  }
}


// ─── Formatters ─────────────────────────────────────────────────────────────

function rankFormatter(cell) {
  const rank = cell.getValue();
  const el = cell.getElement();

  el.classList.remove(
    "rank-gold",
    "rank-silver",
    "rank-bronze"
  );

  const medalClass = MEDAL_CLASSES[rank];

  if (medalClass) {
    el.classList.add(medalClass);
  }

  return rank;
}

function scoreFormatter(cell) {
  return score(cell.getValue())
}

function renderModelCell(cell) {
  const row = cell.getData();

  return `
    <div class="model-name">${row.title}</div>
    <div class="model-org">${row.affiliation}</div>
  `;
}

function getVisibleSuites() {
  if (activeMetric === "overall") {
    return SUITES;
  }

  return SUITES.filter(
    suite => suite.key === activeMetric
  );
}

function renderSuiteBar(row, suite) {
  const value = row[suite.key];

  const pct =
    value == null
      ? 0
      : Math.round(value * 100);

  return `
    <div class="mini-bar-row">
      <span class="mini-lbl">${suite.label}</span>

      <div class="bar-bg">
        <div
          class="bar-fill ${suite.cls}"
          style="width:${pct}%"
        ></div>
      </div>
    </div>
  `;
}

function renderBarsCell(cell) {
  const row = cell.getData();

  const bars = getVisibleSuites()
    .map(suite => renderSuiteBar(row, suite))
    .join("");

  return `
    <div class="mini-bars">
      ${bars}
    </div>
  `;
}


// ─── Table Configuration ────────────────────────────────────────────────────

function getColumns() {
  return [
    {
      title: "#",
      field: "rank",
      formatter: rankFormatter,
      headerSort: false,
      width: 50,
    },
    {
      title: "Model",
      field: "title",
      formatter: renderModelCell,
      widthGrow: 2,
    },
    {
      title: "Overall",
      field: "overall",
      formatter: scoreFormatter,
      cssClass: "overall-cell",
    },
    {
      title: "TS1",
      field: "ts1",
      formatter: scoreFormatter,
    },
    {
      title: "TS2",
      field: "ts2",
      formatter: scoreFormatter,
    },
    {
      title: "TS3",
      field: "ts3",
      formatter: scoreFormatter,
    },
    {
      title: "Scores",
      field: "scores",
      formatter: renderBarsCell,
      headerSort: false,
      width: 150,
    },
  ];
}

function createTable(rows) {
  return new Tabulator("#leaderboard", {
    data: rows,

    layout: "fitColumns",

    pagination: true,
    paginationSize: 10,

    footerElement:
      `<span class="tbl-footer-note">${rows.length} models</span>`,

    initialSort: [
      {
        column: "overall",
        dir: "desc",
      },
    ],

    columns: getColumns(),
  });
}


// ─── Leaderboard State ──────────────────────────────────────────────────────

function getVisibleColumns(metric) {
  if (metric === "overall") {
    return TOGGLEABLE_COLUMNS;
  }

  return [
    metric,
    "scores",
  ];
}

function updateColumns(table, metric) {
  const visibleColumns =
    getVisibleColumns(metric);

  TOGGLEABLE_COLUMNS.forEach(field => {
    if (visibleColumns.includes(field)) {
      table.showColumn(field);
    } else {
      table.hideColumn(field);
    }
  });
}

function setActiveMetric(metric) {
  activeMetric = metric;
}

function refreshTable(table, rows) {
  assignRanks(rows, activeMetric);

  table
    .replaceData(rows)
    .then(() => {
      table.setSort(
        activeMetric,
        "desc"
      );
    });
}

function updateLeaderboard(table, rows) {
  updateColumns(table, activeMetric);
  refreshTable(table, rows);
}

function setMetric(table, rows, metric) {
  setActiveMetric(metric);
  updateLeaderboard(table, rows);
}


// ─── Tabs ───────────────────────────────────────────────────────────────────

function attachTabEvents(table, rows) {
  const tabs = document.querySelectorAll(".tab");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t =>
        t.classList.remove("active")
      );

      tab.classList.add("active");

      setMetric(
        table,
        rows,
        tab.dataset.metric
      );
    });
  });
}


// ─── UI ─────────────────────────────────────────────────────────────────────

function showError(message) {
  document.getElementById(
    "leaderboard"
  ).textContent = message;
}


// ─── Entry Point ────────────────────────────────────────────────────────────

async function loadLeaderboard() {
  try {
    const submissions =
      await fetchSubmissions();

    if (!submissions) {
      return;
    }

    const rows =
      toTableRows(submissions);

    assignRanks(rows, "overall");

    const table =
      createTable(rows);

    attachTabEvents(
      table,
      rows
    );

  } catch (err) {
    console.error(
      "Failed to initialise leaderboard:",
      err
    );

    showError(
      "Something went wrong."
    );
  }
}

loadLeaderboard();
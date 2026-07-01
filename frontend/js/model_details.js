



function renderModelTable(model) {
  const rows = Object.entries(model)
    .filter(([key]) => key !== "submissions")
    .map(
      ([key, value]) =>
        `<div class="info-row"><span class="info-key">${key}</span><span class="info-val">${value ?? "—"}</span></div>`
    )
    .join("");

  return `<div class="card-body">${rows}</div>`;
}


// Collect every task score across a model's submissions, grouped by suite.
// Returns e.g. { "ts1": { "ts1-choice": 0.812, ... }, "ts2": { ... } }.
// The suite is the part of the task id before the first hyphen.
function scoresBySuite(submissions) {
  const result = {};
  for (const submission of submissions) {
    for (const ts of submission.task_submissions) {
      const suite = ts.task_id.split("-")[0];
      (result[suite] ??= {})[ts.task_id] = ts.score?.primary_metric_mean ?? null;
    }
  }
  return result;
}


// Drop the suite prefix from a task id: "ts1-choice" -> "choice".
function subtaskLabel(taskId) {
  return taskId.split("-").slice(1).join("-");
}

// Render a single bar row for one task's mean score.
// A null mean (not yet scored) shows an empty bar and a dash.
function renderBar(suite, taskId, mean) {
  const label = subtaskLabel(taskId);
  const widthPct = mean == null ? 0 : Math.round(mean * 100);
  const valueText = mean == null ? "—" : mean.toFixed(2);

  return `
    <div class="bar-row">
      <span class="bar-label">${label}</span>
      <div class="bar-track"><div class="bar-fill ${suite}-bar" style="width:${widthPct}%"></div></div>
      <span class="bar-val">${valueText}</span>
    </div>`;
}

// Render one card for a suite: a header plus a bar row per sub-task.
// `tasks` is a map of { taskId: mean }, e.g. { "ts1-choice": 0.81, ... }.
function renderSuiteCard(suite, tasks) {
  const bars = Object.entries(tasks)
    .map(([taskId, mean]) => renderBar(suite, taskId, mean))
    .join("");

  return `
    <div class="card">
      <div class="card-header"><span class="card-header__title">${suite.toUpperCase()}</span></div>
      <div class="card-body">${bars}</div>
    </div>`;
}

// Render one card per task suite found across the model's submissions.
function renderTaskBars(suites) {

  return Object.entries(suites)
    .map(([suite, tasks]) => renderSuiteCard(suite, tasks))
    .join("");
}


// Format an ISO timestamp as e.g. "10 May 2026".
function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Fill in the model title, submitted date + team, and one badge per task suite.
function renderHeader(model, suites) {
  document.getElementById("model-title").textContent = model.name;

  document.getElementById("model-meta").innerHTML =
    `<span>Submitted ${formatDate(model.created_at)}</span>` +
    `<span>${model.team_name}</span>`;

  document.getElementById("model-badges").innerHTML = suites
    .map((suite) => `<span class="task-badge ${suite}">${suite.toUpperCase()}</span>`)
    .join("");
}

// Fill in the rank block. `rankInfo` is { rank, total } or null if the model
// isn't on the public leaderboard (e.g. no public, scored submissions).
function renderRank(rankInfo) {
  document.getElementById("rank-num").textContent = rankInfo ? `#${rankInfo.rank}` : "—";
  document.getElementById("rank-sub").textContent = rankInfo
    ? `${rankInfo.total} models`
    : "Unranked";
}

// Look up this model's overall rank from the public leaderboard.
// Returns { rank, total } or null if the model isn't listed.
async function fetchRank(model) {
  const leaderboardSubmissions = await apiFetch("/api/leaderboard");
  const { map, total } = leaderboardIndex(leaderboardSubmissions);
  const row = map.get(`${model.name}|${model.team_name}`);
  return row ? { rank: row.rank, total } : null;
}


// Map a submission status to its status-badge CSS modifier.
function statusBadgeClass(status) {
  return { done: "done", scoring: "scoring", failed: "fail", pending: "pending" }[status] ?? "";
}

// One table row per submission: label, last-updated date, status badge, and a
// task badge for each suite the submission covers.
function renderSubmissionRow(submission) {
  const bySuite = scoresBySuite([submission]);

  const taskBadges = Object.keys(bySuite)
    .map((suite) => `<span class="task-badge ${suite}">${suite.toUpperCase()}</span>`)
    .join("");

  return `
    <tr>
      <td>${submission.label}</td>
      <td>${formatDate(submission.updated_at)}</td>
      <td><span class="status-badge ${statusBadgeClass(submission.status)}">${submission.status}</span></td>
      <td><span class="task-badge-row">${taskBadges}</span></td>
    </tr>`;
}

function renderSubmissions(submissions) {
  return submissions.map(renderSubmissionRow).join("");
}


// "public" shows only public submissions; "private" (logged-in) shows them all.
// Driven by <body data-view="..."> so the same renderer serves both pages.
function viewMode() {
  return document.body.dataset.view === "private" ? "private" : "public";
}

async function renderModel() {
  try {
    // Both pages identify the model via ?id=<model_id>. The mock returns the same
    // fixture for any id; a real backend would key on it.
    const modelId = new URLSearchParams(location.search).get("id") || "current";
    const model = await apiFetch(`/api/models/${modelId}`);

    const submissions =
      viewMode() === "public"
        ? model.submissions.filter((s) => s.is_public)
        : model.submissions;

    const suites = scoresBySuite(submissions);

    renderHeader(model, Object.keys(suites));
    renderRank(await fetchRank(model));

    document.getElementById("model-details").innerHTML = renderModelTable(model);
    document.getElementById("task-bars").innerHTML = renderTaskBars(suites);
    document.getElementById("submissions-list").innerHTML = renderSubmissions(submissions);

  } catch (err) {
    console.error(err);

  }
}

renderModel()
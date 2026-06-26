const RANK_CLASSES = [
  "rank-gold",
  "rank-silver",
  "rank-bronze",
];

function renderTableRow(row, index) {
  const rankClass = RANK_CLASSES[index] || "";

  return `
    <tr>
      <td class="${rankClass}">${index + 1}</td>
      <td>
        <div class="model-name">${row.title}</div>
        <div class="model-org">${row.affiliation}</div>
      </td>
      <td>${score(row.overall)}</td>
      <td>${score(row.ts1)}</td>
      <td>${score(row.ts2)}</td>
      <td>${score(row.ts3)}</td>
    </tr>
  `;
}

function renderTable(rows) {
  const topRows = rows
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5);

  const html = topRows
    .map(renderTableRow)
    .join("");

  document.getElementById("lb-table-preview").innerHTML = html;
  document.getElementById("lb-table-count").textContent =
    `${rows.length} models`;
}

function renderStats(rows, submissions) {
  document.getElementById("stat-submissions").textContent =
    submissions.length;

  document.getElementById("stat-models").textContent =
    rows.length;
}

async function renderLanding() {
  try {
    const submissions = await apiFetch("/api/leaderboard");
    const rows = toTableRows(submissions);

    renderTable(rows);
    renderStats(rows, submissions);

  } catch (err) {
    console.error(err);

    document.getElementById("lb-table-count").textContent =
      "Could not load leaderboard.";
  }
}

renderLanding();
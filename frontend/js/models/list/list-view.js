import {escapeHtml, formatDate} from "../../utils.js";

function renderModelList(models) {

  const modelList = document.getElementById("models-list")

  if (models.length === 0) {
    modelList.replaceChildren();
    return
  }

  if (models.length <= 6) {
    modelList.classList = 'grid-3'
    modelList.innerHTML = buildModelCards(models);
    return
  }

  modelList.classList = 'table'
  modelList.innerHTML = buildModelTable(models);
}



function buildModelCards(models) {

  return models.map(model => `
    <a class="card secondary column left gap-lg" href="model_details.html?id=${encodeURIComponent(model.id)}">
      <p class="label">${escapeHtml(model.name)}</p>
      <div class="column left gap-md">
        <p class="metadata">Team: ${escapeHtml(model.team_name || "—")}</p>
        <p class="metadata">Created: ${escapeHtml(formatDate(model.created_at))}</p>
        <p class="metadata">Submissions: ${model.n_submissions ?? 0}</p>
      </div>
    </a>
  `).join("");
}


function buildModelTable(models) {

  return `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Team</th>
          <th>Created</th>
          <th>Submissions</th>
        </tr>
      </thead>
      <tbody>
        ${models.map(model => `
          <tr data-model-id="${escapeHtml(model.id)}">
            <td><a href="model_details.html?id=${encodeURIComponent(model.id)}">${escapeHtml(model.name)}</a></td>
            <td>${escapeHtml(model.team_name || "—")}</td>
            <td>${escapeHtml(formatDate(model.created_at))}</td>
            <td>${model.n_submissions ?? 0}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}


export { renderModelList };
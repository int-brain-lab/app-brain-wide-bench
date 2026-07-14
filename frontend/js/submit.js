// New-submission page: auth gate + basic fields (model dropdown, read-only team).
// Zip task detection, methodology forms, and the actual submit come in later stages.

function setMsg(text) {
  document.getElementById("msg").textContent = text || "";
}

let myModels = [];

async function loadModels() {
  const select = document.getElementById("model-select");
  try {
    const models = await apiFetch("/api/users/me/models");
    myModels = models;
    if (!models.length) {
      select.innerHTML = `<option value="">No models available</option>`;
      setMsg("You have no models yet — a model is required to submit.");
      return;
    }
    select.innerHTML =
      `<option value="" disabled selected>Select a model…</option>` +
      models.map(m => `<option value="${m.id}">${m.name}</option>`).join("");
  } catch (err) {
    console.error(err);
    setMsg("Could not load your models.");
  }
}

async function showTeamForModel(modelId) {
  const teamField = document.getElementById("team-display");
  if (!modelId) { teamField.value = ""; return; }
  try {
    const model = await apiFetch(`/api/models/${modelId}`);
    teamField.value = model.team_name || "—";
  } catch (err) {
    console.error(err);
    teamField.value = "—";
  }
}

async function init() {
  const authed = await isAuthenticated();
  document.getElementById("gate").hidden = authed;
  document.getElementById("submit-form").hidden = !authed;

  if (!authed) {
    document.getElementById("gate-login").addEventListener("click", login);
    return;
  }

  document.getElementById("model-select")
    .addEventListener("change", (e) => showTeamForModel(e.target.value));

  attachDropzone();
  setupManualAdd();
  document.getElementById("submit-btn").addEventListener("click", handleSubmit);
  await loadEnumOptions();
  await loadKnownTasks();
  await loadModels();
}

// ─── Zip drop zone + task detection ─────────────────────────────────────────

let detectedTasks = [];
let selectedFile = null;

async function handleZipFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".zip")) {
    setMsg("Please choose a .zip file.");
    return;
  }
  selectedFile = file;
  const fileLabel = document.getElementById("dropzone-file");
  fileLabel.textContent = file.name;
  fileLabel.hidden = false;

  setMsg("Reading zip…");
  try {
    const paths = await listZipEntries(file);
    detectedTasks = inferTasks(paths);
    // TEMP DEBUG (remove me): mangle the first detected task so it renders as invalid.
    if (detectedTasks.length) detectedTasks[0] = detectedTasks[0] + "-broken";
    buildMethodology(detectedTasks);
    setMsg(
      detectedTasks.length
        ? `Detected ${detectedTasks.length} task(s).`
        : "No tasks detected — add them manually below."
    );
  } catch (err) {
    console.error(err);
    detectedTasks = [];
    buildMethodology([]);
    setMsg(`Could not read the zip (${err.message}). You can add tasks manually below.`);
  }
}

function attachDropzone() {
  const zone = document.getElementById("dropzone");
  const input = document.getElementById("file-input");

  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  input.addEventListener("change", () => handleZipFile(input.files[0]));

  ["dragover", "dragenter"].forEach(ev =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("dropzone--over"); }));
  ["dragleave", "dragend"].forEach(ev =>
    zone.addEventListener(ev, () => zone.classList.remove("dropzone--over")));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dropzone--over");
    const file = e.dataTransfer.files[0];
    if (file) handleZipFile(file);
  });
}

// ─── Per-task methodology carousel ──────────────────────────────────────────

const METHOD_FIELDS = [
  { key: "extra_input_modality", label: "Extra input modality" },
  { key: "training_paradigm", label: "Training paradigm" },
  { key: "supervision_regime", label: "Supervision regime" },
  { key: "calibration", label: "Calibration" },
  { key: "finetuning_strategy", label: "Finetuning strategy" },
];

let enumOptions = {};
let taskState = {};   // task_id -> { <field>: value|null, confirmed: bool }
let currentStep = 0;

async function loadEnumOptions() {
  try {
    enumOptions = await apiFetch("/api/meta/enums");
  } catch (err) {
    console.error(err);
    enumOptions = {};
  }
}

function buildMethodology(tasks) {
  taskState = {};
  tasks.forEach(t => {
    taskState[t] = { confirmed: false };
    METHOD_FIELDS.forEach(f => { taskState[t][f.key] = null; });
  });
  currentStep = 0;
  refreshMethodology();
}

function refreshMethodology() {
  const tasks = Object.keys(taskState);
  document.getElementById("methodology-block").hidden = !tasks.length;
  if (tasks.length) renderCarousel();
  refreshManualAddOptions();
  updateSubmitState();
}

// ─── Manual task add / remove ───────────────────────────────────────────────

let knownTaskIds = [];

async function loadKnownTasks() {
  try {
    const tasks = await apiFetch("/api/tasks/");
    knownTaskIds = tasks.map(t => t.id).sort();
  } catch (err) {
    console.error(err);
    knownTaskIds = [];
  }
  refreshManualAddOptions();
}

function refreshManualAddOptions() {
  const select = document.getElementById("manual-task-select");
  const available = knownTaskIds.filter(id => !(id in taskState));
  select.innerHTML = available.length
    ? available.map(id => `<option value="${id}">${id}</option>`).join("")
    : `<option value="">All known tasks added</option>`;
  document.getElementById("manual-add-btn").disabled = !available.length;
}

function addTask(taskId) {
  if (!taskId || taskId in taskState) return;
  taskState[taskId] = { confirmed: false };
  METHOD_FIELDS.forEach(f => { taskState[taskId][f.key] = null; });
  currentStep = Object.keys(taskState).indexOf(taskId);
  refreshMethodology();
}

function removeTask(taskId) {
  delete taskState[taskId];
  const n = Object.keys(taskState).length;
  if (currentStep >= n) currentStep = Math.max(0, n - 1);
  refreshMethodology();
}

function remapTask(oldId, newId) {
  if (!newId || newId in taskState) return;
  // Rebuild preserving order, swapping the invalid id for the chosen valid one.
  const rebuilt = {};
  for (const [k, v] of Object.entries(taskState)) rebuilt[k === oldId ? newId : k] = v;
  taskState = rebuilt;
  currentStep = Object.keys(taskState).indexOf(newId);
  refreshMethodology();
}

function setupManualAdd() {
  document.getElementById("manual-add-btn").addEventListener("click", () =>
    addTask(document.getElementById("manual-task-select").value));
}

function isValidTask(taskId) {
  // If the known-task list failed to load, don't block on validation.
  return knownTaskIds.length === 0 || knownTaskIds.includes(taskId);
}

function allValid() {
  return Object.keys(taskState).every(isValidTask);
}

function allConfirmed() {
  const tasks = Object.keys(taskState);
  return tasks.length > 0 && tasks.every(t => taskState[t].confirmed);
}

function updateSubmitState() {
  document.getElementById("submit-btn").disabled = !(allConfirmed() && allValid());
}

function renderStepPills(tasks) {
  return tasks.map((t, i) => {
    const st = taskState[t];
    const invalid = !isValidTask(t);
    const cls = invalid ? "invalid" : st.confirmed ? "confirmed" : (i === currentStep ? "current" : "pending");
    const marker = invalid ? "✗ " : (st.confirmed ? "✓ " : "");
    return `<button type="button" class="step-pill ${cls}" data-step="${i}">${marker}${t}</button>`;
  }).join("");
}

function renderStepForm(task) {
  const st = taskState[task];

  if (!isValidTask(task)) {
    const options = knownTaskIds
      .filter(id => !(id in taskState))
      .map(id => `<option value="${id}">${id}</option>`)
      .join("");
    return `
      <div class="carousel-card invalid">
        <div class="carousel-card-header">
          <span class="carousel-card-title">${task}</span>
          <button type="button" class="btn carousel-remove" data-task="${task}">Remove</button>
        </div>
        <p class="invalid-note">✗ "${task}" is not a recognised task. Choose the correct task to continue.</p>
        <label class="field">
          <span class="field-label">Task</span>
          <select class="task-remap" data-task="${task}">
            <option value="" selected disabled>${task} (invalid — choose one)</option>
            ${options}
          </select>
        </label>
      </div>`;
  }

  const fields = METHOD_FIELDS.map(f => {
    const current = st[f.key];
    const options = `<option value="">— none —</option>` +
      (enumOptions[f.key] || [])
        .map(o => `<option value="${o}"${o === current ? " selected" : ""}>${o}</option>`)
        .join("");
    return `
      <label class="field">
        <span class="field-label">${f.label}</span>
        <select class="method-field" data-field="${f.key}">${options}</select>
      </label>`;
  }).join("");

  return `
    <div class="carousel-card ${st.confirmed ? "confirmed" : ""}">
      <div class="carousel-card-header">
        <span class="carousel-card-title">${task}</span>
        <button type="button" class="btn carousel-remove" data-task="${task}">Remove</button>
      </div>
      ${fields}
      <label class="field field--inline">
        <input type="checkbox" class="confirm-task" ${st.confirmed ? "checked" : ""} />
        <span class="field-label">Confirm this task</span>
      </label>
    </div>`;
}

function renderCarousel() {
  const tasks = Object.keys(taskState);
  document.getElementById("carousel-steps").innerHTML = renderStepPills(tasks);
  document.getElementById("carousel-body").innerHTML = renderStepForm(tasks[currentStep]);

  const task = tasks[currentStep];
  document.querySelectorAll(".step-pill").forEach(pill =>
    pill.addEventListener("click", () => { currentStep = Number(pill.dataset.step); renderCarousel(); }));
  document.querySelectorAll(".method-field").forEach(sel =>
    sel.addEventListener("change", () => { taskState[task][sel.dataset.field] = sel.value || null; }));
  document.querySelector(".confirm-task")?.addEventListener("change", (e) => {
    taskState[task].confirmed = e.target.checked;
    renderCarousel();
  });
  document.querySelector(".carousel-remove")
    ?.addEventListener("click", (e) => removeTask(e.target.dataset.task));
  document.querySelector(".task-remap")
    ?.addEventListener("change", (e) => remapTask(e.target.dataset.task, e.target.value));
  updateSubmitState();
}


// ─── Submit ─────────────────────────────────────────────────────────────────

async function handleSubmit() {
  const modelId = document.getElementById("model-select").value;
  const label = document.getElementById("label-input").value.trim();
  const isPublic = document.getElementById("is-public").checked;
  const taskIds = Object.keys(taskState);

  if (!modelId) return setMsg("Select a model.");
  if (!label) return setMsg("Enter a submission name.");
  if (!selectedFile) return setMsg("Choose a .zip file.");
  if (!taskIds.length) return setMsg("Add at least one task.");

  const model = myModels.find(m => m.id === modelId);
  if (!model) return setMsg("Could not determine the team for this model.");

  const btn = document.getElementById("submit-btn");
  btn.disabled = true;
  try {
    setMsg("Requesting upload URL…");
    const presign = await apiFetch("/api/submissions/presign", {
      method: "POST",
      body: JSON.stringify({
        team_id: model.team_id,        // derived from the selected model
        model_id: modelId,
        label,
        task_ids: taskIds,             // methodology not sent (deferred)
        is_public: isPublic,
      }),
    });

    if (presign.upload_url.startsWith("mock-s3://")) {
      setMsg("Dev mode: skipping the real S3 upload…");
    } else {
      setMsg("Uploading file…");
      const put = await fetch(presign.upload_url, {
        method: "PUT",
        headers: { "Content-Type": "application/zip" },
        body: selectedFile,
      });
      if (!put.ok) throw new Error(`upload failed (${put.status})`);
    }

    setMsg("Finalising submission…");
    await apiFetch(`/api/submissions/${presign.submission_id}/submit`, { method: "POST" });

    setMsg("Submitted! Redirecting to your dashboard…");
    window.location.href = "dashboard.html";
  } catch (err) {
    console.error(err);
    setMsg("Submission failed: " + err.message);
    updateSubmitState();   // re-enable for retry (tasks are still all confirmed)
  }
}

init();

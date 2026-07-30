import { renderFields, fieldsForPanel } from "../../utils/form-fields.js";
import { formatBytes, formatDate, renderMessage, renderInfoRows } from "../../utils.js";

const ELEMENTS = {
  gate: document.getElementById("gate"),
  wizard: document.getElementById("wizard"),

  panels: {
    1: document.getElementById("submission-model"),
    2: document.getElementById("submission-name"),
    // 3: document.getElementById("submission-file"),
  },

  modelInfo: document.getElementById("model-info"),
  message: document.getElementById("form-message"),

  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("file-input"),
  fileRemove: document.getElementById("file-remove"),
  fileInfo: document.getElementById("file-info"),
  fileName: document.getElementById("file-name"),
  fileSize: document.getElementById("file-size"),
  taskInfo: document.getElementById("task-info"),

  summary: document.getElementById("summary"),

  submit: document.getElementById("wizard-submit"),

  checkbox: document.getElementById('final-confirm')
};


// ─── PUBLIC API ─────────────────────────────────────────────────────────────

function showGate(isAuthenticated) {
  ELEMENTS.gate.hidden = isAuthenticated;
  ELEMENTS.wizard.hidden = !isAuthenticated;
}

function renderForm(state, fields) {
  for (const [panel, element] of Object.entries(ELEMENTS.panels)) {
    element.innerHTML = renderFields(
      fieldsForPanel(fields, Number(panel)),
      state,
      fields,
    );
  }
}

function showMessage(message) {
  renderMessage(ELEMENTS.message, message);
}

function renderModelPreview(model) {
  ELEMENTS.modelInfo.hidden = false;
  ELEMENTS.modelInfo.replaceChildren(renderInfoRows(modelInfoRows(model)));
}

function clearModelPreview() {
  ELEMENTS.modelInfo.hidden = true;
  ELEMENTS.modelInfo.replaceChildren();
}

function showSelectedFile(file) {
  ELEMENTS.dropzone.hidden = true;
  ELEMENTS.fileInfo.hidden = false;
  ELEMENTS.fileName.textContent = file.name;
  ELEMENTS.fileSize.textContent = formatBytes(file.size);
}

// Resets the native input's value too — otherwise re-selecting the same file
// after removing it wouldn't fire a fresh "change" event.
function showDropzone() {
  ELEMENTS.fileInput.value = "";
  ELEMENTS.dropzone.hidden = false;
  ELEMENTS.fileInfo.hidden = true;
  ELEMENTS.taskInfo.hidden = true;
}

function renderSummary(rows) {
  ELEMENTS.summary.replaceChildren(renderInfoRows(rows));
}

function setSubmitEnabled(enabled) {
  ELEMENTS.submit.disabled = !enabled;
}

function onSubmit(handler) {
  ELEMENTS.submit.addEventListener("click", handler);
}

// These three are pure notifications — no display change of their own — so
// the controller decides what to show only after validating the file.
function onFileSelected(handler) {
  ELEMENTS.fileInput.addEventListener("change", () => {
    const file = ELEMENTS.fileInput.files[0];
    if (file) handler(file);
  });
}

function onFileDropped(handler) {
  ELEMENTS.dropzone.addEventListener("drop", event => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) handler(file);
  });
}

function onFileRemoved(handler) {
  ELEMENTS.fileRemove.addEventListener("click", handler);
}

function formElement() {
  return ELEMENTS.wizard;
}

// The panels holding SUBMISSION_FIELDS specifically — narrower than
// formElement(), which is the whole multi-step wizard and also contains
// #task-list's own (differently-schema'd) fields.
function formPanels() {
  return Object.values(ELEMENTS.panels);
}

function onConfirmed(handler) {
  ELEMENTS.checkbox.addEventListener("click", handler);
}

function finalCheckbox() {
  return ELEMENTS.checkbox.checked;
}

// ─── PRIVATE HELPERS ────────────────────────────────────────────────────────

function modelInfoRows(model) {
  return [
    ["Team", model.team_name || "—"],
    ["Created", formatDate(model.created_at) || "—"],
  ];
}

function setDropzoneActive(active) {
  ELEMENTS.dropzone.classList.toggle("active", active);
}

// Purely visual reactions to drag/drop — no business logic, so the view
// wires its own listeners instead of the controller doing it.
function attachDropzoneVisuals() {
  const zone = ELEMENTS.dropzone;

  zone.addEventListener("click", () => ELEMENTS.fileInput.click());

  ["dragenter", "dragover"].forEach(eventName => {
    zone.addEventListener(eventName, event => {
      event.preventDefault();
      setDropzoneActive(true);
    });
  });

  ["dragleave", "dragend", "drop"].forEach(eventName => {
    zone.addEventListener(eventName, () => setDropzoneActive(false));
  });
}


export {
  attachDropzoneVisuals,
  clearModelPreview,
  formElement,
  formPanels,
  onFileDropped,
  onFileRemoved,
  onFileSelected,
  onSubmit,
  renderForm,
  renderModelPreview,
  renderSummary,
  setSubmitEnabled,
  showDropzone,
  showGate,
  showMessage,
  showSelectedFile,
  finalCheckbox,
  onConfirmed,
};

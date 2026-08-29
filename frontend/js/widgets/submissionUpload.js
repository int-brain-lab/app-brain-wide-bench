// The upload panel of the submission form.
//
// Contains a dropzone for selecting a .zip file, displays the selected file's name and size,
// and detects the tasks contained in the .zip file. The detected tasks are displayed as pills,
// with known tasks in green and unknown tasks in red.

// This component owns its markup and event listeners. `buildUploadPanel()` creates the
// markup; `createUploadSection()` is then called once that markup is in the DOM.

import { formatBytes } from "../core/utils.js";
import { escapeHtml } from "../core/html.js";
import { buildFailureMessage } from "../components/messages.js";
import { clearContent, renderHtml } from "../core/render.js";
import { REQUIRED_MARKER } from "../forms/fields.js";
import { inferTasks, listZipEntries } from "../core/zip.js";

// ─── BUILDERS ────────────────────────────────────────────────────────────────

function buildUploadPanel() {
  return `
    <div class="card column gap-md">
      <p class="title muted">Predictions</p>

      <!-- Not a schema field, so it has no label of its own — but it is required, and the
           panel reads as optional without one. Same classes as a field's, so it lines up
           with the panels above and below. -->
      <label class="field-label">Upload a file${REQUIRED_MARKER}</label>

      <div class="dropzone" id="dropzone">
        <input
          type="file"
          id="file-input"
          accept=".zip,application/zip"
          hidden
        />
        <p class="dropzone-label">
          Drag and drop or select your <code>.zip</code> file here
        </p>
      </div>

      <div class="card row" id="file-info" hidden>
        <div class="column gap-xs">
          <span class="text-lg bold" id="file-name"></span>
          <span class="text-sm muted" id="file-size"></span>
        </div>

        <button type="button" class="btn" id="file-remove">
          Delete
        </button>
      </div>

      <!-- Beside the file card rather than replacing it: a rejected file leaves the
           dropzone up to try again, and the card's own name/size/Delete markup has to
           survive for the next valid one. -->
      <div id="file-message" hidden></div>

      <div id="task-info" hidden></div>
    </div>
  `;
}

function buildDetectedTasks(taskIds, isKnownTask) {
  const pills = taskIds
    .map(
      (taskId) => `
        <span class="badge ${isKnownTask(taskId) ? "success" : "error"}">
          ${escapeHtml(taskId)}
        </span>
      `,
    )
    .join("");

  const count = taskIds.length;
  const label = count === 1 ? "task" : "tasks";

  return `
    <div class="column gap-md">
      <div class="info-msg">
        Detected ${count} ${label} in this file
      </div>

      <div class="row left gap-sm">
        ${pills}
      </div>
    </div>
  `;
}

// ─── DOM ─────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    dropzone: document.getElementById("dropzone"),
    fileInput: document.getElementById("file-input"),
    fileInfo: document.getElementById("file-info"),
    fileName: document.getElementById("file-name"),
    fileSize: document.getElementById("file-size"),
    fileRemove: document.getElementById("file-remove"),
    fileMessage: document.getElementById("file-message"),
    taskInfo: document.getElementById("task-info"),
  };
}

// ─── FILE HANDLING ───────────────────────────────────────────────────────────

function isValidZip(file) {
  return file?.name.toLowerCase().endsWith(".zip");
}

// ─── CONTROLLER ──────────────────────────────────────────────────────────────
/**
 * @param knownTasks Map of task id -> suite.
 * @param onFile    Called with `(file, taskIds)` when a file is selected,
 *                  or `(null, [])` when it is removed.
 */
function createUploadSection({ knownTasks, onFile }) {
  const elements = getElements();

  function isKnownTask(taskId) {
    return knownTasks.size === 0 || knownTasks.has(taskId);
  }

  // ─── RENDERING ─────────────────────────────────────────────────────────────

  function renderDetectedTasks(taskIds) {
    elements.taskInfo.hidden = false;
    elements.taskInfo.className = "card";
    elements.taskInfo.innerHTML = buildDetectedTasks(taskIds, isKnownTask);
  }

  function showSelectedFile(file) {
    elements.dropzone.hidden = true;
    elements.fileInfo.hidden = false;

    elements.fileName.textContent = file.name;
    elements.fileSize.textContent = formatBytes(file.size);
  }

  function showDropzone() {
    // Reset the native input so selecting the same file again fires `change`.
    elements.fileInput.value = "";

    elements.dropzone.hidden = false;
    elements.fileInfo.hidden = true;
    elements.taskInfo.hidden = true;
    elements.fileMessage.hidden = true;
  }

  // ─── EVENTS ────────────────────────────────────────────────────────────────

  async function processFile(file) {
    if (!isValidZip(file)) {
      renderHtml(
        elements.fileMessage,
        buildFailureMessage(`${file?.name ?? "That file"} is not a .zip file.`),
        { show: true },
      );
      return;
    }

    clearContent(elements.fileMessage, { hide: true });
    showSelectedFile(file);

    try {
      const entries = await listZipEntries(file);
      const taskIds = inferTasks(entries);

      renderDetectedTasks(taskIds);
      onFile(file, taskIds);
    } catch (error) {
      console.error(error);

      renderHtml(
        elements.fileMessage,
        buildFailureMessage(
          "That .zip could not be read. Check the file and upload it again.",
          error,
        ),
        { show: true },
      );

      onFile(null, []);
    }
  }

  function removeFile() {
    showDropzone();
    clearContent(elements.fileMessage, { hide: true });
    onFile(null, []);
  }

  function handleFileChange() {
    const file = elements.fileInput.files[0];

    if (file) {
      processFile(file);
    }
  }

  function handleDrop(event) {
    event.preventDefault();

    const file = event.dataTransfer.files[0];

    if (file) {
      processFile(file);
    }
  }

  function handleDragEnter(event) {
    event.preventDefault();
    elements.dropzone.classList.add("active");
  }

  function handleDragLeave() {
    elements.dropzone.classList.remove("active");
  }

  function handleDropzoneClick() {
    elements.fileInput.click();
  }

  function attach() {
    elements.fileInput.addEventListener("change", handleFileChange);

    elements.dropzone.addEventListener("drop", handleDrop);

    elements.dropzone.addEventListener("click", handleDropzoneClick);

    elements.fileRemove.addEventListener("click", removeFile);

    for (const eventName of ["dragenter", "dragover"]) {
      elements.dropzone.addEventListener(eventName, handleDragEnter);
    }

    for (const eventName of ["dragleave", "dragend", "drop"]) {
      elements.dropzone.addEventListener(eventName, handleDragLeave);
    }
  }

  return { attach };
}

export { buildUploadPanel, createUploadSection };

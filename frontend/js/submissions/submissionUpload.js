// The predictions panel: a dropzone, the chosen file, and the task ids read out of the zip.
//
// Owns its markup as well as its listeners, so the ids below are declared and queried in
// one place — `build()` first, then `createUploadSection()` once that markup is in the DOM.

import { escapeHtml, formatBytes, showError, showMessage } from "../utils.js";
import { inferTasks, listZipEntries } from "../zip_list.js";

function buildUploadPanel() {
  return `
    <div class="card column gap-md">
      <p class="title muted">Predictions</p>

      <div class="dropzone" id="dropzone">
        <input type="file" id="file-input" accept=".zip,application/zip" hidden />
        <p class="dropzone-label">Drag and drop or select your <code>.zip</code> file here</p>
      </div>

      <div class="card row" id="file-info" hidden>
        <div class="column gap-xs">
          <span class="text-lg bold" id="file-name"></span>
          <span class="text-sm muted" id="file-size"></span>
        </div>
        <button type="button" class="btn" id="file-remove">Delete</button>
      </div>

      <!-- Detected-task pills, or the reason the zip couldn't be read. -->
      <div id="task-info" hidden></div>
    </div>
  `;
}

function getElements() {
  return {
    dropzone: document.getElementById("dropzone"),
    fileInput: document.getElementById("file-input"),
    fileInfo: document.getElementById("file-info"),
    fileName: document.getElementById("file-name"),
    fileSize: document.getElementById("file-size"),
    fileRemove: document.getElementById("file-remove"),
    taskInfo: document.getElementById("task-info"),
  };
}

function isValidZip(file) {
  return Boolean(file && file.name.toLowerCase().endsWith(".zip"));
}

/**
 * @param message    the element failures are reported into.
 * @param knownTasks Map of task id -> suite, used to mark a detected id as unrecognised.
 * @param onFile     (file, taskIds) => void — the file chosen and what the zip declared.
 *                   Called with `(null, [])` when the file is removed, so one handler covers
 *                   both directions.
 */
function createUploadSection({ message, knownTasks, onFile }) {
  const elements = getElements();

  function isKnownTask(taskId) {
    return knownTasks.size === 0 || knownTasks.has(taskId);
  }

  function renderDetectedTasks(taskIds) {
    const pills = taskIds
      .map(taskId => `
        <span class="badge ${isKnownTask(taskId) ? "success" : "error"}">
          ${escapeHtml(taskId)}
        </span>
      `)
      .join("");

    elements.taskInfo.hidden = false;
    elements.taskInfo.className = "card";

    elements.taskInfo.innerHTML = `
      <div class="column gap-md">
        <div class="info-msg">
          Detected ${taskIds.length} task${taskIds.length === 1 ? "" : "s"} in this file
        </div>

        <div class="row left gap-sm">
          ${pills}
        </div>
      </div>
    `;
  }

  function showSelectedFile(file) {
    elements.dropzone.hidden = true;
    elements.fileInfo.hidden = false;

    elements.fileName.textContent = file.name;
    elements.fileSize.textContent = formatBytes(file.size);
  }

  function showDropzone() {
    // Reset the native input as well, otherwise selecting the same file again would not
    // fire a change event.
    elements.fileInput.value = "";

    elements.dropzone.hidden = false;
    elements.fileInfo.hidden = true;
    elements.taskInfo.hidden = true;
  }

  async function processFile(file) {
    if (!isValidZip(file)) {
      showError(message, "That isn't a .zip file.");
      return;
    }

    showMessage(message, "");
    showSelectedFile(file);

    let taskIds = [];

    try {
      taskIds = inferTasks(await listZipEntries(file));
      renderDetectedTasks(taskIds);
    } catch (error) {
      console.error(error);

      showError(
        message,
        `Could not read the zip (${error.message}). Check the file and upload it again.`,
      );
    }

    onFile(file, taskIds);
  }

  function removeFile() {
    showDropzone();
    onFile(null, []);
  }

  function attach() {
    elements.fileInput.addEventListener("change", () => {
      const file = elements.fileInput.files[0];

      if (file) processFile(file);
    });

    elements.dropzone.addEventListener("drop", event => {
      event.preventDefault();

      const file = event.dataTransfer.files[0];

      if (file) processFile(file);
    });

    elements.fileRemove.addEventListener("click", removeFile);

    elements.dropzone.addEventListener("click", () => elements.fileInput.click());

    for (const name of ["dragenter", "dragover"]) {
      elements.dropzone.addEventListener(name, event => {
        event.preventDefault();
        elements.dropzone.classList.add("active");
      });
    }

    for (const name of ["dragleave", "dragend", "drop"]) {
      elements.dropzone.addEventListener(name, () => {
        elements.dropzone.classList.remove("active");
      });
    }
  }

  return { attach };
}


export { buildUploadPanel, createUploadSection };

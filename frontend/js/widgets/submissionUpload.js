// The upload panel of the submission form.
//
// Owns the file: a dropzone, the selected file's name and size, the transfer, and the
// tasks the server found in it. The verdict on the file is submissionValidation.js's, and
// renders below this panel's own markup.
//
// The sequence a chosen file goes through, and the reason panel 4 does not wait for it:
//
//   read the zip's directory → prevalidate → create the submission → send the parts →
//   complete → the server starts validating
//
// Prevalidation answers before a byte is sent, so the task list reaches panel 4 in about
// the time a round trip takes.

import { formatBytes } from "../core/utils.js";
import { escapeHtml } from "../core/html.js";
import {
  completeUpload,
  createSubmission,
  deleteSubmission,
  getUpload,
  prevalidateEntries,
} from "../api/submissionApi.js";
import { createUpload } from "../api/upload.js";
import { buildFailureMessage, buildInfoMessage } from "../components/messages.js";
import { clearContent, renderHtml } from "../core/render.js";
import { REQUIRED_MARKER } from "../forms/fields.js";
import { listZipEntries } from "../core/zip.js";
import {
  buildValidationCodes,
  buildValidationPanel,
  createValidationSection,
} from "./submissionValidation.js";

// ─── BUILDERS ────────────────────────────────────────────────────────────────

function buildUploadPanel() {
  return `
    <div class="card secondary column gap-lg">
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

      <div class="card secondary row" id="file-info" hidden>
        <div class="column gap-xs">
          <span class="text-lg bold" id="file-name"></span>
          <span class="text-sm muted" id="file-size"></span>
        </div>

        <button type="button" class="btn" id="file-remove">
          Delete
        </button>
      </div>

      <progress id="file-progress" max="100" value="0" hidden></progress>

      <!-- Beside the file card rather than replacing it: a rejected file leaves the
           dropzone up to try again, and the card's own name/size/Delete markup has to
           survive for the next valid one. -->
      <div id="file-message" hidden></div>

      <div id="task-info" hidden></div>

      ${buildValidationPanel()}
    </div>
  `;
}

function buildDetectedTasks(taskIds) {
  const pills = taskIds
    .map((taskId) => `<span class="badge success">${escapeHtml(taskId)}</span>`)
    .join("");

  const label = taskIds.length === 1 ? "task" : "tasks";

  return `
    <div class="column gap-lg">
      <div class="info-msg">
        Detected ${taskIds.length} ${label} in this file
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
    fileProgress: document.getElementById("file-progress"),
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
 * The upload panel: one file, from the picker to a submission the server is checking.
 *
 * @param state      the form state, read for the panel 1-2 fields a submission is created
 *                   from. Read at upload time, so late edits are the ones sent.
 * @param onTasks    (taskIds) => void, with what prevalidation found in the file. Called
 *                   with `[]` when the file is removed.
 * @param onUploaded (uploaded) => void, as the file finishes arriving or stops having
 *                   arrived. What opens the tasks panel.
 * @param onVerdict  (state) => void, as validation reports. Omit for none.
 *
 * @returns `{ attach, submissionId }`. `submissionId()` is the created submission, or null
 *          before there is one.
 */
function createUploadSection({ state, onTasks, onUploaded, onVerdict }) {
  const elements = getElements();
  const validation = createValidationSection({ onVerdict });

  let submissionId = null;
  let transfer = null;

  // ─── RENDERING ─────────────────────────────────────────────────────────────

  function renderDetectedTasks(taskIds) {
    elements.taskInfo.hidden = false;
    elements.taskInfo.className = "card";
    elements.taskInfo.innerHTML = buildDetectedTasks(taskIds);
  }

  function renderFailure(message, error) {
    renderHtml(elements.fileMessage, buildFailureMessage(message, error), {
      show: true,
    });
  }

  function renderCodes(errors, nFiles) {
    renderHtml(elements.fileMessage, buildValidationCodes(errors, nFiles), {
      show: true,
    });
  }

  function renderProgress({ bytes, total }) {
    elements.fileProgress.hidden = false;
    elements.fileProgress.value = Math.round((bytes / total) * 100);
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
    elements.fileProgress.hidden = true;
    elements.fileProgress.value = 0;
  }

  // ─── SEQUENCE ──────────────────────────────────────────────────────────────

  // Signatures are re-signed against the submission rather than minted afresh: the upload
  // in S3 is the one being resumed, and only it knows which parts are already there.
  function resignFor(id) {
    return async (partNumbers) => (await getUpload(id, partNumbers)).part_urls;
  }

  async function sendFile(file) {
    const created = await createSubmission(state, file.size);
    submissionId = created.submission_id;

    renderHtml(elements.fileMessage, buildInfoMessage("Uploading…"), {
      show: true,
    });

    transfer = createUpload({
      file,
      partSize: created.part_size,
      partCount: created.part_count,
      partUrls: created.part_urls,
      uploaded: created.uploaded,

      resign: resignFor(submissionId),
      onProgress: renderProgress,
    });

    const parts = await transfer.send();

    await completeUpload(submissionId, parts);

    clearContent(elements.fileMessage, { hide: true });
    onUploaded(true);

    validation.watch(submissionId);
  }

  async function processFile(file) {
    if (!isValidZip(file)) {
      renderFailure(`${file?.name ?? "That file"} is not a .zip file.`);

      return;
    }

    clearContent(elements.fileMessage, { hide: true });
    showSelectedFile(file);

    let checked;

    try {
      checked = await prevalidateEntries(await listZipEntries(file), state.is_deterministic);
    } catch (error) {
      console.error(error);
      renderFailure("That .zip could not be read. Check the file and upload it again.", error);
      onTasks([]);

      return;
    }

    if (!checked.ok) {
      renderCodes(checked.errors, checked.n_files);
      onTasks([]);

      return;
    }

    renderDetectedTasks(checked.tasks);
    onTasks(checked.tasks);

    try {
      await sendFile(file);
    } catch (error) {
      console.error(error);
      renderFailure("Uploading the file failed. Select it again to retry.", error);
      onUploaded(false);
    }
  }

  // ─── EVENTS ────────────────────────────────────────────────────────────────

  // The submission goes with the file, whether its parts are still arriving or its object
  // has been assembled and checked. Without this, choosing a different file of the same size
  // would resume the abandoned upload rather than replace it — the parts already in S3
  // belong to the old file, and S3 cannot tell.
  async function removeFile() {
    transfer?.abort();
    validation.stop();

    const abandoned = submissionId;
    submissionId = null;

    showDropzone();

    onTasks([]);
    onUploaded(false);
    onVerdict?.(null);

    if (!abandoned) return;

    try {
      await deleteSubmission(abandoned);
    } catch (error) {
      console.error(error);
      renderFailure("That file could not be discarded. Reload and try again.", error);
    }
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
    validation.attach();

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

  return { attach, submissionId: () => submissionId };
}

export { buildUploadPanel, createUploadSection };

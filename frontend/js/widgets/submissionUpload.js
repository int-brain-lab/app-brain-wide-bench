// The upload panel of the submission form.
//
// Owns the file: the dropzone, the file's own card, the transfer, and the tasks the server
// found in it. The verdict on the file is submissionValidation.js's, and renders in the
// third step below this panel's own markup.
//
// One region per moment, each appearing as the file reaches it: the dropzone, then what the
// layout check found, then the button and what follows it.
//
// The layout check answers before a byte is sent — the zip's own directory listing is read
// here — so the task list reaches the tasks panel while the file is still only chosen. The
// button is the only thing that sends anything, and it waits to be pressed.
//
// Two things are held still. `is_deterministic` decides what step 2 checks, and is locked by
// the page from the moment a file is held. The Delete button is locked from the moment the
// transfer starts until a verdict arrives.

import { clearContent, renderHtml, setText } from "../core/render.js";
import { suiteFromTask, suiteLabel, taskLabel } from "../core/suites.js";
import { formatBytes } from "../core/utils.js";
import { listZipEntries } from "../core/zip.js";
import {
  completeUpload,
  createSubmission,
  deleteSubmission,
  getUpload,
  prevalidateEntries,
} from "../api/submissionApi.js";
import { createUpload } from "../api/upload.js";
import { REQUIRED_MARKER } from "../forms/fields.js";
import { buildTaskBadge } from "../components/badges.js";
import { buildButton } from "../components/buttons.js";
import { buildCount } from "../components/count.js";
import { buildIcon, getIcon } from "../components/icons.js";
import { buildStateNote } from "../components/messages.js";
import {
  buildValidationCodes,
  buildValidationPanel,
  createValidationSection,
} from "./submissionValidation.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const UPLOAD_LABEL = "Upload file for validation";

const WAIT_NOTE = "Please fill out the rest of the form while we upload and validate your file";

const DELETE_LOCK = "The file cannot be discarded until the validation check has finished.";

// What the file's own badge says at each stage. `uploading` gains its percentage as the
// parts go.
const FILE_STATUS = {
  checking: { kind: "pending", text: "Checking layout" },
  unreadable: { kind: "error", text: "Could not be read" },
  rejected: { kind: "error", text: "Incorrect folder tree" },
  ready: { kind: "neutral", text: "Pre-validated folder" },
  uploading: { kind: "pending", text: "Uploading" },
  validating: { kind: "pending", text: "Validating" },
  passed: { kind: "success", text: "Validated" },
  failed: { kind: "error", text: "Failed validation" },
  stalled: { kind: "neutral", text: "Check interrupted" },
};

// The second line of the wait. The first never changes: what the submitter should do is the
// same whichever half of it we are in.
const WAIT_DETAIL = {
  uploading: "You can keep working while it goes.",
  validating: "Your file is on the server. We are reading every prediction in it.",
};

// ─── BUILDERS ────────────────────────────────────────────────────────────────

function buildFileCard() {
  return `
    <div class="file-card" id="file-info" hidden>
      <div class="file-main">
        <span class="file-icon">${buildIcon("file")}</span>

        <span class="file-text">
          <span class="file-name" id="file-name"></span>
          <span class="file-meta" id="file-size"></span>
        </span>

        <span class="file-actions">
          <span class="badge" id="file-status" hidden></span>

          <!-- A disabled button takes no pointer events, so its hover text hangs here. -->
          <span id="file-remove-lock">
            ${buildButton({ id: "file-remove", label: "Delete", icon: getIcon("delete") })}
          </span>
        </span>
      </div>

      <div class="file-progress" id="file-progress" hidden><i id="file-progress-fill"></i></div>
    </div>
  `;
}

function buildUploadPanel() {
  return `
    <div class="card secondary column gap-lg">
      <!-- The page draws is_deterministic here: it decides what the layout check below looks
           for, so it is answered before the file is chosen and locked once one is. -->
      <div class="upload-fields" data-panel-fields></div>

      <div class="column gap-md">
        <!-- Not a schema field, so it has no label of its own — but it is required, and the
             panel reads as optional without the marker. -->
        <label class="field-label">Choose your file${REQUIRED_MARKER}</label>

        <div class="dropzone" id="dropzone">
          <input
            type="file"
            id="file-input"
            accept=".zip,application/zip"
            hidden
          />
          <p class="dropzone-label">A <code>.zip</code> of your predictions folder</p>
        </div>

        ${buildFileCard()}

        <!-- Beside the card rather than replacing it: a refused file leaves the dropzone up to
             try again, and the card's own markup has to survive for the next valid one. -->
        <div id="file-message" hidden></div>
      </div>

      <div id="check-state" hidden></div>

      <div class="row left gap-lg" id="send-action" hidden>
        ${buildButton({
          id: "file-upload",
          label: UPLOAD_LABEL,
          icon: getIcon("submit"),
          className: "primary",
        })}

        <span class="metadata" id="file-reassure"></span>
      </div>

      <div id="file-note" hidden>
        ${buildStateNote({ line: WAIT_NOTE, detailId: "file-note-detail", spinner: true })}
      </div>

      <div id="send-message" hidden></div>

      ${buildValidationPanel()}
    </div>
  `;
}

// One badge per task, carrying its suite: the ids arrive suite-ordered, so the row reads in
// suite order without being grouped into one.
function buildDetectedTasks(taskIds) {
  const badges = taskIds
    .map((id) => {
      const suite = suiteFromTask(id);

      return buildTaskBadge(`${suiteLabel(suite)} ${taskLabel(id)}`, suite, "sm");
    })
    .join("");

  return `
    <div class="column gap-md">
      <span class="field-label">${buildCount(taskIds.length, "task")} found in this file</span>

      <span class="row left gap-sm">${badges}</span>
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
    fileStatus: document.getElementById("file-status"),
    fileRemove: document.getElementById("file-remove"),
    fileRemoveLock: document.getElementById("file-remove-lock"),
    fileProgress: document.getElementById("file-progress"),
    fileProgressFill: document.getElementById("file-progress-fill"),
    fileMessage: document.getElementById("file-message"),

    checkState: document.getElementById("check-state"),

    sendAction: document.getElementById("send-action"),
    fileUpload: document.getElementById("file-upload"),
    fileReassure: document.getElementById("file-reassure"),
    fileNote: document.getElementById("file-note"),
    fileNoteDetail: document.getElementById("file-note-detail"),
    sendMessage: document.getElementById("send-message"),
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
 * @param state     the form state, read for the identity fields a submission is created
 *                  from. Read when the button is pressed, so late edits are the ones sent.
 * @param onFile    (held) => void, as a file is chosen or removed. What locks
 *                  `is_deterministic`, which the layout check has already run under.
 * @param onTasks   (taskIds) => void, with what the layout check found. Called with `[]`
 *                  when the file is refused or removed. What opens the tasks panel.
 * @param onVerdict (state) => void, as validation reports. Omit for none.
 *
 * @returns `{ attach, submissionId }`. `submissionId()` is the created submission, or null
 *          before there is one.
 */
function createUploadSection({ state, onFile, onTasks, onVerdict }) {
  const elements = getElements();

  // `handleVerdict` is hoisted: which stage a verdict puts the panel in is this panel's
  // answer, not the validation section's.
  const validation = createValidationSection({ onVerdict: handleVerdict });

  let file = null;
  let submissionId = null;
  let transfer = null;

  // ─── STAGE ─────────────────────────────────────────────────────────────────

  // Every visible difference between one moment and the next, in one place: the card, its
  // badge, both locks, the button and the wait all answer to the same word.
  function setStage(stage) {
    const inFlight = stage === "uploading" || stage === "validating";
    const status = FILE_STATUS[stage];

    elements.dropzone.hidden = stage !== "empty";
    elements.fileInfo.hidden = stage === "empty";

    elements.fileStatus.hidden = !status;

    if (status) {
      elements.fileStatus.className = `badge ${status.kind}`;
      setText(elements.fileStatus, status.text);
    }

    elements.fileRemove.disabled = inFlight;
    elements.fileRemoveLock.title = inFlight ? DELETE_LOCK : "";

    elements.fileProgress.hidden = stage !== "uploading";

    elements.sendAction.hidden = stage !== "ready";
    elements.fileNote.hidden = !inFlight;

    if (inFlight) {
      setText(elements.fileNoteDetail, WAIT_DETAIL[stage]);
    }
  }

  // ─── RENDERING ─────────────────────────────────────────────────────────────

  // The archive is being read here, not sent: a wait with nothing to report but itself.
  function renderReading() {
    renderHtml(
      elements.checkState,
      buildStateNote({
        tone: "quiet",
        spinner: true,
        line: "Reading the archive's file list…",
        detail: "This runs in your browser, and takes about a second.",
      }),
      { show: true },
    );
  }

  function renderDetectedTasks(taskIds) {
    renderHtml(elements.checkState, buildDetectedTasks(taskIds), { show: true });
  }

  function renderCodes(errors, nFiles) {
    renderHtml(
      elements.checkState,
      buildValidationCodes(errors, { title: "This file cannot be uploaded yet", nFiles }),
      { show: true },
    );
  }

  // The line is what happened; the detail is what to do about it, with whatever the server
  // said after it.
  function renderFailure(container, line, detail, error) {
    renderHtml(
      container,
      buildStateNote({
        tone: "failed",
        icon: "error",
        line,
        detail: [detail, error?.message].filter(Boolean).join(" "),
      }),
      { show: true },
    );
  }

  function renderProgress({ bytes, total }) {
    const percent = Math.round((bytes / total) * 100);

    elements.fileProgressFill.style.width = `${percent}%`;
    setText(elements.fileStatus, `Uploading ${percent}%`);
  }

  function showSelectedFile(chosen) {
    setText(elements.fileName, chosen.name);
    setText(elements.fileSize, formatBytes(chosen.size));

    setText(
      elements.fileReassure,
      `Nothing has left your browser yet — ${formatBytes(chosen.size)} to send.`,
    );
  }

  // What the check found, on the file's own line: its size and its contents are one fact.
  function showChecked(chosen, nFiles) {
    setText(
      elements.fileSize,
      `${formatBytes(chosen.size)} · ${buildCount(nFiles, "prediction file")}`,
    );
  }

  function clearPanel() {
    // Reset the native input so selecting the same file again fires `change`.
    elements.fileInput.value = "";

    elements.fileProgressFill.style.width = "0%";

    clearContent(elements.fileMessage, { hide: true });
    clearContent(elements.checkState, { hide: true });
    clearContent(elements.sendMessage, { hide: true });
  }

  // ─── SEQUENCE ──────────────────────────────────────────────────────────────

  // Signatures are re-signed against the submission rather than minted afresh: the upload in
  // S3 is the one being resumed, and only it knows which parts are already there.
  function resignFor(id) {
    return async (partNumbers) => (await getUpload(id, partNumbers)).part_urls;
  }

  async function sendFile() {
    const created = await createSubmission(state, file.size);
    submissionId = created.submission_id;

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

    validation.watch(submissionId);
  }

  async function checkFile(chosen) {
    if (!isValidZip(chosen)) {
      renderFailure(
        elements.fileMessage,
        `${chosen?.name ?? "That file"} is not a .zip file`,
        "A submission is one archive of your predictions folder.",
      );

      return;
    }

    clearPanel();

    file = chosen;
    showSelectedFile(chosen);
    onFile(true);

    setStage("checking");
    renderReading();

    let checked;

    try {
      checked = await prevalidateEntries(await listZipEntries(chosen), state.is_deterministic);
    } catch (error) {
      console.error(error);
      renderFailure(
        elements.checkState,
        "That .zip could not be read",
        "Check the file and add it again.",
        error,
      );
      setStage("unreadable");
      onTasks([]);

      return;
    }

    if (!checked.ok) {
      renderCodes(checked.errors, checked.n_files);
      setStage("rejected");
      onTasks([]);

      return;
    }

    showChecked(chosen, checked.n_files);
    renderDetectedTasks(checked.tasks);
    setStage("ready");
    onTasks(checked.tasks);
  }

  // ─── EVENTS ────────────────────────────────────────────────────────────────

  // The submission goes with the file, whether its parts are still arriving or its object has
  // been assembled and checked. Without this, choosing a different file of the same size would
  // resume the abandoned upload rather than replace it — the parts already in S3 belong to the
  // old file, and S3 cannot tell.
  async function removeFile() {
    transfer?.abort();
    validation.stop();

    const abandoned = submissionId;

    file = null;
    submissionId = null;

    clearPanel();
    setStage("empty");

    onFile(false);
    onTasks([]);
    onVerdict?.(null);

    if (!abandoned) return;

    try {
      await deleteSubmission(abandoned);
    } catch (error) {
      console.error(error);

      renderFailure(
        elements.fileMessage,
        "That file could not be discarded",
        "Reload the page and try again.",
        error,
      );
    }
  }

  // The only control that sends anything. A failed transfer offers itself again rather than
  // sending the submitter back to the dropzone: the file is still held, and the submission it
  // created is resumed by the next attempt.
  async function handleUploadClick() {
    if (!file) return;

    clearContent(elements.sendMessage, { hide: true });
    setStage("uploading");

    try {
      await sendFile();
    } catch (error) {
      console.error(error);

      renderFailure(
        elements.sendMessage,
        "Uploading the file failed",
        "Press the button again to pick up where it left off.",
        error,
      );
      setStage("ready");
    }
  }

  // Validating is the second half of the wait the Delete button is held through, and a verdict
  // of any kind ends it. Null is a wait given up on, which is not a failed file.
  function handleVerdict(verdict) {
    if (verdict === "validating") {
      setStage("validating");
    } else if (verdict === "pending") {
      setStage("passed");
    } else if (verdict == null) {
      setStage("stalled");
    } else {
      setStage("failed");
    }

    onVerdict?.(verdict);
  }

  function handleFileChange() {
    const chosen = elements.fileInput.files[0];

    if (chosen) {
      checkFile(chosen);
    }
  }

  function handleDrop(event) {
    event.preventDefault();

    const chosen = event.dataTransfer.files[0];

    if (chosen) {
      checkFile(chosen);
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

    elements.fileUpload.addEventListener("click", handleUploadClick);

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

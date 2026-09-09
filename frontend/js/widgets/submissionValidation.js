// The validation state of a submission's uploaded file, inside the upload panel.
//
// Owns the verdict display and the polling that waits for it. Knows nothing about the
// transfer that produced the file — submissionUpload.js owns that, and tells this widget
// which submission to watch once there is one.

import { escapeHtml } from "../core/html.js";
import { getValidation } from "../api/submissionApi.js";
import {
  buildFailureMessage,
  buildInfoMessage,
  buildSuccessMessage,
} from "../components/messages.js";
import { clearContent, renderHtml } from "../core/render.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const POLL_MS = 2500;

// A validating file is being downloaded, extracted and read on the server, so the wait
// grows with its size. Backing off keeps a 10 GB submission from costing hundreds of polls.
const MAX_POLL_MS = 15000;
const BACKOFF = 1.5;

const VALIDATION_ID = "validation-state";

// ─── BUILDERS ────────────────────────────────────────────────────────────────

function buildValidationPanel() {
  return `<div id="${VALIDATION_ID}" hidden></div>`;
}

// Shared with submissionUpload.js: a prevalidation refusal and a validation verdict carry
// the same shape, and read the same way to a submitter.
//
// `nFiles` is 0 for an archive holding no predictions at all, which fails with nothing to
// fault — a heading over an empty list otherwise.
function buildValidationCodes(errors, nFiles = null) {
  if (nFiles === 0) {
    return buildFailureMessage(
      "This file contains no prediction files in the expected layout.",
    );
  }

  const items = errors
    .map(
      (error) => `
        <li>
          <span class="badge error">${escapeHtml(error.code)}</span>
          ${escapeHtml(error.message)}
        </li>
      `,
    )
    .join("");

  return `
    <div class="column gap-sm">
      <p class="bold">This file cannot be submitted:</p>
      <ul class="column gap-xs">${items}</ul>
      <p class="text-sm muted">
        Correct the file and upload it again under the same name.
      </p>
    </div>
  `;
}

// ─── CONTROLLER ──────────────────────────────────────────────────────────────

/**
 * The verdict on one submission's file, and the wait for it.
 *
 * @param onVerdict (state) => void, each time the state changes — "validating", "pending"
 *                  for a file that passed, or "invalid". Omit for a caller with nothing
 *                  to update.
 *
 * @returns `{ attach, watch, stop }`. `watch(submissionId)` starts polling; `stop()` ends
 *          it, and is what a caller does when the file is replaced.
 */
function createValidationSection({ onVerdict } = {}) {
  const element = document.getElementById(VALIDATION_ID);

  let submissionId = null;
  let timer = null;
  let delay = POLL_MS;

  // ─── RENDERING ─────────────────────────────────────────────────────────────

  function renderValidating() {
    renderHtml(element, buildInfoMessage("Checking the file…"), { show: true });
  }

  function renderPassed(validation) {
    const files = validation.n_files;

    renderHtml(
      element,
      buildSuccessMessage(
        `This file is ready to score — ${files} prediction files.`,
      ),
      { show: true },
    );
  }

  // Whose failure it was decides what to say. ``unchecked`` means the file was never read,
  // so nothing about it can be reported — and its document carries no file count, which
  // would otherwise read as an empty archive.
  function renderFailed(validation) {
    if (validation.state === "unchecked") {
      renderHtml(
        element,
        buildFailureMessage(
          "We could not check this file. As far as we know nothing is wrong with it — please contact us.",
        ),
        { show: true },
      );

      return;
    }

    renderHtml(
      element,
      buildValidationCodes(validation.errors, validation.n_files),
      { show: true },
    );
  }

  function renderUnavailable(error) {
    renderHtml(
      element,
      buildFailureMessage(
        "Checking the file failed — reload to see where it got to.",
        error,
      ),
      { show: true },
    );
  }

  // ─── POLLING ───────────────────────────────────────────────────────────────

  function schedule() {
    delay = Math.min(delay * BACKOFF, MAX_POLL_MS);
    timer = setTimeout(poll, delay);
  }

  async function poll() {
    if (!submissionId) return;

    let validation;

    try {
      validation = await getValidation(submissionId);
    } catch (error) {
      console.error(error);
      renderUnavailable(error);

      return;
    }

    // A verdict arriving late for a file that has since been replaced is not this
    // submission's answer any more.
    if (!submissionId) return;

    if (validation.state === "validating") {
      schedule();
    } else if (validation.state === "pending") {
      renderPassed(validation);
    } else {
      renderFailed(validation);
    }

    onVerdict?.(validation.state);
  }

  // ─── EVENTS ────────────────────────────────────────────────────────────────

  // A tab left in the background is throttled, so the answer may have arrived while it was
  // away rather than at the next scheduled poll.
  function handleFocus() {
    if (submissionId && timer) {
      clearTimeout(timer);
      delay = POLL_MS;
      poll();
    }
  }

  function attach() {
    window.addEventListener("focus", handleFocus);
  }

  // ─── CONTROLS ──────────────────────────────────────────────────────────────

  function watch(id) {
    submissionId = id;
    delay = POLL_MS;

    renderValidating();
    onVerdict?.("validating");

    timer = setTimeout(poll, delay);
  }

  function stop() {
    submissionId = null;
    clearTimeout(timer);
    timer = null;

    clearContent(element, { hide: true });
  }

  return { attach, watch, stop };
}

export { buildValidationCodes, buildValidationPanel, createValidationSection };

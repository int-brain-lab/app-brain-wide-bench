// The validation state of a submission's uploaded file, inside the upload panel.
//
// Owns the verdict display and the polling that waits for it. Knows nothing about the
// transfer that produced the file — submissionUpload.js owns that, and tells this widget
// which submission to watch once there is one.

import { escapeHtml } from "../core/html.js";
import { getValidation } from "../api/submissionApi.js";
import { buildCount } from "../components/count.js";
import { buildStateNote } from "../components/messages.js";
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

// The first error of each code, in the order the codes first appear. One bad tensor across
// 500 files is 500 findings of one code, and the second says nothing the first did not.
function toUniqueCodes(errors) {
  const byCode = new Map();

  for (const error of errors) {
    if (!byCode.has(error.code)) {
      byCode.set(error.code, error);
    }
  }

  return [...byCode.values()];
}

/**
 * A refusal, as a state note whose body is its codes. Shared with submissionUpload.js: a
 * prevalidation refusal and a validation verdict read the same way to a submitter.
 *
 * One row per code — repeats say nothing new. A code marked `generic` carries the shared
 * fallback text rather than its own, so it shows without a message and that text stands
 * once underneath.
 *
 * @param errors the findings, as many per code as the run produced.
 * @param title  the heading. Omit for the verdict's own.
 * @param nFiles predictions found. 0 is an archive holding none at all, which fails with
 *               nothing to fault — a heading over an empty list otherwise.
 */
function buildValidationCodes(errors, { title = "This file cannot be submitted", nFiles } = {}) {
  if (nFiles === 0) {
    return buildStateNote({
      tone: "failed",
      icon: "error",
      line: "This file holds no predictions",
      detail: "Nothing in it is laid out the way a predictions folder is.",
    });
  }

  const codes = toUniqueCodes(errors);

  const items = codes
    .map(
      (error) => `
        <li>
          <span class="badge error">${escapeHtml(error.code)}</span>
          <span class="${error.generic ? "no-detail" : ""}">
            ${error.generic ? "no detail we can share" : escapeHtml(error.message)}
          </span>
        </li>
      `,
    )
    .join("");

  const generic = codes.find((error) => error.generic)?.message ?? "";

  // Only where the two differ: with one finding per code the tally says nothing.
  const repeats = errors.length > codes.length ? `, found ${errors.length} times in total` : "";

  return buildStateNote({
    tone: "failed",
    icon: "error",
    line: title,
    detail: `${buildCount(codes.length, "kind")} of problem${repeats}.`,

    body: `
      <ul class="code-list">${items}</ul>

      <div class="what-to-do">
        ${generic ? `<span><b>What to do.</b> ${escapeHtml(generic)}</span>` : ""}
        <span>Delete the file, correct it, and add it again under the same name.</span>
      </div>
    `,
  });
}

// ─── CONTROLLER ──────────────────────────────────────────────────────────────

/**
 * The verdict on one submission's file, and the wait for it.
 *
 * @param onVerdict (state) => void, each time the state changes — "validating", "pending"
 *                  for a file that passed, or "invalid". Null where the wait was given up
 *                  and no verdict is coming. Omit for a caller with nothing to update.
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

  // "Create submission" is the label templates/createPage.js gives the button at the foot of
  // the form this sits in.
  function renderPassed({ n_files: files, tasks }) {
    renderHtml(
      element,
      buildStateNote({
        tone: "done",
        icon: "tick",
        line: "Folder successfully uploaded and validated",
        detail:
          `${buildCount(files, "prediction file")} across ${buildCount(tasks.length, "task")}. ` +
          `Fill in the rest of the form, then press Create submission to start scoring.`,
      }),
      { show: true, refresh: true },
    );
  }

  // Whose failure it was decides what to say. ``unchecked`` means the file was never read,
  // so nothing about it can be reported — and its document carries no file count, which
  // would otherwise read as an empty archive.
  function renderFailed(validation) {
    if (validation.state === "unchecked") {
      renderHtml(
        element,
        buildStateNote({
          tone: "failed",
          icon: "error",
          line: "We could not check this file",
          detail:
            "As far as we know nothing is wrong with it — the check itself did not finish. " +
            "Please contact us.",
        }),
        { show: true, refresh: true },
      );

      return;
    }

    renderHtml(element, buildValidationCodes(validation.errors, { nFiles: validation.n_files }), {
      show: true,
    });
  }

  function renderUnavailable(error) {
    renderHtml(
      element,
      buildStateNote({
        tone: "failed",
        icon: "error",
        line: "Checking the file failed",
        detail: ["Reload the page to see where it got to.", error?.message]
          .filter(Boolean)
          .join(" "),
      }),
      { show: true, refresh: true },
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

      // Polling stops here, so there is no verdict coming: a caller waiting on one is told.
      onVerdict?.(null);

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

    // The panel's own wait note covers this half of the wait; this slot holds verdicts.
    clearContent(element, { hide: true });
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

// Generic multi-step wizard: progress stepper, panel switching, and
// Back/Next/Submit navigation gating. Shared by every `*-wizard.js` module
// (submissions, model-create, ...), which only differ in their step labels
// and per-step validity rules — all of them rely on the same DOM convention:
// `#wizard-progress`, `#wizard-back`/`#wizard-next`/`#wizard-submit`, and
// `.wizard-panel[data-step]` panels, scoped under `root` (default `document`).

function renderStep(label, step) {
  return `
    <li class="wizard-step" data-step="${step}">
      <span class="wizard-step-icon"></span>
      <span class="wizard-step-label">
        ${label}
      </span>
    </li>
  `;
}

/**
 * @param steps        string[] — step labels, in order (1-based step numbers).
 * @param canAdvance   (step: number) => boolean — whether `step`'s panel is valid.
 * @param onStepChange optional (step: number) => void, called after navigating
 *                     to `step` — e.g. rendering a review summary on the last step.
 * @param root         Element|Document — scopes every DOM lookup, so more than
 *                     one wizard can coexist on a page. Defaults to `document`.
 */
function createWizard({ steps, canAdvance, onStepChange, root = document }) {
  let currentStep = 1;

  function wizardBack() {
    return root.querySelector("#wizard-back");
  }

  function wizardNext() {
    return root.querySelector("#wizard-next");
  }

  function wizardSubmit() {
    return root.querySelector("#wizard-submit");
  }

  function wizardProgress() {
    return root.querySelector("#wizard-progress");
  }

  function wizardSteps() {
    return wizardProgress().querySelectorAll(".wizard-step");
  }

  function wizardPanels() {
    return root.querySelectorAll(".wizard-panel");
  }

  function getStepState(step) {
    if (step < currentStep) return "done";
    if (step === currentStep) return "current";
    return "pending";
  }

  function renderProgress() {
    wizardProgress().innerHTML = steps
      .map((label, index) => renderStep(label, index + 1))
      .join("");
  }

  function updateProgress() {
    wizardSteps().forEach(li => {
      const step = Number(li.dataset.step);
      const status = getStepState(step);

      li.classList.remove("done", "current", "pending");
      li.classList.add(status);

      li.querySelector(".wizard-step-icon").textContent =
        status === "done" ? "✓" : step;
    });
  }

  function updatePanel() {
    wizardPanels().forEach(panel => {
      panel.hidden = Number(panel.dataset.step) !== currentStep;
    });
  }

  function updateNavigation() {
    const isLastStep = currentStep === steps.length;

    wizardBack().disabled = currentStep === 1;

    wizardNext().hidden = isLastStep;
    wizardNext().disabled = !canAdvance(currentStep);

    wizardSubmit().hidden = !isLastStep;
    wizardSubmit().disabled = isLastStep && !canAdvance(currentStep);
  }

  function goToStep(step) {
    currentStep = Math.min(Math.max(step, 1), steps.length);

    updatePanel();
    updateProgress();
    updateNavigation();

    onStepChange?.(currentStep);
  }

  function attachProgressEvents() {
    wizardSteps().forEach(li => {
      const step = Number(li.dataset.step);

      li.addEventListener("click", () => {
        if (li.classList.contains("done")) goToStep(step);
      });
    });
  }

  function attachNavigationEvents() {
    wizardNext().addEventListener("click", () => {
      if (canAdvance(currentStep)) goToStep(currentStep + 1);
    });

    wizardBack().addEventListener("click", () => {
      goToStep(currentStep - 1);
    });
  }

  function initialise() {
    renderProgress();
    attachProgressEvents();
    attachNavigationEvents();
    goToStep(1);
  }

  return { initialise, updateNavigation, goToStep };
}

export { createWizard };

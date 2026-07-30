import { createWizard } from "../../wizard.js";
import {
  attachFieldEvents,
  createFieldState,
} from "../../utils/form-fields.js";

import { MODEL_FIELDS, loadModelFields } from "../schema.js";
import { createModel } from "../api.js";
import { isAuthenticated } from "../../api.js";

import {
  formElement,
  onSubmit,
  renderForm,
  setSubmitEnabled,
  showError,
  showGate,
} from "./create-view.js";

const WIZARD_STEPS = [
  "Name & team",
  "Links & publication",
  "Parameters",
];

async function initialise() {
  try {
    if (!(await isAuthenticated())) {
      showGate(false);
      return;
    }

    showGate(true);

    const fields = await loadModelFields();
    const state = createFieldState(fields);

    renderForm(state, fields);

    const wizard = createWizard({
      root: formElement(),
      steps: WIZARD_STEPS,
      canAdvance: step => canAdvance(step, state),
    });

    wizard.initialise();

    // MODEL_FIELDS has no disabledWhen/disabledOptionsWhen rules today, so
    // `cleared` is always empty — this is here so adding one doesn't leave a
    // stale value on screen with no explanation.
    attachFieldEvents(
      formElement(),
      state,
      fields,
      (key, value, cleared) => {
        if (cleared.length) {
          const labels = cleared.map(clearedKey => fields[clearedKey].label).join(", ");
          showError(`Cleared (no longer valid): ${labels}`);
          renderForm(state, fields);
        }

        wizard.updateNavigation();
      },
    );

    onSubmit(() => handleSubmit(state, wizard));
  } catch (err) {
    console.error("Failed to initialise create page:", err);
  }
}

function canAdvance(step, state) {
  switch (step) {
    case 1:
      return state.name.trim() !== "" && state.team_id != null;

    default:
      return true;
  }
}

async function handleSubmit(state, wizard) {
  setSubmitEnabled(false);

  try {
    const model = await createModel(state);

    window.location.href = `model_details.html?id=${encodeURIComponent(model.id)}`;
  } catch (err) {
    console.error(err);

    showError(`Failed to create model: ${err.message}`);

    setSubmitEnabled(true);

    wizard.updateNavigation();
  }
}

initialise();
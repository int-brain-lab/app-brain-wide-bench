import { renderFields, fieldsForPanel } from "../utils/form-fields.js";
import { renderMessage } from "../utils.js";

const ELEMENTS = {
  gate: document.getElementById("gate"),
  wizard: document.getElementById("wizard"),

  panels: {
    1: document.getElementById("model-create-name"),
    2: document.getElementById("model-create-links"),
    3: document.getElementById("model-create-parameters"),
  },

  message: document.getElementById("form-message"),
  submit: document.getElementById("wizard-submit"),
};

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

function showError(message) {
  renderMessage(ELEMENTS.message, message);
}

function setSubmitEnabled(enabled) {
  ELEMENTS.submit.disabled = !enabled;
}

function onSubmit(handler) {
  ELEMENTS.submit.addEventListener("click", handler);
}

function formElement() {
  return ELEMENTS.wizard;
}


export {
  formElement,
  onSubmit,
  renderForm,
  setSubmitEnabled,
  showError,
  showGate,
};
// Submission list
//
// A page showing the submissions that the user has created or has access to.
//
// A toggle at the top of the page allows the user to switch between card and table views.
// By default, if the user has less than 6 submissions cards are rendered otherwise a table.


import { getSubmissions } from "./submissionApi.js";
import { buildSubmissionCards} from "../components/cards.js";
import { renderSubmissionsTable } from "./submissionTable.js";
import {
  appendCreateCard,
  clearCreateRow,
  renderCreateRow,
} from "../utils/create-card.js";
import {showError} from "../utils.js";
import { isAuthenticated } from "../api.js";
import { showGate } from "../utils/gate.js";

// ─── CONFIGURATION ──────────────────────────────────────────────────────────

const MAX_CARDS = 6;

const CREATE = {
  href: "/html/submissions/submission_create.html",
  label: "New submission",
};

const VIEWS = {
  "view-cards": renderCards,
  "view-table": renderTable,
};

// ─── DOM ─────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    gate: document.getElementById("gate"),
    list: document.getElementById("submission-list"),
    create: document.getElementById("submission-create"),
    cardsButton: document.getElementById("view-cards"),
    tableButton: document.getElementById("view-table"),
  };
}

// ─── RENDERING ───────────────────────────────────────────────────────────────

function renderTable(elements, submissions) {
  renderSubmissionsTable({
    container: elements.list,
    submissions,
    showModel: true,
  });

  renderCreateRow(elements.create, CREATE);
}

function renderCards(elements, submissions) {
  elements.list.className = "grid-2";
  elements.list.innerHTML = buildSubmissionCards(submissions);

  appendCreateCard(elements.list, CREATE);
  clearCreateRow(elements.create);
}

// ─── VIEW TOGGLE ────────────────────────────────────────────────────────────

function setActiveView(elements, activeId) {
  for (const button of [elements.cardsButton, elements.tableButton]) {
    button?.classList.toggle("primary-inv", button.id === activeId);
  }
}

function renderView(elements, viewId, models) {
  const render = VIEWS[viewId];

  if (!render) {
    console.error(`Unknown model view: ${viewId}`);
    return;
  }

  setActiveView(elements, viewId);
  render(elements, models);
}

function attachViewToggle(elements, models) {
  for (const button of [elements.cardsButton, elements.tableButton]) {
    button?.addEventListener("click", () => {
      renderView(elements, button.id, models);
    });
  }
}

// ─── EMPTY STATE ────────────────────────────────────────────────────────────

function renderEmptyState(elements) {
  elements.list.className = "grid-2";
  elements.list.replaceChildren();

  appendCreateCard(elements.list, CREATE);

  for (const button of [elements.cardsButton, elements.tableButton]) {
    if (button) {
      button.hidden = true;
    }
  }
}

// ─── INITIALISATION ──────────────────────────────────────────────────────────

async function loadSubmissionListPage() {
  const elements = getElements();

  try {
    if (!(await isAuthenticated())) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);


    const submissions = await getSubmissions();

    if (!submissions) {
      showError(
        elements.message,
        "Could not load submissions."
      );
    }

    if (submissions.length === 0) {
      renderEmptyState(elements);
      return;
    }

    const initialView =
      submissions.length <= MAX_CARDS
        ? "view-cards"
        : "view-table";

    renderView(elements, initialView, submissions);
    attachViewToggle(elements, submissions);
  } catch (error) {
    console.error(
      "Failed to load submission list:",
      error,
    );

    showError(
      elements.message,
      "Submission list page could not be loaded.",
    );
  }
}

loadSubmissionListPage();

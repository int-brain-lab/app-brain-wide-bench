// Team list
//
// A page showing the teams that the user has created or has access to.


import { getMyTeams } from "./teamApi.js";
import { buildTeamCards} from "../components/cards.js";
import {appendCreateCard} from "../utils/create-card.js";
import {showError} from "../utils";

// ─── CONFIGURATION ──────────────────────────────────────────────────────────

const CREATE = {
  href: "/html/teams/team_create.html",
  label: "New team" };

// ─── DOM ─────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    list: document.getElementById("teams-list"),
    create: document.getElementById("teams-create"),
  };
}

// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderCards(elements, teams) {

  elements.list.className = 'grid-2'
  elements.list.innerHTML = buildTeamCards(teams);

  appendCreateCard(elements.list, CREATE);
}

// ─── EMPTY STATE ────────────────────────────────────────────────────────────

function renderEmptyState(elements) {
  elements.list.className = "grid-2";
  elements.list.replaceChildren();

  appendCreateCard(elements.list, CREATE);

}

// ─── INITIALISATION ──────────────────────────────────────────────────────────

async function loadTeamListPage() {
  const elements = getElements();

  try {

    const teams = await getMyTeams();

    if (!teams) {
      showError(
        elements.message,
        "Could not load teams."
      );
    }

    if (teams.length === 0) {
      renderEmptyState(elements);
      return;
    }

    renderCards(elements, teams);
  } catch (error) {
    console.error(
      "Failed to load team list:",
      error,
    );

    showError(
      elements.message,
      "Teams list page could not be loaded.",
    );
  }
}

loadTeamListPage();

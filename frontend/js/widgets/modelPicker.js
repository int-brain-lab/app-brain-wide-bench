// The "compare against up to five models" control: a dropdown to add one, and a chip per
// model chosen, each with an × to take it back out.
//
// A dropdown rather than a list of checkboxes because the two halves answer different
// questions. The select is only ever "who else?", so it holds the models *not* yet chosen
// and nothing else; the chips are the answer so far, readable at a glance beside the suite
// they apply to. A checkbox list mixed the two together and grew with the instance.
//
// State lives with the caller, not here: the selection is in the page's URL, so this
// renders whatever it is handed and reports back what was chosen.

import { escapeHtml, refreshIcons, showEmpty } from "../core/utils.js";
import { getIcon } from "../components/icons.js";

const MAX_SELECTED = 5;


// ─── MARKUP ─────────────────────────────────────────────────────────────────

// The team is on the option but not on the chip: it is there to tell two models with the
// same name apart while choosing, and once chosen the chip has to stay narrow enough that
// five of them sit on one line.
function buildOption(candidate) {
  const team = candidate.teamName ? ` — ${escapeHtml(candidate.teamName)}` : "";

  return `<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.name)}${team}</option>`;
}

function buildChip(candidate) {
  return `
    <span class="chip row left gap-sm">
      <span>${escapeHtml(candidate.name)}</span>
      <button
        type="button"
        class="chip-remove"
        data-remove="${escapeHtml(candidate.id)}"
        title="Remove ${escapeHtml(candidate.name)}"
      >
        <i class="field-icon" data-lucide="${getIcon("remove")}"></i>
      </button>
    </span>
  `;
}

// The blank first option doubles as the control's label, the same arrangement the table
// filters use — and it says why the select is closed when it is, rather than greying out
// with no explanation.
function selectLabel({ full, available }) {
  if (full) return `Five models selected — remove one to add another`;
  if (!available) return `No other models left to add`;

  return `Add a model to compare…`;
}

function buildPicker(candidates, selected) {
  const chosen = new Set(selected);
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));

  const available = candidates.filter(candidate => !chosen.has(candidate.id));
  const full = selected.length >= MAX_SELECTED;
  const closed = full || !available.length;

  // Driven off `selected` rather than off `candidates`, so the chips stay in the order the
  // reader added them instead of jumping about as the list behind them changes.
  const chips = selected
    .map(id => byId.get(id))
    .filter(Boolean)
    .map(buildChip)
    .join("");

  return `
    <div class="column gap-md">
      <select class="input-select" data-role="add" ${closed ? "disabled" : ""}>
        <option value="">${escapeHtml(selectLabel({ full, available: available.length }))}</option>
        ${closed ? "" : available.map(buildOption).join("")}
      </select>
      ${chips ? `<div class="row left gap-sm" data-role="chips">${chips}</div>` : ""}
      <p class="metadata">${selected.length} of ${MAX_SELECTED} selected</p>
    </div>
  `;
}


// ─── WIDGET ─────────────────────────────────────────────────────────────────

/**
 * @param container   element, or the id of one. Its contents are replaced.
 * @param candidates  [{id, name, teamName}] — already narrowed to models that have the
 *                    suite, and without the model being compared against.
 * @param selectedIds the ids currently chosen, in the order they were added.
 * @param onChange    (ids) => void, called with the new selection on every add or remove.
 */
function renderModelPicker({ container, candidates, selectedIds, onChange }) {
  if (!candidates.length) {
    showEmpty(container, "No other models have been scored on this suite.");
    return;
  }

  // An id that is no longer a candidate — the suite changed under it — is dropped rather
  // than kept as a chip that names nothing.
  let selected = selectedIds.filter(id => candidates.some(candidate => candidate.id === id));

  // Redrawn whole on every change, which a checkbox list couldn't afford: there is no
  // search text to preserve and no scroll position to keep, and adding a model has to take
  // it out of the select and put it in the chips at the same moment.
  function draw() {
    container.innerHTML = buildPicker(candidates, selected);

    // The chip's × is a `<i data-lucide>` placeholder until this runs.
    refreshIcons();

    container.querySelector("[data-role='add']").addEventListener("change", event => {
      if (!event.target.value) return;

      selected = [...selected, event.target.value];
      change();
    });

    // Delegated, because the chips are replaced on every draw.
    container.querySelector("[data-role='chips']")?.addEventListener("click", event => {
      const button = event.target.closest("[data-remove]");

      if (!button) return;

      selected = selected.filter(id => id !== button.dataset.remove);
      change();
    });
  }

  function change() {
    draw();
    onChange(selected);
  }

  draw();
}


export { renderModelPicker, MAX_SELECTED };

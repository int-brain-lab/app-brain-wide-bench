// Which fields go together, and the cards and grids they sit in.
//
// The layer above render.js: it decides the arrangement and delegates every field to a
// renderer it is handed, which is what lets a read-only view and its edit form share one
// layout definition.

import { escapeHtml } from "../core/utils.js";


function fieldsForPanel(fields, panel, editableOnly=true) {
  return Object.keys(fields)
    .filter(key => fields[key].panel === panel && (!editableOnly || fields[key].editable !== false));
}


// The grid utilities that exist in style.css. A `columns` value with no class
// here (1, undefined, or something nobody wrote a rule for) falls back to the
// card's own single flex column rather than emitting a class that does nothing.
const GRID_CLASS = { 2: "grid-2", 3: "grid-3", 4: "grid-4" };


// Fields arrive as a flat run of sibling divs, so it's the container that decides
// how they flow: one column needs no wrapper (the card is already a flex column),
// more than one needs a grid around them.
function wrapColumns(html, columns) {
  const gridClass = GRID_CLASS[columns];
  return gridClass ? `<div class="${gridClass}">${html}</div>` : html;
}


// Renders one card per group, so a read-only view and its edit form can share a
// single layout definition instead of each hardcoding the same card titles.
//
// Deliberately knows nothing about `panel`: a group is just `{title, keys,
// inline, columns}`, which leaves callers free to group by something else
// entirely. `render` is the per-group field renderer — renderFields for an edit
// form, renderDisplayFields for a read-only view; both take (keys, state,
// fields, inline), so either can be passed straight in.
//
// `columns` lays a group's fields out N-up instead of stacked. Mostly useful on a
// read-only view, where a row is a short label/value pair and one per line wastes
// most of the card's width; inputs and textareas usually want the full width, so
// an edit form tends to override it back to 1 (see panelGroups).
function renderGroups(groups, state, fields, render) {
  return `
    <div class="column gap-lg">
      ${groups.map(group => `
        <div class="card column gap-md">
          ${group.title ? `<p class="title muted">${escapeHtml(group.title)}</p>` : ""}
          ${wrapColumns(render(group.keys, state, fields, group.inline), group.columns)}
        </div>
      `).join("")}
    </div>
  `;
}


// Builds renderGroups' groups from a panel layout — declared alongside the schema
// it describes as [{panel, title, inline, columns}].
//
// `editableOnly` mirrors fieldsForPanel's third argument inverted: false (the
// default) keeps `editable: false` keys, which an edit form still wants as
// read-only context rows. A panel whose keys all filter out is dropped rather
// than rendering an empty card.
//
// `columns`, if given, overrides every panel's own value — this is how one layout
// serves both modes: the display view takes the panels as declared, and the edit
// form passes `{columns: 1}` so inputs get the card's full width.
function panelGroups(fields, panels, { editableOnly = false, columns } = {}) {
  return panels
    .map(({ panel, title, inline, columns: panelColumns }) => ({
      title,
      inline,
      columns: columns ?? panelColumns,
      keys: fieldsForPanel(fields, panel, editableOnly),
    }))
    .filter(group => group.keys.length);
}


export {
  fieldsForPanel,
  panelGroups,
  renderGroups,
};

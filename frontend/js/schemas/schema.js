// Questions answered by a schema alone.
//
// Everything here is a pure function of the field definitions — which keys sit on a panel,
// how those panels become cards, what a fresh working copy of the editable fields looks
// like. No live state, no markup, no document, and no imports: a schema is the only input.
//
// It lives beside the schemas it reads rather than in fields/, because that is what it is
// about, and because keeping it here means the two folders never import each other. The
// state that a form then edits, and the rules that keep it valid, are forms/form.js.

// The keys declared on one panel. `editableOnly` defaults to true — the edit forms that ask
// this want inputs; a read-only view passes false to keep `editable: false` rows as well.
function fieldsForPanel(fields, panel, editableOnly = true) {
  return Object.keys(fields).filter(
    (key) =>
      fields[key].panel === panel &&
      (!editableOnly || fields[key].editable !== false),
  );
}

// One panel with its keys resolved — the panel group buildPanelCard draws. Null when the
// panel has no keys to draw: a `component` panel has none, and a panel of read-only fields
// has none under `editableOnly`.
//
// `columns`, if given, overrides the panel's own — this is how one layout serves both
// modes: the display view takes the panel as declared, and an edit form passes 1 so inputs
// get the card's full width.
function toPanelGroup(fields, name, panel, { editableOnly = false, columns } = {}) {
  const keys = fieldsForPanel(fields, name, editableOnly);

  if (!keys.length) return null;

  return {
    title: panel.title,
    inline: panel.inline,
    columns: columns ?? panel.columns,
    keys,
  };
}

// Every panel of a layout — declared alongside the schema it describes as
// {name: {type, title, inline, columns}} — in the order the panels appear. Panels with
// nothing to draw are dropped rather than rendering an empty card.
//
// `editableOnly` mirrors fieldsForPanel's third argument inverted: false (the default)
// keeps `editable: false` keys, which an edit form still wants as read-only context rows.
function toPanelGroups(fields, panels, options = {}) {
  return Object.entries(panels)
    .map(([name, panel]) => toPanelGroup(fields, name, panel, options))
    .filter(Boolean);
}

function createFieldState(fields, source = {}) {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, field]) => field.editable !== false)
      .map(([key, field]) => {
        const value = source[key] ?? field.default ?? null;
        return [key, Array.isArray(value) ? [...value] : value];
      }),
  );
}

export { createFieldState, fieldsForPanel, toPanelGroup, toPanelGroups };

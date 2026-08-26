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

// Builds the groups buildGroupCards draws, from a panel layout — declared alongside the
// schema it describes as [{panel, title, inline, columns}].
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
    .filter((group) => group.keys.length);
}

// Build a working copy of the editable fields, seeded from `source` (e.g. a
// fetched record, for editing) or field defaults (for creating). Arrays are
// always cloned so two state objects never alias the same `field.default`
// (or the same source) array.
//
// A projection of the schema, which is why it sits here rather than with the functions that
// go on to mutate what it returns: `editable` and `default` are the only things it reads.
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

export { createFieldState, fieldsForPanel, panelGroups };

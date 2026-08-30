// A schema's panels, resolved: which keys sit on one, and how a panel becomes the group a
// card is drawn from.
//
// Pure — no live state, no markup, no document, no imports. The state a form then edits is
// forms/form.js.

// The keys declared on one panel. `editableOnly` defaults to true: a read-only view passes
// false to keep `editable: false` rows as well.
function fieldsForPanel(fields, panel, editableOnly = true) {
  return Object.keys(fields).filter(
    (key) =>
      fields[key].panel === panel &&
      (!editableOnly || fields[key].editable !== false),
  );
}

// One panel with its keys resolved, or null when it has none to draw. `columns` overrides
// the panel's own, which is how one layout serves both modes.
function toPanelGroup(
  fields,
  name,
  panel,
  { editableOnly = false, columns } = {},
) {
  const keys = fieldsForPanel(fields, name, editableOnly);

  if (!keys.length) return null;

  return {
    title: panel.title,
    inline: panel.inline,
    columns: columns ?? panel.columns,
    keys,
  };
}

// Every panel of a layout — {name: {type, title, inline, columns}} — in declared order,
// dropping those with nothing to draw. `editableOnly` defaults to false here, keeping the
// read-only context rows an edit form still wants.
function toPanelGroups(fields, panels, options = {}) {
  return Object.entries(panels)
    .map(([name, panel]) => toPanelGroup(fields, name, panel, options))
    .filter(Boolean);
}

export { fieldsForPanel, toPanelGroup, toPanelGroups };

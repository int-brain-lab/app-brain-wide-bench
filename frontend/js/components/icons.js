// One icon per concept, so the same thing looks the same wherever it appears.
//
// Written as concept → Lucide name rather than sprinkling Lucide names through the pages:
// "model" is what a caller means, `chart-column` is only how it is currently drawn. Change
// the value here and every model icon in the app follows, which is the point — the two
// subtitles already disagreed about a model (`box` in one, `chart-column` in the other)
// before this existed.
//
// Several concepts share a glyph, and that is fine: they are separate entries because they
// are separate ideas, and one of them may want its own icon later.

import { escapeHtml } from "../core/utils.js";

const ICONS = {
  // Records and their parts
  model: "chart-column",
  submission: "layers",
  team: "users",
  member: "users",
  task: "list-checks",
  suite: "grid-3x3",
  score: "chart-column",

  // Places
  dashboard: "layout-grid",
  leaderboard: "trophy",
  home: "house",
  settings: "settings",
  details: "book-open",

  // Facts about a record
  created: "calendar",
  status: "check-check",
  visibility: "globe",
  public: "eye",
  private: "eye-off",

  // Actions
  add: "plus",
  edit: "pencil",
  save: "check",
  cancel: "x",
  remove: "x",

  // Views
  cards: "layout-grid",
  table: "table",
  compare: "git-compare",

  // Field decorations, from the schemas
  link: "link",
  code: "code",
  publication: "book-open",
  data: "database",
};

/**
 * @param name a concept from ICONS — "model", "created", "edit".
 * @returns the Lucide name to put in `data-lucide`.
 *
 * An unknown name is passed through rather than dropped, so a raw Lucide name still works
 * while the app moves over — but it warns, because a typo looks exactly the same as a
 * deliberate one and neither draws an icon.
 */
function getIcon(name) {
  if (!(name in ICONS)) {
    console.warn(
      `No icon registered for "${name}" — using it as a Lucide name.`,
    );
  }

  return ICONS[name] ?? name;
}

/**
 * @param name      a concept from ICONS.
 * @param className the icon's size class — `field-icon` beside text, `btn-icon` in a button.
 * @param title     hover text, for an icon standing on its own with no label beside it.
 */
function buildIcon(name, { className = "field-icon", title = "" } = {}) {
  return `
    <i
      class="${className}"
      data-lucide="${getIcon(name)}"
      ${title ? `title="${escapeHtml(title)}"` : ""}
    ></i>
  `;
}

export { ICONS, buildIcon, getIcon };

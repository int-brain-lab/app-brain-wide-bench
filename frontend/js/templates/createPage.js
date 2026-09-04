// Generic create page.
//
// Owns the page chrome, form lifecycle, submit behaviour and messages.
// The form itself owns only schema-driven fields and panels.
//
// Create forms have three stages:
//
//   initialise() → create the schema-driven panel markup
//   setup()      → let the page add component-driven panels
//   attach()     → connect form listeners and perform the first refresh
//
// `setup()` deliberately runs between `initialise()` and `attach()` so component panels
// exist before the form performs its first completeness check.

import { getElement } from "../core/render.js";
import {
  buildFailureMessage,
  buildWarningMessage,
} from "../components/messages.js";
import { buildHeader, buildPage } from "../components/sections.js";
import { buildFormFooter, SUBMIT_BUTTON_ID } from "../components/buttons.js";
import { CLEARED_MESSAGE } from "../forms/form.js";
import { createForm } from "../forms/createForm.js";
import { loadPage } from "./page.js";
import {
  clearMessage,
  renderHeader,
  renderMessage,
  renderPage,
} from "./pageChrome.js";

const PANELS_ID = "panels";

// ─── FORM ────────────────────────────────────────────────────────────────────

/**
 * Create and mount the form for a create page.
 *
 * @param noun        *singular* — "model". Names the page, the submit button and the
 *                    failure message.
 * @param title       page heading. Null falls back to "Create new <noun>".
 * @param description page subheading.
 * @param back        `{ text, href }` for the page's back link and Cancel button. An href
 *                    rather than a view: Cancel leaves the page.
 * @param fields      field definitions, or (context) => fields when they depend on loaded
 *                    data.
 * @param panels      panel definitions, or (context) => panels when they depend on loaded
 *                    data.
 * @param submit      async (state, context) => destination. Returning one navigates there;
 *                    returning nothing leaves the page open and refreshes the form.
 * @param load        async () => context, for schema metadata or related records. Omit for
 *                    a page with nothing to fetch.
 * @param setup       async (form, context) => void, run after the schema-driven panels are
 *                    initialised and before listeners are attached. Omit unless the page
 *                    adds panels of its own.
 * @param onChange    async (key, value, cleared, { form, context }) => void, after a field
 *                    changes. Omit for no per-change hook.
 *
 * @returns the mounted form, or null if the page was not rendered.
 */
async function loadCreatePage({
  noun,
  title,
  description = "",
  back,

  fields,
  panels,
  submit,

  load,
  setup,
  onChange,
}) {
  let form = null;

  // ─── MARKUP ────────────────────────────────────────────────────────────────

  function buildBody() {
    return `
      <div class="column gap-lg">
        <div class="column gap-lg" id="${PANELS_ID}"></div>

        ${buildFormFooter({
          cancelHref: back.href ?? "",
          submitLabel: `Create ${noun}`,
        })}
      </div>
    `;
  }

  // ─── PAGE BOOTSTRAP ────────────────────────────────────────────────────────

  await loadPage({
    noun,
    requiresId: false,

    // Always return a context object so loadPage sees a successful load even when
    // this page has no async context to fetch.
    load: async () => ({
      context: load ? await load() : {},
    }),

    render: async ({ context }) => {
      if (!context) return;

      renderPage(
        buildPage({
          back,
          header: buildHeader(),
          body: buildBody(),
        }),
      );

      renderHeader(title ?? `Create new ${noun}`, description);

      const container = getElement(PANELS_ID);

      const resolvedFields =
        typeof fields === "function" ? await fields(context) : fields;

      const resolvedPanels =
        typeof panels === "function" ? await panels(context) : panels;

      form = createForm({
        container,
        fields: resolvedFields,
        panels: resolvedPanels,

        submit: (state) => submit(state, context),

        onChange: onChange
          ? (key, value, cleared) =>
              onChange(key, value, cleared, { form, context })
          : undefined,

        onCleared: (labels) => {
          if (labels) {
            renderMessage(buildWarningMessage(CLEARED_MESSAGE, labels));
          } else {
            clearMessage();
          }
        },

        onRefresh: (complete) => {
          getElement(SUBMIT_BUTTON_ID).disabled = !complete;
        },

        // A destination navigates away; nothing means the page stays open, and the form's
        // own refresh decides whether it can be submitted again.
        onSubmitted: (destination) => {
          if (destination) window.location.href = destination;
        },

        onError: (error) => {
          renderMessage(buildFailureMessage(`Creating ${noun} failed.`, error));
        },
      });

      // The submit button exists once the page is rendered, but starts disabled. The
      // form's first refresh decides whether it can be enabled.
      getElement(SUBMIT_BUTTON_ID).addEventListener("click", () => {
        clearMessage();
        form.submit();
      });

      // Build the schema-driven fields first.
      form.initialise();

      // Then give the page an opportunity to add panels that are not owned by
      // the generic form.
      await setup?.(form, context);

      // Finally connect listeners and perform the first completeness check.
      form.attach();
    },
  });

  return form;
}

export { loadCreatePage };

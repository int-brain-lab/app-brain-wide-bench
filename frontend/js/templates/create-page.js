// A whole create page: gate, load, chrome, form, components, submit.
//
// The page's markup needs a `#gate` card and a `#container`, same as every other page;
// everything else is rendered here — the back link, the header, the panels' container, the
// message region and the footer with its Cancel and Create buttons.
//
// All of which is why this file exists: the form under it (create-form.js) knows nothing
// but the container it draws panels into, so everything with a fixed place on the page is
// owned here. That means the header and the noun, the submit button and its enabled state,
// every message the form provokes, and the navigation on success.
//
// A create form is built in two phases (see create-form.js) so the page can construct the
// components that own its component-driven panels between them. That in-between step is
// `setup`, and it is the other reason this isn't a one-line wrapper around createPanelForm:
// every create page was repeating the same gate → load → initialise → build → attach order
// by hand, and the order is the part that's easy to get wrong.

import { isAuthenticated } from "../api/client.js";
import { CLEARED_MESSAGE } from "../forms/form.js";
import { showGate } from "./gate.js";
import { clearMessage, showFailure, showWarning } from "../core/utils.js";
import { createPanelForm } from "../forms/create-form.js";
import {
  buildFormFooter,
  buildHeader,
  buildPage,
  pageMessage,
  renderHeader,
  renderPage,
  showPageError,
  submitButton,
} from "./record-page.js";

const PANELS_ID = "panels";

// One `.column.gap-lg` around the panels, the message and the footer: that wrapper is what
// spaces the button off the last panel and puts a message directly above the control that
// produced it.
function renderChrome({ noun, header, backTo }) {
  renderPage(
    buildPage({
      back: backTo,
      header: buildHeader(),
      body: `
        <div class="column gap-lg">
          <div class="column gap-lg" id="${PANELS_ID}"></div>
          ${buildFormFooter({
            cancelHref: backTo.href ?? "",
            submitLabel: `Create ${noun}`,
          })}
        </div>
      `,
    }),
  );

  renderHeader(
    header ? header.title : `Create new ${noun}`,
    header ? header.description : "",
  );

  return document.getElementById(PANELS_ID);
}

/**
 * @param noun      The object being created, e.g "model" or "team". Labels the header, the
 *                  submit button and the failure messages.
 *
 * @param header    { title, description } for the page header. Optional; built from the
 *                  noun if not supplied.
 *
 * @param backTo    { href, text } for the back link and the cancel button.
 *
 * @param load      Optional async () => context. Everything the page needs before the form
 *                  can exist — schema fields, the signed-in user, a catalogue of tasks.
 *                  The context is handed to `fields`, `panels`, `setup`, `submit` and
 *                  `onChange`. Returning null aborts the page: the reason belongs to the
 *                  page, which reports it itself, because only it knows what was missing.
 *
 * @param fields    The field definitions, or a (context) => fields function, awaited.
 *
 * @param panels    The panel definitions, or a (context) => panels function.
 *
 * @param setup     Optional async (form, context) => void, run between `initialise()` and
 *                  `attach()`. Where the page builds the components owning its
 *                  component-driven panels; assigning them onto the context is how a
 *                  panel's `complete` reaches an object that doesn't exist yet when
 *                  `panels` is evaluated.
 *
 * @param submit    async (state, context) => destination URL, or null to stay on the page.
 *                  A throw is reported here and the button re-armed; returning without a
 *                  destination leaves whatever the page put on screen in place, which is how
 *                  a partial success stays readable.
 *
 * @param onChange  Optional async (key, value, cleared, { form, context }) => void, as
 *                  create-form.js's `onChange` with the form and context added.
 *
 * @returns the mounted form, or null if the page gated, aborted or failed.
 */
async function loadCreatePage({
  noun,
  header,
  backTo,
  load,
  fields,
  panels,
  setup,
  submit,
  onChange,
}) {
  try {
    if (!(await isAuthenticated())) {
      showGate(false);
      return null;
    }

    showGate(true);

    const context = load ? await load() : {};

    if (!context) return null;

    const panelsContainer = renderChrome({ noun, header, backTo });

    const form = createPanelForm({
      container: panelsContainer,
      fields: typeof fields === "function" ? await fields(context) : fields,
      panels: typeof panels === "function" ? panels(context) : panels,

      // `form` is read when the handler runs, long after this closure is made.
      onChange: onChange
        ? (key, value, cleared) =>
            onChange(key, value, cleared, { form, context })
        : undefined,

      // Called on every change, with an empty string when nothing was cleared — which is
      // the moment to drop a message left over from the change before.
      onCleared: (labels) => {
        if (labels) {
          showWarning(pageMessage(), CLEARED_MESSAGE, labels);
        } else {
          clearMessage(pageMessage());
        }
      },

      onRefresh: (complete) => {
        submitButton().disabled = !complete;
      },
    });

    // Re-arms the button on any outcome that leaves the user here: `refresh` re-asks the
    // form whether it is still complete, rather than assuming it is.
    async function handleSubmit() {
      submitButton().disabled = true;
      clearMessage(pageMessage());

      try {
        const destination = await submit(form.state, context);

        if (destination) {
          window.location.href = destination;
          return;
        }

        form.refresh();
      } catch (error) {
        console.error(error);

        showFailure(pageMessage(), `Creating ${noun} failed.`, error);
        form.refresh();
      }
    }

    // Wired before `setup`, not after: the footer's button starts disabled and is only
    // enabled by `onRefresh`, which a component built in `setup` can trigger — so the click
    // has to be live from the moment the button can be.
    submitButton().addEventListener("click", handleSubmit);

    form.initialise();

    await setup?.(form, context);

    form.attach();

    return form;
  } catch (error) {
    console.error(`Failed to initialise the ${noun} create page:`, error);

    showPageError(`The ${noun} create page could not be loaded.`, error);

    return null;
  }
}

export { loadCreatePage };

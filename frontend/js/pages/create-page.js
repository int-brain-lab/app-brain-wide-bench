// Boot sequence for a create page: gate, load, form, components, attach.
//
// The page's markup needs a `#gate` card and a `#container`, same as every other page;
// everything else is rendered.
//
// A create form is built in two phases (see create-form.js) so the page can construct the
// components that own its component-driven panels between them. That in-between step is
// `setup`, and it is the only reason this isn't a one-line wrapper around createPanelForm:
// every create page was repeating the same gate → load → initialise → build → attach order
// by hand, and the order is the part that's easy to get wrong.

import { isAuthenticated } from "../api.js";
import { showGate } from "./gate.js";
import { showError } from "../utils.js";
import { createPanelForm } from "./create-form.js";


/**
 * @param noun      The object being created, e.g "model" or "team". Labels the form's
 *                  buttons and messages, and this loader's failure message.
 *
 * @param header    { title, description } for the page header. Optional.
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
 * @param submit    async (state, context) => destination URL, as create-form.js's `submit`.
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
  const container = document.getElementById("container");

  try {
    if (!(await isAuthenticated())) {
      showGate(false);
      return null;
    }

    showGate(true);

    const context = load ? await load() : {};

    if (!context) return null;

    const form = createPanelForm({
      noun,
      header,
      backTo,
      fields: typeof fields === "function" ? await fields(context) : fields,
      panels: typeof panels === "function" ? panels(context) : panels,
      submit: state => submit(state, context),
      // `form` is read when the handler runs, long after this closure is made.
      onChange: onChange
        ? (key, value, cleared) => onChange(key, value, cleared, { form, context })
        : undefined,
    });

    form.initialise();

    await setup?.(form, context);

    form.attach();

    return form;
  } catch (error) {
    console.error(`Failed to initialise the ${noun} create page:`, error);

    showError(container, `The ${noun} create page could not be loaded.`);

    return null;
  }
}


export { loadCreatePage };

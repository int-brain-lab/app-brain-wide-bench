// Boot sequence shared by every page built around one record: gate, id, load, render.
//
// Everything here answers "can this page run, and what is it about?" — resolving the
// sign-in state, choosing the shell, finding the id, fetching the context, and reporting
// each way that can fail in the same words. How the context is then drawn is the caller's,
// passed in as `render`.
//
// record-loader.js is the caller for a page with several views of one record; a page with
// a single view — the comparison page — calls this directly and renders it itself.
//
// The page's markup needs a `#container`, and a `#gate` card if the record is private.

import { isAuthenticated } from "../api/client.js";
import { showGate, showSignInPrompt } from "./gate.js";
import { applyShell } from "./shell.js";
import { pageContainer, showPageError } from "./record-page.js";

/**
 * @param load      (id, {signedIn}) => context. A falsy result is reported as a failed
 *                  load; throw for anything that needs its own message.
 * @param render    (context, {id, signedIn}) => void. Awaited, and run inside the same
 *                  try as the load — see the note below.
 * @param noun      what the record is called, in the failure messages.
 * @param requiresId  false for a record page whose record is "me": the user's own
 *                  dashboard has no id to put in the URL, so `load` is called with null.
 * @param requiresAuth  false for a record the API serves to anyone — a model, a
 *                  submission. Those pages are one URL for both audiences: no gate, and
 *                  the public shell when signed out. `load` is handed `signedIn` so it can
 *                  skip the fetches only a signed-in caller can make; what a reader may
 *                  *change* is the record's own `can_edit`, which is team membership.
 */
async function loadPage({
  load,
  render,
  noun = "record",
  requiresId = true,
  requiresAuth = true,
}) {
  try {
    const signedIn = await isAuthenticated();

    if (requiresAuth) {
      showGate(signedIn);

      if (!signedIn) return;
    } else {
      // Only a page that can be read either way has a shell to choose; a private one is
      // written in the private shell and stays there.
      applyShell(signedIn);
    }

    const id = requiresId ? new URLSearchParams(location.search).get("id") : null;

    if (requiresId && !id) {
      showPageError(`No ${noun} id in the URL.`);
      return;
    }

    const context = await load(id, { signedIn });

    if (!context) {
      showPageError(requiresId ? `Could not load ${noun} ${id}.` : `Could not load your ${noun}.`);
      return;
    }

    // Inside the try, and awaited, which is the reason this is a hook rather than a
    // returned context the caller renders afterwards: a throw in the first render — a
    // missing container, a table mounted without Tabulator — then reports as a page error
    // like any other failure, instead of leaving a blank page and an unhandled rejection.
    await render(context, { id, signedIn });
  } catch (error) {
    console.error(`Failed to load the ${noun} page:`, error);

    // A 404 on a public record page is the ordinary answer for a record with nothing public
    // in it, not a broken page — and signing in is what would change the answer, since a
    // team member sees their own team's private records at the same URL.
    if (error.status === 404 && !requiresAuth) {
      showSignInPrompt(pageContainer(), `This ${noun} is not public. Sign in if you have access to it.`);
      return;
    }

    showPageError(`The ${noun} page could not be loaded.`, error);
  }
}


export { loadPage };

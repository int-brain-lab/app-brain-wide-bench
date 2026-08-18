// Boot sequence for a record page: gate, id, load, route.
//
// The page's markup needs a `#container`, and a `#gate` card if the record is private.

import { isAuthenticated } from "../api/client.js";
import { showGate, showSignInPrompt } from "./gate.js";
import { applyShell } from "./shell.js";
import { showError } from "../core/utils.js";
import { createRecordRouter } from "../core/router.js";

async function loadRecordPage({
  views,
  load,
  defaultView = "dashboard",
  noun = "record",
  flags = [],
  params = [],
  // The user's own dashboard is a record page whose record is "me" — there is no id to put
  // in the URL, so `load` is called with a null id.
  requiresId = true,
  // False for a record the API serves to anyone — a model, a submission. Those pages are
  // one URL for both audiences: no gate, and the public shell when signed out. `load` is
  // handed `signedIn` so it can skip the fetches only a signed-in caller can make; what a
  // reader may *change* is the record's own `can_edit`, which is team membership.
  requiresAuth = true,
}) {
  const container = document.getElementById("container");

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
      showError(container, `No ${noun} id in the URL.`);
      return;
    }

    const context = await load(id, { signedIn });

    if (!context) {
      showError(container, requiresId ? `Could not load ${noun} ${id}.` : `Could not load your ${noun}.`);
      return;
    }

    createRecordRouter({
      views,
      context,
      defaultView,
      container,
      flags,
      params,
    }).start();
  } catch (error) {
    console.error(`Failed to load the ${noun} page:`, error);

    // A 404 on a public record page is the ordinary answer for a record with nothing public
    // in it, not a broken page — and signing in is what would change the answer, since a
    // team member sees their own team's private records at the same URL.
    if (error.status === 404 && !requiresAuth) {
      showSignInPrompt(container, `This ${noun} is not public. Sign in if you have access to it.`);
      return;
    }

    showError(container, `The ${noun} page could not be loaded.`);
  }
}


export { loadRecordPage };

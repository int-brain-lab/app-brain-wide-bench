// Boot sequence for a record page: gate, id, load, route.
//
// The page's markup needs a `#gate` card and a `#container`; everything else is rendered.

import { isAuthenticated } from "../api.js";
import { showGate } from "../utils/gate.js";
import { showError } from "../utils.js";
import { createRecordRouter } from "./record-router.js";

async function loadRecordPage({
  views,
  load,
  defaultView = "dashboard",
  noun = "record",
  flags = [],
  params = [],
  // The user's own dashboard is a record page whose record is "me" — there is no id to put
  // in the URL, so `load` is called with nothing.
  requiresId = true,
}) {
  const elements = { gate: document.getElementById("gate") };
  const container = document.getElementById("container");

  try {
    if (!(await isAuthenticated())) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);

    const id = requiresId ? new URLSearchParams(location.search).get("id") : null;

    if (requiresId && !id) {
      showError(container, `No ${noun} id in the URL.`);
      return;
    }

    const context = requiresId ? await load(id) : await load();

    if (!context) {
      showError(container, requiresId ? `Could not load ${noun} ${id}.` : `Could not load your ${noun}.`);
      return;
    }

    createRecordRouter({ views, context, defaultView, container, flags, params }).start();
  } catch (error) {
    console.error(`Failed to load the ${noun} page:`, error);

    showError(container, `The ${noun} page could not be loaded.`);
  }
}


export { loadRecordPage };

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
}) {
  const elements = { gate: document.getElementById("gate") };
  const container = document.getElementById("container");

  try {
    if (!(await isAuthenticated())) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);

    const id = new URLSearchParams(location.search).get("id");

    if (!id) {
      showError(container, `No ${noun} id in the URL.`);
      return;
    }

    const context = await load(id);

    if (!context) {
      showError(container, `Could not load ${noun} ${id}.`);
      return;
    }

    createRecordRouter({ views, context, defaultView, container, flags }).start();
  } catch (error) {
    console.error(`Failed to load the ${noun} page:`, error);

    showError(container, `The ${noun} page could not be loaded.`);
  }
}


export { loadRecordPage };

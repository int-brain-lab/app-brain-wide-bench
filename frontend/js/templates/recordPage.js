// A record page with several views of the same record, selected by `?view=`.
//
// loadPage handles the common boot sequence: authentication, gating, id lookup, loading
// and errors. This module only decides how the loaded record is rendered: a record router
// owns the container and switches between views.

import { getElement } from "../core/render.js";
import { createRecordRouter } from "../core/router.js";
import { CONTAINER_ID } from "./pageChrome.js";
import { loadPage } from "./page.js";

/**
 * A record page whose views share one loaded record, switched by `?view=`.
 *
 * @param views       {name: (context, router) => handle}. A view returning a `destroy()`
 *                    handle is torn down before the next one renders.
 * @param defaultView the view for a URL with no `?view=`, or an unknown one.
 * @param flags       one-shot URL extras read once at boot and deleted — `edit`.
 * @param params      durable URL extras that survive view changes, refresh and Back —
 *                    `task`.
 * @param ...page     everything else — `load`, `noun`, `requiresId`, `requiresAuth` — is
 *                    loadPage's.
 *
 * @returns loadPage's promise, settled once the page has rendered or reported its failure.
 */
function loadRecordPage({
  views,
  defaultView = "dashboard",
  flags = [],
  params = [],
  ...page
}) {
  return loadPage({
    ...page,

    render: (context) => {
      const container = getElement(CONTAINER_ID);

      const router = createRecordRouter({
        views,
        context,
        defaultView,
        container,
        flags,
        params,
      });

      return router.start();
    },
  });
}

export { loadRecordPage };

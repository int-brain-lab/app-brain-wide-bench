// A record page rendered as several views of one record, switched by `?view=`.
//
// The boot half — gate, id, load, and the words each failure is reported in — is
// page-loader.js, shared with pages that render themselves. This is only the rendering
// strategy: hand the loaded context to a router and let it own the container from there.

import { createRecordRouter } from "../core/router.js";
import { loadPage } from "./page-loader.js";
import { pageContainer } from "./record-page.js";

/**
 * @param views       {name: (context, router) => handle}. A view returning a handle with
 *                    `destroy()` is torn down when the next one renders.
 * @param defaultView the view for a URL with no `?view=`, or an unknown one.
 * @param flags       one-shot URL extras read once at boot and deleted — `&edit`.
 * @param params      durable URL extras that survive refresh and Back — `&task=`.
 *
 * Everything else — `load`, `noun`, `requiresId`, `requiresAuth` — is loadPage's.
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

    render: context =>
      createRecordRouter({
        views,
        context,
        defaultView,
        container: pageContainer(),
        flags,
        params,
      }).start(),
  });
}


export { loadRecordPage };

// Pageviews for the views a record page switches between without a reload.
//
// Every page carries the umami tag, which reports the document's own pageview and patches
// `history.pushState`. It patches nothing for `popstate`, and `data-exclude-search` keeps
// `?view=` out of the URL it reports, so core/router.js reports each view change here.

/**
 * Report a pageview the umami tag does not report itself.
 *
 * @param url what to record the view against — path and query.
 */
function trackPageview(url) {
  // Absent until the tag loads, and absent for good where a reader blocks it.
  globalThis.umami?.track((payload) => ({ ...payload, url }));
}

export { trackPageview };

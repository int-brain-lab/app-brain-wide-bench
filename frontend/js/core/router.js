// One document, several views of a single record. `?view=` is the state.

const CONTAINER_ID = "container";

// Two kinds of URL extra, and they clean up at opposite ends:
//
//   flags   how you arrived — `&edit`, `&created`. Read once at boot, then deleted.
//   params  what you are looking at — `&task=<id>`. Durable: survives refresh, Back and
//           deep-links, and is dropped when you navigate to a view that didn't ask for it.
function createRecordRouter({
  views,
  context,
  defaultView = "dashboard",
  container = document.getElementById(CONTAINER_ID),
  flags = [],
  params: viewParams = [],
}) {
  // Held so the next render can destroy it: replacing the container's children detaches a
  // Tabulator's element but doesn't free it — Tabulator's own registry keeps the instance,
  // its data and its ResizeObserver alive, one orphan per visit.
  let mounted = null;

  function viewFromUrl() {
    const name = new URLSearchParams(location.search).get("view");

    return name && name in views ? name : defaultView;
  }

  // `params.set` rather than a fresh string, so `id` survives the change.
  //
  // A declared param is written when `extra` carries it and removed when it doesn't —
  // otherwise `task=` from one view would ride along to every later one, which is the same
  // staleness the flags are deleted at boot to avoid.
  function withView(name, extra = {}) {
    const params = new URLSearchParams(location.search);

    params.set("view", name);

    for (const param of viewParams) {
      if (extra[param] == null) {
        params.delete(param);
      } else {
        params.set(param, extra[param]);
      }
    }

    return params;
  }

  // The durable half of a view's arguments, read back out of the URL so a refresh or a Back
  // renders the same screen. Flags are deliberately not replayed this way.
  function paramsFromUrl() {
    const current = new URLSearchParams(location.search);

    return Object.fromEntries(
      viewParams
        .filter((param) => current.has(param))
        .map((param) => [param, current.get(param)]),
    );
  }

  function release() {
    if (!mounted) return;

    // Optional call, not a bare one: `.destroy()` comes from Tabulator 6 docs and has never
    // been run here. A wrong name should leak, not throw and kill navigation.
    if (typeof mounted.destroy !== "function") {
      console.warn(
        "Record view returned a handle with no destroy(); it will leak.",
        mounted,
      );
    }

    mounted.destroy?.();
    mounted = null;
  }

  // The single choke point every render passes through, which is why teardown lives here
  // and not in the views that mount grids.
  // `extra` is one-shot render state merged over the context — an intent like `{ edit: true }`
  // that belongs to this navigation only. It is deliberately not in the URL and not replayed
  // on popstate, so returning to a view by Back does not repeat the intent.
  function showView(name, extra = {}) {
    release();

    mounted = views[name]({ ...context, ...extra }, router) ?? null;

    globalThis.lucide?.createIcons?.();
  }

  function goTo(name, extra = {}) {
    if (!(name in views)) {
      console.warn(`Ignoring navigation to unknown view: ${name}`);
      return;
    }

    history.pushState({ view: name }, "", `?${withView(name, extra)}`);

    showView(name, extra);
  }

  function attach() {
    // Attaches all items in the page that have a data-view attribute. The attribute's value is the view name to navigate to.
    container.addEventListener("click", (event) => {
      const link = event.target.closest("[data-view]");

      // The `contains` check matters: private pages carry `<body data-view="private">`, so
      // without it a click on any inert part of the container matches the body and routes
      // to a view called "private".
      if (!link || !container.contains(link)) return;

      // A view this page doesn't have falls through to the link's own href rather than
      // being swallowed. That is what lets one piece of markup do both jobs: a score row
      // routes client-side on the submission page, which owns the `score` view, and
      // navigates by URL from the dashboard and the model page, which do not.
      if (!(link.dataset.view in views)) return;

      event.preventDefault();

      // A link supplies declared params from its own dataset — `data-task="…"` alongside
      // `data-view="task"` — so a table cell can route without any domain glue.
      const extra = Object.fromEntries(
        viewParams
          .filter((param) => link.dataset[param] != null)
          .map((param) => [param, link.dataset[param]]),
      );

      goTo(link.dataset.view, extra);
    });

    // No pushState here — pushing on a popstate adds an entry per press and the page
    // becomes impossible to leave.
    addEventListener("popstate", () =>
      showView(viewFromUrl(), paramsFromUrl()),
    );
  }

  // Read once at boot and deleted from the URL, so a flag can't ride along to a later view
  // and fire again on the way back.
  function takeFlags(params) {
    const taken = {};

    for (const flag of flags) {
      if (!params.has(flag)) continue;

      taken[flag] = true;
      params.delete(flag);
    }

    return taken;
  }

  function start() {
    attach();

    const initial = viewFromUrl();
    const fromUrl = paramsFromUrl();
    const params = withView(initial, fromUrl);
    const taken = takeFlags(params);

    history.replaceState({ view: initial }, "", `?${params}`);

    // popstate does not fire on load, so the first render has to be explicit.
    showView(initial, { ...fromUrl, ...taken });
  }

  const router = { start, goTo };

  return router;
}

export { createRecordRouter };

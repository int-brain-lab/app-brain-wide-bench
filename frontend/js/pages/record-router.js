// One document, several views of a single record. `?view=` is the state.

const CONTAINER_ID = "container";

function createRecordRouter({
  views,
  context,
  defaultView = "dashboard",
  container = document.getElementById(CONTAINER_ID),
  flags = [],
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
  function withView(name) {
    const params = new URLSearchParams(location.search);

    params.set("view", name);

    return params;
  }

  function release() {
    if (!mounted) return;

    // Optional call, not a bare one: `.destroy()` comes from Tabulator 6 docs and has never
    // been run here. A wrong name should leak, not throw and kill navigation.
    if (typeof mounted.destroy !== "function") {
      console.warn("Record view returned a handle with no destroy(); it will leak.", mounted);
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

    history.pushState({ view: name }, "", `?${withView(name)}`);

    showView(name, extra);
  }

  function attach() {
    // Attaches all items in the page that have a data-view attribute. The attribute's value is the view name to navigate to.
    container.addEventListener("click", event => {
      const link = event.target.closest("[data-view]");

      // The `contains` check matters: private pages carry `<body data-view="private">`, so
      // without it a click on any inert part of the container matches the body and routes
      // to a view called "private".
      if (!link || !container.contains(link)) return;

      event.preventDefault();
      goTo(link.dataset.view);
    });

    // No pushState here — pushing on a popstate adds an entry per press and the page
    // becomes impossible to leave.
    addEventListener("popstate", () => showView(viewFromUrl()));
  }

  // `&edit`, `&created` — how you arrived, not where you are. Read once at boot and deleted
  // from the URL: `withView` preserves whatever it doesn't recognise, so a flag left in
  // place would ride along to every later view and fire again on the way back.
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
    const params = withView(initial);
    const taken = takeFlags(params);

    history.replaceState({ view: initial }, "", `?${params}`);

    // popstate does not fire on load, so the first render has to be explicit.
    showView(initial, taken);
  }

  const router = { start, goTo };

  return router;
}


export { createRecordRouter };

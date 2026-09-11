import { resolveContainer } from "./dom.js";

function refreshIcons() {
  globalThis.lucide?.createIcons?.();
}

// Null when there is no such element, unlike resolveContainer, which throws.
function getElement(id) {
  return document.getElementById(id);
}

function clearContent(container, { hide = false } = {}) {
  const element = resolveContainer(container);

  if (hide) {
    element.hidden = true;
  }

  element.replaceChildren();

  return element;
}

// `hidden` belongs to whoever placed the element — the shell owns #top-nav and #side-nav,
// a list view owns its panes — so it is only ever cleared on request.
function renderHtml(container, html, { show = false, refresh = false } = {}) {
  const element = resolveContainer(container);

  element.replaceChildren();
  element.innerHTML = html;

  if (show) {
    element.hidden = false;
  }

  // An `<i data-lucide>` is invisible until createIcons() replaces it, so markup carrying
  // one is refreshed whether or not the caller asked. `refresh` remains for a caller whose
  // icons arrived by another route.
  if (refresh || html.includes("data-lucide")) {
    refreshIcons();
  }

  return element;
}

function setText(container, text) {
  const element = resolveContainer(container);

  element.textContent = text ?? "";

  return element;
}

export { clearContent, getElement, refreshIcons, renderHtml, setText };

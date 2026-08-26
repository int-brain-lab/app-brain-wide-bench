import { resolveContainer } from "./dom.js";

function refreshIcons() {
  globalThis.lucide?.createIcons?.();
}

function clearContent(container, { hide = false } = {}) {
  const element = resolveContainer(container);

  if (hide) {
    element.hidden = true;
  }

  element.replaceChildren();

  return element;
}

function renderHtml(container, html, { show = false, refresh = false } = {}) {
  const element = resolveContainer(container);

  element.replaceChildren();
  element.innerHTML = html;

  if (show) {
    element.hidden = false;
  }

  if (refresh) {
    refreshIcons();
  }

  return element;
}

function setText(container, text) {
  const element = resolveContainer(container);

  element.textContent = text ?? "";

  return element;
}

export { clearContent, refreshIcons, renderHtml, setText };

// Shared boot sequence for all pages:
//
//   authenticate → gate/shell → get id → load → render
//
// This module owns everything needed to get a page running. Each page's render
// determines what is drawn on the page.
//
// The page markup needs a #container, and private pages also need a #gate card.

import { isAuthenticated, login } from "../api/client.js";
import { escapeHtml } from "../core/html.js";
import { pluralise } from "../core/utils.js";
import { getElement } from "../core/render.js";
import { CONTAINER_ID, renderPageError } from "./pageChrome.js";

// ─── SHELL ───────────────────────────────────────────────────────────────────

function replaceClass(selector, from, to) {
  const element = document.querySelector(selector);

  if (element?.classList.contains(from)) {
    element.classList.replace(from, to);
  }
}

function applyPrivateShell() {
  replaceClass(".main", "main", "main-private");
  replaceClass(".content", "content", "content-private");

  const topNav = document.getElementById("top-nav");
  const sidebar = document.getElementById("side-nav");

  if (topNav) topNav.hidden = true;
  if (sidebar) sidebar.hidden = false;
}

function applyShell(signedIn) {
  if (signedIn) {
    applyPrivateShell();
  }
}

// ─── GATE ────────────────────────────────────────────────────────────────────

function wireLoginButton(button) {
  if (!button || button.dataset.wired) return;

  button.dataset.wired = "true";
  button.addEventListener("click", login);
}

function showGate(signedIn) {
  const gate = document.getElementById("gate");

  if (!gate) return;

  gate.hidden = signedIn;

  for (const sibling of gate.parentElement.children) {
    if (sibling !== gate) {
      sibling.hidden = !signedIn;
    }
  }

  if (!signedIn) {
    wireLoginButton(gate.querySelector("#gate-login"));
  }
}

function showSignInPrompt(container, message) {
  container.innerHTML = `
    <div class="card sign-in-card">
      <div class="column gap-md">
        <p>${escapeHtml(message)}</p>
        <button class="btn primary" data-role="login">Sign in</button>
      </div>
    </div>
  `;

  wireLoginButton(container.querySelector("[data-role='login']"));
}

// ─── URL ─────────────────────────────────────────────────────────────────────

function getRecordId(required) {
  if (!required) return null;

  return new URLSearchParams(location.search).get("id");
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

function showLoadFailure(noun, subject, requiresId, id) {
  renderPageError(
    requiresId
      ? `Could not load ${noun} ${id}.`
      : `Could not load your ${subject}.`,
  );
}

function handlePrivateRecord(error, noun, requiresAuth) {
  if (error.status !== 404 || requiresAuth) {
    return false;
  }

  showSignInPrompt(
    getElement(CONTAINER_ID),
    `This ${noun} is not public. Sign in if you have access to it.`,
  );

  return true;
}

/**
 * The boot sequence every page runs: authenticate, gate, find the id, load, render.
 *
 * @param noun         *singular* — "model". Names the record in every message; a page with
 *                     no id says the plural, since it is showing a collection.
 * @param requiresId   whether the record id must come from `?id=` in the URL. False for a
 *                     page with no one record — a list, or the viewer's own.
 * @param requiresAuth whether the page itself requires signing in. False lets one URL serve
 *                     signed-out and signed-in readers alike.
 * @param load         (id, { signedIn }) => context. A falsy result is reported as a load
 *                     failure.
 * @param render       (context, { id, signedIn }) => void. Awaited, so a rendering error is
 *                     reported as a page-load failure rather than an unhandled rejection.
 *
 * @returns a promise settled once the page has rendered or reported its failure.
 */
async function loadPage({
  noun = "record",
  requiresId = true,
  requiresAuth = true,

  load,
  render,
}) {
  // A page with no id in the URL is showing a collection, so it says "your models" and
  // "the models page" where a record page says "model".
  const subject = requiresId ? noun : pluralise(noun);

  try {
    const signedIn = await isAuthenticated();

    if (requiresAuth) {
      showGate(signedIn);

      if (!signedIn) return;
    } else {
      applyShell(signedIn);
    }

    const id = getRecordId(requiresId);

    if (requiresId && !id) {
      renderPageError(`No ${noun} id in the URL.`);
      return;
    }

    const context = await load(id, { signedIn });

    if (!context) {
      showLoadFailure(noun, subject, requiresId, id);
      return;
    }

    await render(context, { id, signedIn });
  } catch (error) {
    console.error(`Failed to load the ${subject} page:`, error);

    if (handlePrivateRecord(error, noun, requiresAuth)) {
      return;
    }

    renderPageError(`The ${subject} page could not be loaded.`, error);
  }
}

export { loadPage };

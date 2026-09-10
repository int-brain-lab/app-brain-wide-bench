// Shared boot sequence for all pages:
//
//   authenticate → gate → get id → shell hint → load → shell → render
//
// This module owns everything needed to get a page running. Each page's render
// determines what is drawn on the page.
//
// The page markup needs a #container, and private pages also need a #gate card. A private
// page carries the sidebar shell; a public one carries the top nav, and keeps it unless what
// it loaded turns out to be the viewer's own — see `privateShell`.

import { isAuthenticated, login } from "../api/client.js";
import { escapeHtml } from "../core/html.js";
import { readMineHint } from "../core/links.js";
import { pluralise } from "../core/utils.js";
import { getElement, renderHtml } from "../core/render.js";
import { buildSignInButton } from "../components/buttons.js";
import { CONTAINER_ID, renderPageError } from "./pageChrome.js";

// ─── SHELL ───────────────────────────────────────────────────────────────────

function replaceClass(selector, from, to) {
  const element = document.querySelector(selector);

  if (element?.classList.contains(from)) {
    element.classList.replace(from, to);
  }
}

// Swaps a public page's markup for the sidebar shell, and back. Only a page whose markup
// carries a hidden #side-nav can be swapped — see the record pages, which are the ones that
// can turn out to be the reader's own.
function applyShell(mine) {
  const to = mine ? "-private" : "";
  const from = mine ? "" : "-private";

  // Both class names in each selector: whichever shell is up now is the one to find.
  replaceClass(".main, .main-private", `main${from}`, `main${to}`);
  replaceClass(".content, .content-private", `content${from}`, `content${to}`);

  const topNav = document.getElementById("top-nav");
  const sidebar = document.getElementById("side-nav");

  if (topNav) topNav.hidden = mine;
  if (sidebar) sidebar.hidden = !mine;
}

// ─── GATE ────────────────────────────────────────────────────────────────────

// The slot every gate leaves for it — see the `#gate` card in each private page's markup.
const SIGN_IN_SLOT = "[data-role='gate-login']";

function wireLoginButton(button) {
  if (!button || button.dataset.wired) return;

  button.dataset.wired = "true";

  // An arrow, not the bare function: a listener is called with the click event, and
  // `login` reads its first argument as the page to return to. Its default — the page the
  // gate is on — is what a gate wants.
  button.addEventListener("click", () => login());
}

// Built here rather than written into all eight private pages, which had a copy each.
function renderSignIn(slot) {
  if (!slot) return;

  renderHtml(slot, buildSignInButton());

  wireLoginButton(slot.querySelector("button"));
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
    renderSignIn(gate.querySelector(SIGN_IN_SLOT));
  }
}

function showSignInPrompt(container, message) {
  container.innerHTML = `
    <div class="card sign-in-card">
      <div class="column gap-lg">
        <p>${escapeHtml(message)}</p>
        <span data-role="gate-login"></span>
      </div>
    </div>
  `;

  renderSignIn(container.querySelector(SIGN_IN_SLOT));
}

// ─── URL ─────────────────────────────────────────────────────────────────────

function getRecordId(required) {
  if (!required) return null;

  return new URLSearchParams(location.search).get("id");
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

function showLoadFailure(noun, subject, requiresId, id) {
  renderPageError(requiresId ? `Could not load ${noun} ${id}` : `Could not load your ${subject}`);
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
 * @param privateShell (context) => boolean, asked once the record is loaded: true swaps the
 *                     public shell for the sidebar, for a record that is the viewer's own.
 *                     A `?mine=1` hint applies it before the load and this answer settles
 *                     it — see core/links.js. Omit for a page whose shell is whatever its
 *                     markup says.
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

  privateShell,

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
    }

    const id = getRecordId(requiresId);

    if (requiresId && !id) {
      renderPageError(`No ${noun} id in the URL`);
      return;
    }

    // What the page that linked here already knew, so the shell is right in the first frame
    // rather than a round trip later. Corrected below by the record itself.
    //
    // `signedIn` as well as the hint, for the same reason the pages pair it with `is_mine`:
    // nothing is a reader's own when there is no reader, and a hint that outvoted that would
    // paint the sidebar for a visitor and take it back a round trip later.
    if (privateShell && signedIn && readMineHint()) {
      applyShell(true);
    }

    const context = await load(id, { signedIn });

    if (!context) {
      showLoadFailure(noun, subject, requiresId, id);
      return;
    }

    // The record is the authority: it confirms the hint above, or takes it back.
    if (privateShell) {
      applyShell(privateShell(context));
    }

    await render(context, { id, signedIn });
  } catch (error) {
    console.error(`Failed to load the ${subject} page:`, error);

    if (handlePrivateRecord(error, noun, requiresAuth)) {
      return;
    }

    renderPageError(`The ${subject} page could not be loaded`, error);
  }
}

export { loadPage };

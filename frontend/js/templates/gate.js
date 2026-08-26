// The sign-in gate shared by every private page.
//
// A page needs only one thing in its markup: a `#gate` card as a child of
// .content-private. Hiding the rest is done by walking the gate's siblings, so no page
// needs a wrapper element around its content — which is the whole reason this is shared
// rather than written per page. The alternative was 20 bespoke showGate functions, each
// naming a different set of ids to hide.
//
// It also wires the gate's Sign in button. That button existed on three pages and was
// connected to nothing at all: `login()` lives in js/api.js and was only ever reached from
// the top nav, which most private pages don't load. Doing it here means it can't be
// forgotten on page 18.

import { escapeHtml } from "../core/utils.js";
import { login } from "../api/client.js";

/**
 * @param elements  an object with a `gate` property — the #gate element.
 * @param signedIn  true to show the page, false to show the gate instead.
 *
 * Sets `hidden` on every sibling of the gate, so anything the page puts inside
 * .content-private is covered without being named here.
 */
function showGate(signedIn) {
  const gate = document.getElementById("gate");

  if (!gate) return;

  gate.hidden = signedIn;

  for (const sibling of gate.parentElement.children) {
    if (sibling !== gate) {
      sibling.hidden = !signedIn;
    }
  }

  if (signedIn) return;

  // Attached on the way into the gate rather than at page load, and only once — showGate
  // can be called again, and a second listener would open two login redirects per click.
  const button = gate.querySelector("#gate-login");

  if (button && !button.dataset.wired) {
    button.dataset.wired = "true";
    button.addEventListener("click", () => login());
  }
}

/**
 * The gate's card, rendered into a container rather than over the whole page — for a record
 * that a signed-out visitor may simply not be allowed to see, where the page itself loaded
 * fine and only the record is missing.
 *
 * @param container element to render into. Its contents are replaced.
 * @param message   what to say above the button.
 */
function showSignInPrompt(container, message) {
  container.innerHTML = `
    <div class="card sign-in-card">
      <div class="column gap-md">
        <p>${escapeHtml(message)}</p>
        <button class="btn primary" data-role="login">Sign in</button>
      </div>
    </div>
  `;

  container
    .querySelector("[data-role='login']")
    .addEventListener("click", () => login());
}

export { showGate, showSignInPrompt };

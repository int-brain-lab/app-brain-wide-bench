// Which chrome a page wears. A record anyone may read — a model, a submission, the lists of
// them, the leaderboard — is one URL whoever is looking at it: signed out it stands alone
// under the public top nav, signed in it sits in the app beside the sidebar.
//
// The markup is the public shell, and this upgrades it. That direction rather than the
// other because the sign-in state is only known after an await: whichever shell the markup
// declares is the one the page paints, so declaring the public one is what stops a visitor
// seeing a sidebar flick past that was never going to stay. A signed-in reader gets the
// swap instead, which is the trade — their sidebar arrives a frame late.

function swapClass(element, from, to) {
  if (element?.classList.contains(from)) {
    element.classList.replace(from, to);
  }
}

/**
 * @param signedIn true to swap the page's public shell for the private one.
 */
function applyShell(signedIn) {
  if (!signedIn) return;

  swapClass(document.querySelector(".main"), "main", "main-private");
  swapClass(document.querySelector(".content"), "content", "content-private");

  const topNav = document.getElementById("top-nav");
  const sidebar = document.getElementById("side-nav");

  // .nav and .sidebar set their own `display`, which is why style.css marks [hidden] as
  // !important — without that these two would do nothing.
  if (topNav) topNav.hidden = true;
  if (sidebar) sidebar.hidden = false;
}

export { applyShell };

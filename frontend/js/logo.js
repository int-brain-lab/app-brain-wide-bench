// The brand mark, shared by the top nav and the sidebar.
//
// Its own module rather than an export from nav_top.js: that file calls
// initialiseNav() at import time, so importing the logo from it would kick off the
// top nav's setup on the private pages, which have no top nav at all.
//
// An inline SVG rather than a Lucide placeholder — it isn't a Lucide icon, and it
// needs no createIcons() pass to appear.

function renderLogo() {
  return `
    <div class="nav-logo">
      <div class="nav-logo-mark">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="5" stroke="white" stroke-width="1.5" />
          <circle cx="8" cy="8" r="2" fill="white" />
        </svg>
      </div>

      <span>brain-wide bench</span>
    </div>
  `;
}

export { renderLogo };

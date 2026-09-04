// Shared DOM helpers used across tables, charts, widgets and page templates.

// A bad id is the likeliest mistake at a mount site, and a direct "no such element" error
// beats the TypeError that writing to null would give.
function resolveContainer(container) {
  const element =
    typeof container === "string"
      ? document.getElementById(container)
      : container;

  if (!element) {
    throw new Error(`Element does not exist: "${container}"`);
  }

  return element;
}

export { resolveContainer };

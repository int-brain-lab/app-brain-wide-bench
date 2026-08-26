// Shared DOM helpers used across tables, charts, widgets and page templates.

// `caller` only shapes the error message: a bad id is the likeliest mistake at a mount
// site, and "no such container" beats the TypeError that writing to null would give.
function resolveContainer(container, caller) {
  const element =
    typeof container === "string"
      ? document.getElementById(container)
      : container;

  if (!element) {
    throw new Error(`${caller}: no such container "${container}"`);
  }

  return element;
}

export { resolveContainer };

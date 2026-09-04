// Shared teardown helpers for mounted widgets, tables, charts, listeners, and other
// resources that need explicit cleanup.

const DISPOSAL_METHODS = ["destroy", "dispose", "abort"];

function dispose(value) {
  if (!value) {
    return false;
  }

  if (typeof value === "function") {
    value();
    return true;
  }

  for (const method of DISPOSAL_METHODS) {
    if (typeof value[method] === "function") {
      value[method]();
      return true;
    }
  }

  return false;
}

function disposeAll(values = []) {
  for (const value of values) {
    dispose(value);
  }
}

export { dispose, disposeAll };

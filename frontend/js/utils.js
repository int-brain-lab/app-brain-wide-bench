// util functions that are reused across

function initials(name) {
  return name.split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
}


function score(value) {
  return value == null ? "—" : value.toFixed(3);
}
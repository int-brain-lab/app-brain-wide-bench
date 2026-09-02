// Query strings, where the shape of a parameter is the thing worth agreeing on.

/**
 * One filter onto a URLSearchParams.
 *
 * A list is sent as one repeated parameter — `?training_paradigm=a&training_paradigm=b` —
 * which is what FastAPI reads as a list. Empty and absent are the same thing: an omitted
 * parameter is what an endpoint reads as "no filter".
 */
function appendFilter(params, key, value) {
  if (Array.isArray(value)) {
    for (const one of value) params.append(key, one);

    return;
  }

  if (value != null && value !== "") params.set(key, value);
}

// The `?…` for a set of filters, or "" for none — so a caller can append it to a path
// unconditionally.
function buildQuery(filters) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    appendFilter(params, key, value);
  }

  return params.size ? `?${params}` : "";
}

export { appendFilter, buildQuery };

// Shared value normalization helpers used before values are rendered or sent to the API.

function trimmed(value) {
  return typeof value === "string" ? value.trim() : value;
}

function normalizeObject(object, normalizers = {}) {
  const normalized = { ...object };

  for (const [key, normalize] of Object.entries(normalizers)) {
    if (!(key in normalized)) {
      continue;
    }

    normalized[key] = normalize(normalized[key], normalized);
  }

  return normalized;
}

export { normalizeObject, trimmed };

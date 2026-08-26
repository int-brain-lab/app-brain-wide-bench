// "3 submissions" / "1 member" — a count with its noun pluralised.
//
// Shared rather than private to one card because the cards, the team page and the dashboard
// all say the same thing about different nouns, and a missing count reads as 0 in all three.
//
// `noun` is the *singular*: this adds the "s". Passing a plural gives "3 taskss", which is
// what two call sites did before they came through here.

function buildCount(count, noun) {
  const total = count ?? 0;

  return `${total} ${noun}${total === 1 ? "" : "s"}`;
}

// "Showing 5 out of 12 models" — the wording every table footer uses, filterable or static,
// so a footer always says how much of the whole it is showing rather than only sometimes.
//
// The noun agrees with the *total*, not with `shown`, which is why the tail goes through
// buildCount: "Showing 1 out of 12 models", but "Showing 1 out of 1 model".
function buildTableCount(shown, total, noun) {
  return `Showing ${shown} out of ${buildCount(total, noun)}`;
}

export { buildCount, buildTableCount };

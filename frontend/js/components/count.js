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


export { buildCount };

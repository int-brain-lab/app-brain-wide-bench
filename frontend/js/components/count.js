// "3 submissions" / "1 member" — a count with its noun pluralised.
//
// Shared rather than private to one card because the model card, the team card and the
// dashboard all say the same thing about different nouns, and a missing count reads as 0
// in all three.

function buildCount(count, noun) {
  return `${count ?? 0} ${noun}${(count ?? 0) === 1 ? "" : "s"}`;
}


export { buildCount };

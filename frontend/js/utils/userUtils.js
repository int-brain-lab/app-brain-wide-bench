// The signed-in user as their dashboard reads them: what the account holds, and how to
// greet them.
//
// The record here is the account rather than one object, so the figures are counted across
// everything it has entered.

import { buildCount } from "../components/count.js";
import { getIcon } from "../components/icons.js";

// ─── DISPLAY ─────────────────────────────────────────────────────────────────

function getWelcome(user) {
  const name = user?.name || user?.email;

  return name ? `Welcome ${name}` : "Welcome";
}

/**
 * What the account holds, under its own name — the same three the columns below list, said
 * once at the top rather than in three cards saying it a second time.
 *
 * @returns the parts, in reading order — see buildSubtitle in components/sections.js.
 */
function getUserSubtitle(teams, models, submissions) {
  return [
    { text: buildCount(teams.length, "team"), icon: getIcon("team") },
    { text: buildCount(models.length, "model"), icon: getIcon("model") },
    {
      text: buildCount(submissions.length, "submission"),
      icon: getIcon("submission"),
    },
  ];
}

// All three empty means the account has been signed into but nothing set up. All three
// rather than any one: someone with a team and a model but no submission yet is midway
// through, and the sections tell them that far better than restarting the instructions.
function isNewAccount(models, teams, submissions) {
  return !models.length && !teams.length && !submissions.length;
}

export { getUserSubtitle, getWelcome, isNewAccount };

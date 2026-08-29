// The signed-in user as their dashboard reads them: what they have, and how to greet them.
//
// The record here is the account rather than one object, so the figures are counted across
// the models, teams and submissions the dashboard loaded.

import { getIcon } from "../components/icons.js";

// ─── DISPLAY ─────────────────────────────────────────────────────────────────

export function getWelcome(user) {
  const name = user?.name || user?.email;

  return name ? `Welcome ${name}` : "Welcome";
}

function countSubmissions(models) {
  return models.reduce((total, model) => total + (model.n_submissions ?? 0), 0);
}

export function getUserStatistics(models, teams) {
  return [
    ["models", models.length, getIcon("model")],
    ["submissions", countSubmissions(models), getIcon("submission")],
    ["teams", teams.length, getIcon("team")],
  ];
}

// All three empty means the account has been signed into but nothing set up. All three
// rather than any one: someone with a team and a model but no submission yet is midway
// through, and the sections tell them that far better than restarting the instructions.
export function isNewAccount(models, teams, submissions) {
  return !models.length && !teams.length && !submissions.length;
}

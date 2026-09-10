// What deleting a record takes with it, worded for the confirmation card.
//
// One module for all three records rather than a helper in each record's own utils: the
// wording is the same sentence about different counts, and the cascade is one rule.
//
// Counts come from what the page has already loaded. Only a member is offered a delete, and
// a member sees everything, so what they are shown is the whole of it.

import { buildCount } from "../components/count.js";

// A submission a worker still holds. Deleting it is allowed and takes the run with it — see
// the DELETE endpoints.
const RUNNING = ["validating", "scoring"];

// ─── COUNTS ──────────────────────────────────────────────────────────────────

// Every task entry nested under a set of submissions. A listing's submissions carry none, so
// callers with only those pass their entries in separately.
function entriesIn(submissions) {
  return submissions.flatMap((submission) => submission.task_submissions ?? []);
}

function runningIn(submissions) {
  return submissions.filter((submission) => RUNNING.includes(submission.status));
}

// ─── WORDING ─────────────────────────────────────────────────────────────────

/**
 * The lines a confirmation lists, from counts the caller has taken.
 *
 * A count of zero is left out rather than listed as none: the card says what goes, and a
 * record with no submissions should not be told it is losing 0 of them.
 *
 * @param models      how many models. Omit for none.
 * @param submissions how many submissions, whose files go with them. Omit for none.
 * @param entries     how many task entries. Omit for none.
 * @param scores      how many of those entries carry a score. Omit for none.
 * @param members     how many team memberships — the users themselves are kept. Omit for none.
 * @param running     how many submissions a worker is still checking or scoring. Omit for none.
 * @param files       word the submissions' files as their own line, for a record whose own
 *                    file is the thing a reader would miss. Omit where the submission count
 *                    already implies them.
 *
 * @returns the lines, in reading order.
 */
function toDeleteItems({
  models = 0,
  submissions = 0,
  entries = 0,
  scores = 0,
  members = 0,
  running = 0,
  files = 0,
}) {
  return [
    models && buildCount(models, "model"),
    submissions && buildCount(submissions, "submission"),
    entries && buildCount(entries, "task entry"),
    scores && buildCount(scores, "score"),
    files && `${buildCount(files, "uploaded file")}, deleted from storage`,
    members && `${buildCount(members, "team membership")} — the accounts themselves are kept`,
    running &&
      `${buildCount(running, "submission")} still being checked or scored, which will stop`,
  ].filter(Boolean);
}

// ─── PER RECORD ──────────────────────────────────────────────────────────────

// The submission's own file is named: it is the thing the reader uploaded, and the one part
// of this that is not a row in a table.
function getSubmissionDeleteItems(submission) {
  const entries = submission.task_submissions ?? [];

  return toDeleteItems({
    entries: entries.length,
    scores: entries.filter((entry) => entry.score).length,
    files: 1,
    running: runningIn([submission]).length,
  });
}

function getModelDeleteItems(model) {
  const submissions = model.submissions ?? [];
  const entries = entriesIn(submissions);

  return toDeleteItems({
    submissions: submissions.length,
    entries: entries.length,
    scores: entries.filter((entry) => entry.score).length,
    files: submissions.length,
    running: runningIn(submissions).length,
  });
}

/**
 * What a team's delete takes, from the three listings its page loads.
 *
 * @param team            the team record, for its member list.
 * @param models          the team's models.
 * @param submissions     the team's submissions. List items, so they nest no task entries.
 * @param taskSubmissions the team's task entries, which is where the scores are counted.
 */
function getTeamDeleteItems({ team, models, submissions, taskSubmissions }) {
  return toDeleteItems({
    models: models.length,
    submissions: submissions.length,
    entries: taskSubmissions.length,
    scores: taskSubmissions.filter((entry) => entry.score).length,
    files: submissions.length,
    members: (team.members ?? []).length,
    running: runningIn(submissions).length,
  });
}

export { getModelDeleteItems, getSubmissionDeleteItems, getTeamDeleteItems, toDeleteItems };

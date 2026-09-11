# Upload & validation lifecycle TODO

Every way a submission's file can stall, fail or be abandoned, what the code does about it
now, and what is wrong with that. Written as a walkthrough to decide from; nothing here is
built yet.

The flow it audits is the one in the code: panels 1-2 create the row, panel 3 uploads the
file to S3 in parts, a Celery task validates it while panel 4 is filled in, and `submit`
carries the tasks. Numbered items are the order to decide them in — each is useful alone, and
the later ones get cheaper if the earlier ones land.

## The state table

What the submitter and the bucket are left with, per scenario, as the code stands.

| Scenario | Status | In S3 | Route back |
| --- | --- | --- | --- |
| Part `PUT` fails transiently | `uploading` | parts kept | none needed — retried in the driver |
| Signature expires, credentials rotate | `uploading` | parts kept | none needed — re-signed via `GET /{id}/upload` |
| Retries exhausted | `uploading` | parts kept | re-pick the same file; resumes |
| Remove pressed | row deleted | released | pick again |
| Remove pressed, `DELETE` fails | `uploading` / `validating` | kept | the details page's Delete |
| Tab closed, crash, reload | `uploading` | **kept indefinitely** | retype label + same file; resumes, or Delete from the details page |
| Different file, different size | `uploading`, restarted | old parts aborted | automatic |
| Different file, same size | `uploading`, resumed wrongly | old parts reused | **none** — silently wrong |
| Assembled object over the limit | `invalid` | deleted | upload a smaller file, same label |
| Validation finds faults | `invalid` | **deleted** | fix the file, re-upload under the same label |
| Validation raises | `unchecked` | **kept** | full re-upload only |
| Worker killed mid-task | **`validating` forever** | kept | Delete from the details page |
| Task hangs, worker alive | **`validating` forever** | kept | Delete from the details page |
| Broker message lost | **`validating` forever** | kept | Delete from the details page |
| Passed, tab closed | `pending` | kept | the details page — Delete, or submit it |
| Scoring raises | `failed` | kept | Delete from the details page, or a new label |

## Cross-cutting

Four things that fall out of the whole walkthrough rather than any one scenario.

- ~~**`deleteSubmission` is called from exactly one place in the frontend**~~ — **done**, see
  `deletion_plan_todo.md`. The details view of every record page now carries a Delete, and
  `DELETE /api/submissions/{id}?force=true` drops the status rule the Remove button keeps. Every
  stranded state above has a route the submitter can take, and the reaper is left as cleanup
  for people who never come back.
- **One constant, three uses.** "The longest a legitimate validation or scoring run can
  take" is needed by the sweep threshold, Redis's `visibility_timeout` and the soft time
  limit. Estimate it once, with the same numbers as `worker_disk_plan_todo.md`.
- **A stale `validating` row has three causes needing three mechanisms.** No single one
  covers all three, and a sweep is unsafe for the middle row unless the task can be killed.

  | Cause | `acks_late` redelivery | Sweep on `updated_at` | Soft time limit |
  | --- | --- | --- | --- |
  | Worker died mid-task | fixes it | recovers the row, work lost | no |
  | Task hung, worker alive | no | **unsafe** — original still running | fixes it |
  | Message lost before execution | no | fixes it | no |

- **`unchecked` and `invalid` are asymmetric on purpose, and only `invalid` frees space.**
  Both of our own failure modes keep the object; the submitter's fault is the one that
  deletes it.

## 1. Worker restarts mid-task

**Now.** `app/worker.py:13` sets only `task_track_started`. So `task_acks_late` is the
default `False`: the broker message is acked when the worker *receives* it, before the body
runs. `docker-compose.yml:90` sets no `stop_grace_period`, so Compose sends SIGTERM and
SIGKILLs after 10 s — not enough for Celery's warm shutdown to finish a multi-GB validation.
No `--concurrency` either, so it defaults to the core count.

**Problems.**

- A worker killed while running loses the task outright; nothing redelivers it. The row
  stays `validating`, which `DELETE` refuses and create-or-restart 409s. Wedged, permanently.
- Every deploy that lands during a validation or a scoring run does this. Not exotic.
- `_start_validation` (`app/tasks/validate.py:100`) and `_start_scoring`
  (`app/tasks/score.py:46`) set their status unconditionally on whatever row they find. So any
  redelivery, once enabled, could drag a `scoring` row back to `validating` and discard the
  scoring run, or re-score a `done` one and rewrite its `TaskScore` rows.
- Default concurrency × per-job scratch (zip + extracted tree + ground truth) is the disk
  exposure in `worker_disk_plan_todo.md`, on a volume shared with Postgres.

**Approach.** In this order, each useful alone:

1. Status guards in both tasks, admitting `{validating, unchecked}` and returning early
   otherwise. Precondition for anything that can re-run. `unchecked` must be admitted or
   item 3 breaks.
2. `stop_grace_period` long enough for a warm shutdown. Fixes the common (deploy) case
   without touching delivery semantics.
3. `task_acks_late = True`, `worker_prefetch_multiplier = 1`, `visibility_timeout` above the
   longest plausible task. Survives a genuine crash.
4. Explicit `--concurrency`, from the disk budget rather than the core count.

`worker_prefetch_multiplier` is not parallelism: it is `multiplier × concurrency` messages
*reserved*. At the default 4 one worker hoards up to 32 while another idles, and under
`acks_late` a crash strands all of them until `visibility_timeout`.

## 2. `validating` with nothing coming for it

**Now.** Nothing at any layer. No `task_time_limit` or `task_soft_time_limit`, so a task runs
forever. No Celery beat service. Nothing reads `updated_at`. `validating` is out of
`ABANDONABLE`, 409s in create-or-restart, and is refused by `submit`. The only fix is a manual
`UPDATE`. The submitter sees a spinner that never resolves — `submissionValidation.js` stops
polling only on a state that is not `validating`.

`scoring` has the same shape, with `done`/`failed` as the states it never reaches.

**Problems.**

- Unreachable by every route the API offers.
- A hung task holds a concurrency slot and its scratch space indefinitely.

**Approach.** `updated_at` is `onupdate=func.now()` (`app/models.py:269`) and bumps at task
start, so "at `validating`, `updated_at` older than T" is the staleness test with no new
column. T must exceed the longest legitimate run.

- A **soft** time limit is the cheap win: it raises inside the task, `validate_submission`
  already catches everything and lands `unchecked` with the file kept, so a hang
  self-classifies correctly with no new code.
- A sweep on beat sets stale rows to `unchecked` rather than re-queueing — `unchecked` already
  means "our failure, file kept", is deletable and restartable, and item 3 makes it
  recoverable. Re-queueing needs an attempt counter (in the `validation` JSON) to avoid
  looping on a poison submission.

## 3. `unchecked` cannot be re-checked

**Now.** The `except` branch writes `_internal_error_document` (one `E999`), sets `unchecked`,
**keeps the object**, re-raises so Celery records a failure. The submitter is told "We could
not check this file … please contact us" (`submissionValidation.js:104`). `submit` refuses it.
`DELETE` works and deletes a good object. Create-or-restart accepts the label and mints a
fresh multipart over the same key — a full re-upload that silently overwrites a file that was
probably fine. Nothing re-runs the check against what is already there.

Yesterday's ground-truth bug is exactly this scenario.

**Works today, no code needed:**

```bash
docker compose exec -T worker uv run python -c \
  "from app.tasks.validate import validate_submission as v; v.delay('<submission-id>')"
```

`_start_validation` sets `validating` unconditionally, so it proceeds from `unchecked`. This
is why item 1's guard must admit `{validating, unchecked}` rather than `validating` alone.

**Approach.** `POST /api/submissions/{id}/revalidate` for team members (`admin` passes the
same check), re-queueing against the existing key. Accept `unchecked` unconditionally, and
`validating` only when `updated_at` is older than T — that second half gives item 2's wedged
rows a user-facing exit with no beat and no sweep, which makes item 1.3 and the sweep
optional rather than mandatory.

Alternatives: admin-only (turns our failure into a support ticket, against the point of the
`unchecked`/`invalid` split); the documented shell command only (fine while there are three
users); the sweep re-queueing automatically (needs the attempt counter).

## 4. Retry budget and error classification

**Now.** `frontend/js/api/upload.js`: `CONCURRENCY = 4`, `ATTEMPTS = 4`, `BACKOFF_MS = 500`,
and `sleep(BACKOFF_MS * attempt)` — linear, no jitter, so a part is abandoned ~3 s after its
first failure. One part exhausting its attempts rejects `send()` and surfaces as "Uploading
the file failed. Select it again to retry."

**Problems.**

- **3 s is the wrong order of magnitude** for a transfer that runs for an hour. A Wi-Fi
  handover, VPN reconnect or eduroam re-auth ends the upload. Recovery works but needs the
  submitter to still be there.
- **Nothing distinguishes permanent from transient.** `404 NoSuchUpload` (what the lifecycle
  rule will start producing), `400 EntityTooSmall` and the unreadable-`ETag` CORS error each
  burn four attempts and then report a generic failure. Meanwhile `503 SlowDown`, the one
  error where backing off is the documented response, gets the same 500 ms.
- **No per-part timeout.** `fetch` has no default one, so a connection that dies without
  closing hangs forever: the part never fails, never retries, the upload never completes or
  errors. The progress bar just stops.
- **A failed upload keeps uploading.** `Promise.all` rejects but does not cancel the other
  three workers, and `processFile`'s catch never calls `transfer.abort()`. `renderFailure`
  writes to `fileMessage` while `renderProgress` writes to `fileProgress`, so the progress bar
  climbs underneath the message saying it failed. A Remove click then races workers still
  PUTting to an upload being aborted.

**Approach.** The last two are bugs, not decisions: add a per-part timeout
(`AbortSignal.any([controller.signal, AbortSignal.timeout(ms)])`) and `abort()` on the failure
path. For the policy half: a small non-retryable set (400, 404, missing `ETag`) that fails
immediately with its own message, and exponential backoff with jitter — roughly six attempts
over a minute, per part, so several unrelated blips in one transfer all survive. Jitter
matters because 4 workers hit the same hiccup together.

Absorbing a closed laptop lid is a different feature (pause/resume, not retry) and not worth
building while re-picking works.

## 5. The Remove button

**Now.** `submissionUpload.js:278` aborts the transfer, stops polling, then **clears
`submissionId` and resets to the dropzone before awaiting the `DELETE`**. On failure it
renders "That file could not be discarded. Reload and try again."

**Problems.**

- The id is gone before the delete is known to have worked, so there is nothing to retry and
  the bytes stay in S3. A reload gives an empty form, not a route back.
- Dead while `validating`: from `completeUpload` resolving, the row is `validating` and
  `DELETE` 409s. The button is never disabled (no `disabled` handling in the widget), so it
  clears the card and then reports a conflict. A submitter who spots the wrong file mid-check
  must wait it out.
- It is the only caller of `deleteSubmission` anywhere in the frontend. See Cross-cutting.
- Minor: clicking Remove while `completeUpload` is in flight leaves that request to 404, and
  `processFile`'s catch renders "Uploading the file failed" over a dropzone the user just
  cleared.

**Approach.**

- Await the delete; clear `submissionId` and reset the card only on success. Not a decision.
- Disable Remove while `validating`, with the card saying why.
- ~~**Add a delete action to the listing or details page.**~~ **Done** — see
  `deletion_plan_todo.md`. It sits at the foot of each record's details view, behind a
  two-step confirmation, and sends `force` so a submitted or scored submission goes too.

~~Open question: should Remove abandon a `validating` submission?~~ Settled for the details
page's Delete, which abandons one at any status: `_start_validation`, `_finish_validation` and
`_finish_scoring` now return early on a row that has gone, as `_start_scoring` already did, and
the task ends `"gone"`. The create form's Remove still stops at `ABANDONABLE`. A sweep over a
stale `validating` row may therefore delete it safely.

## 6. Tab closed, crash, reload

**Now.** No `beforeunload` handler and no persisted client state — `submissionId` lives only
in the widget's closure, and nothing touches `localStorage`. So nothing is told and nothing is
released: the row stays `uploading` and the parts stay in S3. Recovery is to retype the same
label and model and pick the same file; create-or-restart matches on `file_size` and resumes
from what S3 holds.

**Problems.**

- The common case, and the one that leaks most: a large file, nothing released, and a
  submitter who may never return. With no reaper and no lifecycle rule this is permanent.
- Recovery depends on the submitter reconstructing the label exactly, with nothing in the UI
  telling them that is the mechanism.

**Approach.** Persisting `{submissionId, label, size}` per browser would let the page offer
"resume your upload" instead of relying on a retyped label. Server-side this is the reaper's
scenario, and the lifecycle rule (`deploy.md`) is its backstop — neither exists yet.

## 7. A different file of the same size

**Now.** `_restart_upload` resumes when `status == uploading` and `file_size` matches. The
client normally prevents the collision because the dropzone is hidden while a file is shown,
so a second pick must go through Remove first — which is what that function's comment is
defending.

**Problems.**

- A fresh page, or a Remove whose `DELETE` failed, reintroduces it: same label, same size,
  different bytes, and the parts already in S3 belong to the old file. S3 cannot tell. The
  result is a silently corrupt assembled object that then fails validation for reasons that
  make no sense to the submitter.
- Known in the plan as needing a content hash.

**Approach.** Have the client send a digest at create (or of the first and last part), stored
on the row, and resume only when it matches. Cheaper stopgap: fix item 5's ordering so the
failed-delete path stops producing this.

## 8. Retries exhausted, row left `uploading`

**Now.** The client reports "Select it again to retry" and stops. Nothing tells the server, so
the row stays `uploading` with its parts. Re-picking the file resumes them.

**Problems.** Indistinguishable server-side from scenario 6 — the same leak, the same absent
cleanup. If the submitter does not retry, the parts are billed forever.

**Approach.** Item 4 makes this rarer. Whether the client should `DELETE` on giving up is the
decision: it releases the parts immediately but throws away a resumable upload the submitter
might well come back to. Leaning towards keeping them and letting the reaper handle it, which
makes this item contingent on the reaper existing.

## 9. Oversize at completion

**Now.** `create_submission` already 422s on `file_size > max_submission_bytes` and on more
than `MAX_PARTS` parts, before any bytes move — so an honest browser never reaches the
completion path. A client that understates the size does: `complete_upload` assembles the
object, measures it with `head_object`, sets `invalid`, records the real `file_size`, deletes
the object, raises 413.

**Problems.**

- No `validation` document is written, so `GET /{id}/validation` answers
  `state: invalid, errors: [], n_files: 0` and `buildValidationCodes([], 0)` renders "This file
  contains no prediction files in the expected layout." Untrue. The 413 text does reach the
  user appended to the upload-failure message, so the panel contradicts the message above it.
- It materialises an oversize object in order to delete it.

**Approach.** `ListParts` returns a `Size` per part and is already called on the resume path,
so the sum can be checked before `complete_multipart`: over the limit means
`abort_multipart` and nothing ever assembled, with `head_object` kept as the second check on
what was stored. Either way write a one-code document — the precedent is
`_internal_error_document` synthesising `E999` — so the panel names the real reason.
`user_message` falls back to a generic string for unknown codes, so this is one entry in
`SPECIFIC_MESSAGES`.

Worth deciding first whether the 20 GB limit is a real constraint (worker disk, S3 cost) or a
placeholder, and how big a genuine ts1+ts2+ts3 submission actually is.

## 10. `invalid`: delete now or hold

**Now.** Validation writes the capped codes, sets `invalid`, deletes the object from S3 and
logs every `Finding.detail` against the submission id. The row survives so the codes outlive a
reload. A corrected file needs a full re-upload, which is unavoidable — S3 objects cannot be
edited, and a corrected file is a different object.

**Problems.**

- The file we just refused is gone before anyone can look at it. When a submitter disputes a
  verdict, or a check turns out to be wrong, the evidence is only in the worker log.
- Not every `invalid` came from validation — the oversize path (item 9) lands here with no
  codes at all.

**Approach.** Either keep deleting immediately (cheapest, and the codes plus `detail` in the
log have been enough so far), or hold the object for a short window before deleting so a
disputed verdict can be re-examined. Holding needs the reaper to do the deleting, so it is
contingent on the sweep existing. Storage cost of a few days of rejected submissions is the
number to weigh.

## 11. `failed` and `done`: who reclaims the object

**Now.** Neither is in `ABANDONABLE`, so `DELETE` refuses both. `score_submission` catches
everything, calls `_finish_scoring(..., failed, ...)` and re-raises; the object stays in S3.

**Problems.**

- A scoring crash leaves a large object with no route to remove it — not for the submitter,
  not for us, and no reaper. The submitter's only move is a new submission under a different
  label.
- `done` keeping its object is deliberate (re-scoring, disputes) but nothing ages it out, so
  the bucket grows without bound.

**Approach.** Add `failed` to `ABANDONABLE`: it is a dead end by definition and holds nothing
worth keeping. For `done`, the lifecycle transition to Infrequent Access in `deploy.md` is the
answer rather than deletion. A re-score endpoint, mirroring item 3's revalidate, would make
`failed` recoverable instead of merely deletable — the file is intact and it is our failure,
the same argument as `unchecked`.

## Carried over

Open points from the validation plan that these eleven items do not otherwise cover. The plan
itself is gone: phase 1 is built, and what follows is its residue.

- **May a submitter configure only some of the tasks in their file?** `submit` refuses tasks
  validation did not find; nothing says whether every task it *did* find must be submitted.
  Settled across suites — a submission may span them and all of them score. Within a suite it
  is open, and allowing a subset is the recommendation: the leaderboard is per-task, so seven
  of eight ts1 tasks ranks on seven.
- **`abort_multipart` must tolerate `NoSuchUpload`.** If `complete_multipart` succeeds and the
  commit after it fails, the row keeps an `upload_id` for an upload S3 has already finished,
  and the restart path then tries to abort it. Today that is a lost race; a bucket lifecycle
  rule makes it weekly.
- **Bucket lifecycle rules** — `AbortIncompleteMultipartUpload`, and an IA transition for
  scored submissions. One bucket call (`docs/deploy.md` carries it), but it creates a state
  the endpoints do not handle: an `uploading` row whose upload S3 has already discarded. It
  needs `list_parts` returning `dict | None` — `{}` reads as "no parts yet" and would sign
  URLs for a dead upload — `abort_multipart` tolerating `NoSuchUpload` as above, and 409
  rather than 500 from `get_upload`, `complete_upload` and the resuming branch of
  `_restart_upload`. Both tests are a one-line monkeypatch; `tests/api/test_submissions.py`
  already stubs `list_parts` on the router.
- **No rate limiting anywhere.** Pre-flight accepts up to `MAX_PREFLIGHT_ENTRIES` strings and
  does real work per call; every create reserves a billable multipart upload. Neither is
  bounded per caller.
- **Delete racing submit can 500 the submit.** The reverse order is handled, this one is not.
  Wants row locking, or database-level cascades so a conditional delete becomes possible.
- **A label collision between two team members races.** `_check_valid_submission_label` checks
  then acts, so simultaneous creates surface an `IntegrityError` rather than a clean 409.
- **The reaper needs no new column.** `updated_at` already follows every write, including a
  restart, so "stuck in `uploading` since" is answerable without an `upload_started_at`.

## Fine as built

Checked and needing nothing.

- **Transient retry within the driver** — the mechanism is right; only its budget is wrong
  (item 4).
- **Re-signing on a 403.** `error.expired` is tagged, `refreshUrls()` re-signs everything
  still owed rather than one part per round trip, concurrent workers share the request through
  `resigning ??=`, and the retry is immediate. The path most likely to run in normal operation
  — instance credentials rotate roughly every six hours — and the best-built part of the
  driver.
- **A different file of a different size.** `_restart_upload` aborts the old multipart and
  starts a fresh one. Its only residual is `abort_multipart` tolerating `NoSuchUpload` —
  see Carried over, below.
- **A worker that is down before receiving the message.** It waits in Redis and runs on
  restart. Only a worker dying *while running* loses the task (item 1).

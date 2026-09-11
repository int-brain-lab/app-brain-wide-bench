# Validation fixtures

Submission zips that fail validation on purpose, one per error code, for exercising the
failure paths without hand-editing safetensors.

```bash
uv run python scripts/make_bad_submissions.py --out ~/bwb-bad-submissions
```

Writes `ground_truth/` plus one `<code>.zip` per failure, and `valid.zip`. About 200 KB.

Point the API at *that* ground truth — the zips only mean anything against it — and restart
both uvicorn and the worker, since `--env-file` is read at startup:

```
S3_GT_PREFIX=/home/<you>/bwb-bad-submissions/ground_truth
```

## The script checks its own work

Each zip is validated after it is written, and the table printed is what the API will
report, not what the script intended:

```
zip        wanted   reports     why
valid.zip  valid    —           nothing wrong with it
E101.zip   E101     E101×1      fewer seeds than a task needs
E011.zip   E011     E011×3      a recording the ground truth has never heard of
```

A `!` means the intended code stopped firing, so the script has drifted from the validator
and one of them is wrong.

## Where each failure surfaces

Group A never opens a file, so it runs in the browser's round trip *before* the upload.
Group B needs the predictions themselves, so it runs in the worker afterwards.

| | Codes | Seen |
| --- | --- | --- |
| Group A | E004, E005, E013, E014, E101–E106 | under the layout-check step, no submission created, nothing uploaded |
| Group B | E001, E002, E003, E006–E012, E107, E109 | in the file panel after the upload, submission left `invalid` and its file deleted |

`E104` sits in Group A but needs the ground-truth tree, so prevalidation catches it only
where the API can read `S3_GT_PREFIX` from local disk. Against a real bucket it is caught
after the upload instead.

So the Group B zips are the ones that exercise the whole path — create, transfer, complete,
worker, verdict — and the Group A ones are the fast loop.

## The two message families

A submitter never sees a code's internal detail, and most codes share one deliberately vague
sentence so the checks cannot be reverse-engineered from error text.

| | Codes | Message |
| --- | --- | --- |
| Specific | E101–E109 | names the problem: *"Each task needs at least 3 distinct seeds…"* — facts about the submitter's own data, safe to state |
| Generic | E001–E014, E999 | *"…use the benchmark's prediction-saving infrastructure… contact us with this error code"* |

`E101.zip` against `E006.zip` is the pair to compare.

Widening the specific family to the codes that describe only the submitter's own file
(E001–E005, E013, E014) was considered and rejected: the split stays where it is, so a
submitter hitting E001 quotes the code rather than being told which field is missing.

## What to check while trying them

- **No internal detail in the browser.** `E011`'s detail names a ground-truth path and
  `E101`'s names the seeds found. Both belong in the worker log and nowhere else. The
  response carries `code`, `message`, `path` and nothing more.
- **`valid.zip` is multi-suite** — ts1, ts2 and ts3 in one archive. Scoring runs one scorer
  per suite and merges the results, which nothing else here exercises.
- **`E005.zip` reports six findings** and `E011.zip` three, so they show what more than one
  row looks like.
- **Findings are capped** at 20 per code, with the remainder counted in `omitted`. None of
  these zips is big enough to hit that; the 8.4 GB baseline in `~/Downloads/fixtures` is.

## E108 needs configuration

A dataset version can only be out of range if a range is set. `E108.zip` carries version
`9.9.9` and reports nothing until:

```
MAX_DATASET_VERSION=2.0.0
```

The script labels it rather than flagging it as a failure.

## E999 is not here

It means validation could not be run at all — S3 unreachable, a bug in a check — so it is
not a property of any file. It leaves a submission `unchecked` rather than `invalid`, and the
file is kept. Provoke it by pointing `STUB_SUBMISSION_DIR` somewhere that does not exist.

## The other fixture

`tests/fixtures/submissions.py` writes one tiny valid ts1 pair and is what the test suite
uses; the script above is the multi-suite, every-failure sibling. They are separate because
the tests want the smallest thing that passes, and this wants breadth.

Both write ground truth that is *scorable*, not merely valid — validation reads only
`trial_id` from it while scoring reads `values`, and a fixture satisfying the first can still
fail the second.

## Real baseline data

`~/Downloads/fixtures` has genuine ground truth (flat-task-rooted, all three suites) and two
baseline zips. They pass Group A completely, and fail Group B with `E001` on every file:
neither carries `unit_filtering` or `dataset_version`, and the ts1 predictions are 2-D where
the validator wants 3-D.

That is worth knowing before reading it as a bug in the flow — the validator enforces a
contract the baseline data in circulation does not yet meet. `tests/fixtures/sample.zip` is
the same. Whether the data is stale or the validator is ahead of the writer is a question for
whoever owns the prediction format.

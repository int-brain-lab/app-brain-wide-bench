# Baselines fixture

The official baselines, scored from local prediction files and written as the flat fixture
`tests/fixtures/load.py` inserts. No database, no S3, no Celery.

```bash
uv run python scripts/make_baselines.py
uv run python scripts/load_fixtures.py --data-only tests/fixtures/2026_09_baselines.json
```

Paths default to `~/Downloads/new_brainwidebench_data`; `--data-root` moves all three at once,
`--pred-root`, `--gt-root` and `--metadata` move one.

## What decides what

`bwb_models.json` is the source of truth for what exists — models, submissions, labels, and
each task entry's methodology. The prediction files decide only the numbers.

```
<pred-root>/<submission-label>/<flat-task>/[<recording_id>/]seed_*.safetensors
<gt-root>/<flat-task>/[<recording_id>/]ground_truth.safetensors
```

A submission's directory is named after its label, so a submission with no directory yet is
listed and left out rather than being an error. Re-run when it lands.

The suites to score come from the task ids that submission enters, not from its directory
name: `ndt-stitch-ts1-ts2-baseline` runs the ts1 and ts2 scorers over the one directory and
merges the results, as `app/tasks/score.py` does. Task ids are unique across suites, so the
merge cannot collide.

A model has as many submissions as the metadata declares. POYO+ has one ts1 submission and
four ts3 probe variants.

## Reruns

| | Scores | Keeps |
| --- | --- | --- |
| *(no flag)* | everything on disk | nothing |
| `--resume` | only submissions with no score in the fixture | the rest |
| `--only <label>` | that label, repeatable | every other submission |
| `--dry-run` | nothing | reports what is on disk and what is still missing |

`--only` keeps the rest deliberately: without it, restricting a run would rewrite the fixture
down to the one submission named. The fixture is also rewritten after each submission, so an
interrupt keeps what has already scored.

Row ids are `uuid5` from natural keys and the timestamp is fixed, so a re-run of the same
inputs is byte-identical.

## Checks the script makes

- a metadata key that is not a column is a hard error, not a silent no-op
- enum values are matched case-insensitively by name or value — `"tsu"` is stored as `TSU`
- a task id outside the `tasks` lookup, a duplicate label, or a task entered twice exits
- task folders on disk are compared against the tasks the metadata declares, both ways
- a directory under `<pred-root>` that no submission claims is named and ignored

## State on 2026-09-10

15 of 43 declared submissions had predictions: 9 models, 64 task entries, 59 scores. The ts1
means match the previous scoring run exactly.

**ts3 needs two compatibility aliases.** The predictions call the task `ts3-unit_cosmos` and
the unit ids `entity_ids`; the installed `ibl_bwb_eval` reads `ts3-cosmos` and `unit_ids`, so
ts3 scored nothing at all. `make_baselines.py` aliases both — a symlinked ground-truth tree
and a temp copy of the prediction files with the tensor renamed. The content is the same
array: all 3222 units match the ground truth. Both aliases go inert once the eval package
agrees, and the fix belongs there: nothing in the `ibl-benchmark` checkout mentions
`entity_ids`, so those predictions came from newer code than `main`.

**`poyo-plus-ts1-baseline` scores 3 of its 8 tasks** and is left `failed`. Its timestep-level
predictions are `(148, 50)` where every other baseline writes `(148, 50, 1)`, and
`ibl_bwb_eval.scoring.ts1.score_file` needs the trailing dimension — 725 of 1160 files fail
with `not enough values to unpack (expected 3, got 2)`. The three categorical tasks are
unaffected. Not shimmed: reshaping a submitter's predictions is a guess in a way that
renaming a key with identical content is not.

**Every submission is `is_public: false`**, as the metadata declares, so a signed-out visitor
sees none of them. `--public` overrides it for a local look at the leaderboard.

`baselines/cnn-ts1-baseline/cnn/cnn/` is an empty stray directory. It holds no predictions and
is reported as "on disk but not declared".

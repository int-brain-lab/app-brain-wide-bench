"""Build a submission tree on disk, valid by default.

The validator only ever accepts a *pair*: predictions, and the ground truth their
``trial_id`` is checked against. So this writes both, and a test states its case as a
deviation from a valid submission rather than as a fixture of its own.

    pred_dir, gt_dir = write_submission(tmp_path)                       # passes
    pred_dir, gt_dir = write_submission(tmp_path, seeds=(1,))           # E101
    pred_dir, gt_dir = write_submission(tmp_path, metadata={"unit_filtering": None})  # E001
"""

from pathlib import Path

import torch
from safetensors.torch import save_file

# ts1-reward's readout is 2-dimensional; ``get_ts1_readout_spec`` is what enforces it.
TASK = "ts1-reward"
DIMS = 2

LABEL = "mlp"
RECORDING = "rec1"
SEEDS = (1, 2, 3)
TRIALS = 4

DATASET_VERSION = "1.0.0"
UNIT_FILTERING = "all_units"


def _metadata(seed: int, task: str, label: str, recording: str, overrides: dict | None) -> dict:
    """The metadata of a valid prediction file, with ``overrides`` applied.

    A key whose override is ``None`` is dropped, which is how a test asks for E001.
    """
    metadata = {
        "label": label,
        "task": task,
        "seed": str(seed),
        "recording_id": recording,
        "unit_filtering": UNIT_FILTERING,
        "dataset_version": DATASET_VERSION,
    }
    metadata.update(overrides or {})

    return {key: value for key, value in metadata.items() if value is not None}


def write_submission(
    root: Path,
    *,
    label: str = LABEL,
    task: str = TASK,
    recording: str = RECORDING,
    seeds: tuple[int, ...] = SEEDS,
    trials: int = TRIALS,
    dims: int = DIMS,
    metadata: dict | None = None,
    predictions: torch.Tensor | None = None,
    gt_trial_ids: list[int] | None = None,
    ground_truth: bool = True,
) -> tuple[Path, Path]:
    """Write a prediction tree under ``root/pred`` and its ground truth under ``root/gt``.

    Parameters
    ----------
    seeds : tuple[int, ...]
        One file per seed. Non-contiguous or fewer than three drives the seed checks.
    dims : int
        Last dimension of ``predictions``. Anything but ``DIMS`` is E006 for this task.
    metadata : dict | None
        Applied over the valid metadata. ``None`` as a value drops that key.
    predictions : torch.Tensor | None
        Replaces the generated tensor, for NaN and shape cases.
    gt_trial_ids : list[int] | None
        Ground truth's ``trial_id``. Differing from the predictions' is E012.
    ground_truth : bool
        Write it at all. ``False`` is E011.

    Returns
    -------
    tuple[Path, Path]
        ``(pred_dir, gt_dir)``, as :func:`validate_folder` takes them.
    """
    pred_dir = root.joinpath("pred")
    gt_dir = root.joinpath("gt")

    trial_id = torch.arange(trials, dtype=torch.int64)
    tensor = predictions if predictions is not None else torch.zeros(trials, 1, dims)

    for seed in seeds:
        target = pred_dir.joinpath(label, task, recording, f"seed_{seed}.safetensors")
        target.parent.mkdir(parents=True, exist_ok=True)

        save_file(
            {"predictions": tensor, "trial_id": trial_id},
            str(target),
            metadata=_metadata(seed, task, label, recording, metadata),
        )

    if ground_truth:
        target = gt_dir.joinpath(task, recording, "ground_truth.safetensors")
        target.parent.mkdir(parents=True, exist_ok=True)

        ids = torch.tensor(gt_trial_ids, dtype=torch.int64) if gt_trial_ids else trial_id
        save_file({"trial_id": ids}, str(target))

    return pred_dir, gt_dir

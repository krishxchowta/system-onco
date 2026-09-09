"""Acquire aligned BraTS NIfTI subjects and prepare a MONAI DataLoader.

Hugging Face Datasets streams the JSONL metadata, not the voxel arrays.
Each selected subject's five files are downloaded with huggingface_hub.
No inference, training, or LLM is run here.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from itertools import islice
from pathlib import Path, PurePosixPath
from typing import Any

DEFAULT_REPO = "MedOtter/brats2023-gli-dataset"
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "data"
SPATIAL_SIZE = (224, 224, 144)
MODALITIES = ("t1", "t1c", "t2", "flair")
ALIASES = {
    "t1": ("t1n", "t1"),
    "t1c": ("t1c", "t1ce"),
    "t2": ("t2w", "t2"),
    "flair": ("t2f", "flair"),
}


def resolve_remote_path(raw_path: str, files: set[str], by_name: dict[str, list[str]]) -> str:
    """Resolve the source card's stale data/nii prefixes without guessing files."""
    if not isinstance(raw_path, str) or not raw_path.endswith((".nii", ".nii.gz")):
        raise ValueError(f"Expected a NIfTI path, got {raw_path!r}")
    if raw_path in files:
        return raw_path
    matches = by_name.get(PurePosixPath(raw_path).name, [])
    if len(matches) == 1:
        return matches[0]
    raise ValueError(f"Cannot uniquely resolve {raw_path!r}: {len(matches)} matches in repository")


def acquire_subjects(repo: str, revision: str, limit: int, output: Path) -> tuple[list[dict], str]:
    from datasets import load_dataset
    from huggingface_hub import HfApi, hf_hub_download

    # None permits the user's stored `hf auth login` credential without logging it.
    token = os.environ.get("HF_TOKEN") or None
    api = HfApi(token=token)
    commit = api.dataset_info(repo, revision=revision).sha
    if not commit:
        raise ValueError("Hugging Face did not return a dataset revision")
    files = set(api.list_repo_files(repo, repo_type="dataset", revision=commit))
    if "train.jsonl" not in files:
        raise ValueError("This adapter requires train.jsonl with modalities, mask and patient_id. "
                         "For other BraTS layouts, download the NIfTI files and use --local-root.")
    by_name: dict[str, list[str]] = defaultdict(list)
    for filename in files:
        by_name[PurePosixPath(filename).name].append(filename)
    download_args = dict(repo_id=repo, repo_type="dataset", revision=commit, token=token)
    metadata_path = hf_hub_download(filename="train.jsonl", **download_args)
    rows = load_dataset("json", data_files={"train": metadata_path}, split="train", streaming=True)
    subjects: list[dict] = []
    seen: set[str] = set()
    for row in islice(rows, limit):
        patient = row.get("patient_id")
        if not isinstance(patient, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", patient):
            raise ValueError("Metadata has an invalid patient_id")
        if patient in seen:
            raise ValueError(f"Duplicate patient_id: {patient}")
        seen.add(patient)
        source_modalities = row.get("modalities")
        if not isinstance(source_modalities, dict):
            raise ValueError(f"{patient}: expected a modalities mapping")
        paths = []
        for canonical in MODALITIES:
            raw = next((source_modalities[key] for key in ALIASES[canonical] if source_modalities.get(key)), None)
            if raw is None:
                raise ValueError(f"{patient}: missing {canonical} sequence")
            paths.append(resolve_remote_path(raw, files, by_name))
        mask = resolve_remote_path(row.get("mask"), files, by_name)
        if len(set(paths + [mask])) != 5:
            raise ValueError(f"{patient}: repeated image/mask files")
        print(f"Downloading {patient} (4 sequences + mask)", flush=True)
        local_paths = [str(Path(hf_hub_download(filename=path, local_dir=output / "raw", **download_args)).resolve()) for path in paths + [mask]]
        subjects.append({"subject_id": patient, "image": local_paths[:4], "label": local_paths[4]})
    if not subjects:
        raise ValueError("The dataset contains no subjects")
    return subjects, commit


def discover_local_subjects(root: Path, limit: int) -> list[dict]:
    """Pair legacy *_t1ce and newer *-t1c names by directory AND subject ID."""
    if not root.is_dir():
        raise ValueError(f"Local root does not exist: {root}")
    groups: dict[tuple[Path, str], dict[str, str]] = defaultdict(dict)
    alias_map = {alias: name for name, aliases in ALIASES.items() for alias in aliases}
    alias_map["seg"] = "label"
    pattern = re.compile(r"^(.*)[_-](t1n|t1ce|t1c|t1|t2w|t2f|t2|flair|seg)\.nii(?:\.gz)?$", re.I)
    for path in sorted(root.rglob("*.nii*")):
        match = pattern.fullmatch(path.name)
        if not match or not path.is_file():
            continue
        subject_id, suffix = match.groups()
        key = (path.parent, subject_id)
        name = alias_map[suffix.lower()]
        if name in groups[key]:
            raise ValueError(f"Ambiguous {name} files for {subject_id} in {path.parent}")
        groups[key][name] = str(path.resolve())
    subjects = []
    for (_, subject_id), modalities in sorted(groups.items()):
        missing = set((*MODALITIES, "label")) - modalities.keys()
        if missing:
            raise ValueError(f"{subject_id}: missing {', '.join(sorted(missing))}. Use a complete training-data directory.")
        subjects.append({"subject_id": subject_id, "image": [modalities[k] for k in MODALITIES], "label": modalities["label"]})
        if len(subjects) == limit:
            break
    if not subjects:
        raise ValueError("No BraTS subjects found; expected *-t1n/t1c/t2w/t2f/seg.nii.gz or legacy *_t1/t1ce/t2/flair/seg.nii.gz")
    return subjects


def validate_subject(subject: dict) -> None:
    """Fail before transforms if modalities are corrupt, non-finite or misaligned."""
    import nibabel as nib
    import numpy as np

    paths = subject["image"] + [subject["label"]]
    if len(subject["image"]) != 4 or len(set(paths)) != 5:
        raise ValueError("A subject requires four distinct MRI sequences and one distinct mask")
    reference = nib.load(paths[0])
    if len(reference.shape) != 3:
        raise ValueError(f"Expected 3D NIfTI volumes, got {reference.shape}")
    if not np.isfinite(reference.affine).all() or abs(np.linalg.det(reference.affine[:3, :3])) < 1e-8:
        raise ValueError("Invalid NIfTI affine")
    for index, path in enumerate(paths):
        volume = nib.load(path)
        if volume.shape != reference.shape or not np.allclose(volume.affine, reference.affine, atol=1e-4, rtol=0):
            raise ValueError(f"Unaligned volume: {path}. Register/resample the study before ingestion.")
        values = volume.get_fdata(dtype=np.float32)
        if not np.isfinite(values).all():
            raise ValueError(f"Non-finite voxel values: {path}")
        if index < 4 and not np.any(values != 0):
            raise ValueError(f"Empty MRI sequence: {path}")
        if index == 4 and (np.any(values < 0) or not np.equal(values, np.floor(values)).all()):
            raise ValueError(f"Segmentation mask must contain nonnegative integer labels: {path}")


def build_dataloader(subjects: list[dict], spatial_size: tuple[int, int, int] = SPATIAL_SIZE, *, validate: bool = True) -> Any:
    import torch
    from monai.data import DataLoader, Dataset
    from monai.transforms import Compose, EnsureTyped, LoadImaged, NormalizeIntensityd, Orientationd, ResizeWithPadOrCropd

    if not subjects:
        raise ValueError("Cannot create a DataLoader without subjects")
    if validate:
        for subject in subjects:
            validate_subject(subject)
    transform = Compose([
        LoadImaged(keys=["image", "label"], ensure_channel_first=True, image_only=True),
        Orientationd(keys=["image", "label"], axcodes="RAS", labels=None),
        NormalizeIntensityd(keys="image", nonzero=True, channel_wise=True),
        # Same deterministic spatial transform for all four channels and mask.
        # This is a Phase 1 baseline: center cropping may remove peripheral tumor.
        ResizeWithPadOrCropd(keys=["image", "label"], spatial_size=spatial_size, mode="constant"),
        EnsureTyped(keys="image", dtype=torch.float32, track_meta=True),
        EnsureTyped(keys="label", dtype=torch.int64, track_meta=True),
    ])
    # Zero workers is deliberate: portable on macOS and does not preload volumes.
    return DataLoader(Dataset(data=subjects, transform=transform), batch_size=1, shuffle=False, num_workers=0)


def positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return number


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=DEFAULT_REPO, help="Hugging Face dataset with the MedOtter JSONL schema")
    parser.add_argument("--revision", default="main", help="Dataset branch, tag, or commit; the resolved SHA is saved")
    parser.add_argument("--limit", type=positive_int, default=1, help="Maximum subjects to acquire (default: 1)")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--local-root", type=Path, help="Use already-downloaded BraTS training NIfTI files; no network")
    parser.add_argument("--verify", action="store_true", help="Iterate the DataLoader and check every selected batch")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    try:
        if args.local_root:
            subjects = discover_local_subjects(args.local_root.resolve(), args.limit)
            source = {"type": "local", "root": str(args.local_root.resolve())}
        else:
            subjects, commit = acquire_subjects(args.repo, args.revision, args.limit, output)
            source = {"type": "huggingface", "repo": args.repo, "revision": commit}
        for subject in subjects:
            validate_subject(subject)
        if args.verify:
            import torch
            for batch in build_dataloader(subjects, validate=False):
                if tuple(batch["image"].shape) != (1, 4, *SPATIAL_SIZE) or tuple(batch["label"].shape) != (1, 1, *SPATIAL_SIZE):
                    raise ValueError("Unexpected transformed batch dimensions")
                if not torch.isfinite(batch["image"]).all():
                    raise ValueError("Normalization produced non-finite values")
                print(f"Verified {batch['subject_id'][0]}: image {tuple(batch['image'].shape)}, mask {tuple(batch['label'].shape)}", flush=True)
        manifest = {"schema_version": 1, "source": source, "channel_order": list(MODALITIES), "spatial_size": list(SPATIAL_SIZE), "subjects": subjects}
        destination = output / "manifest.json"
        temporary = output / "manifest.json.tmp"
        temporary.write_text(json.dumps(manifest, indent=2) + "\n")
        temporary.replace(destination)
        print(f"Prepared {len(subjects)} subject(s). Manifest: {destination}")
        return 0
    except Exception as error:
        # Never print request headers or tokens. Errors retain their exception type.
        message = str(error)
        if os.environ.get("HF_TOKEN"):
            message = message.replace(os.environ["HF_TOKEN"], "[REDACTED]")
        print(f"Ingestion failed ({type(error).__name__}): {message}", file=sys.stderr)
        print("For access errors, accept the dataset's terms and run `hf auth login`. For local data use --local-root PATH.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

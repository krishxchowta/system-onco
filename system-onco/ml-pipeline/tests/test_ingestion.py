"""Small synthetic fixtures verify pairing and preprocessing without network."""
import tempfile
import unittest
from pathlib import Path

import nibabel as nib
import numpy as np
import torch

from ingest_brats import build_dataloader, discover_local_subjects, resolve_remote_path, validate_subject


class IngestionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        rng = np.random.default_rng(7)
        for suffix in ["t1n", "t1c", "t2w", "t2f"]:
            data = np.zeros((12, 16, 10), dtype=np.float32)
            data[2:10, 2:14, 2:8] = rng.normal(100, 20, (8, 12, 6))
            nib.save(nib.Nifti1Image(data, np.eye(4)), self.root / f"subject-{suffix}.nii.gz")
        mask = np.zeros((12, 16, 10), dtype=np.int16)
        mask[4:8, 5:9, 3:7] = 3
        nib.save(nib.Nifti1Image(mask, np.eye(4)), self.root / "subject-seg.nii.gz")

    def test_batch_shape_normalization_and_mask_integrity(self):
        subjects = discover_local_subjects(self.root, 1)
        self.assertTrue(subjects[0]["image"][0].endswith("t1n.nii.gz"))
        batch = next(iter(build_dataloader(subjects, spatial_size=(16, 16, 16))))
        self.assertEqual(tuple(batch["image"].shape), (1, 4, 16, 16, 16))
        self.assertEqual(tuple(batch["label"].shape), (1, 1, 16, 16, 16))
        self.assertEqual(batch["image"].dtype, torch.float32)
        self.assertEqual(batch["label"].dtype, torch.int64)
        self.assertEqual(set(torch.unique(batch["label"]).tolist()), {0, 3})
        self.assertEqual(int((batch["label"] == 3).sum()), 64)
        for channel in batch["image"][0]:
            voxels = channel[channel != 0]
            self.assertAlmostEqual(float(voxels.mean()), 0, places=5)
            self.assertAlmostEqual(float(voxels.std(unbiased=False)), 1, places=5)

    def test_missing_sequence_is_rejected(self):
        (self.root / "subject-t1c.nii.gz").unlink()
        with self.assertRaisesRegex(ValueError, "missing t1c"):
            discover_local_subjects(self.root, 1)

    def test_affine_mismatch_is_rejected(self):
        affine = np.eye(4)
        affine[0, 3] = 10
        path = self.root / "subject-t2f.nii.gz"
        nib.save(nib.Nifti1Image(np.ones((12, 16, 10), dtype=np.float32), affine), path)
        with self.assertRaisesRegex(ValueError, "Unaligned"):
            validate_subject(discover_local_subjects(self.root, 1)[0])

    def test_nonfinite_voxels_are_rejected(self):
        path = self.root / "subject-t2f.nii.gz"
        data = np.ones((12, 16, 10), dtype=np.float32)
        data[0, 0, 0] = np.nan
        nib.save(nib.Nifti1Image(data, np.eye(4)), path)
        with self.assertRaisesRegex(ValueError, "Non-finite"):
            validate_subject(discover_local_subjects(self.root, 1)[0])

    def test_metadata_prefix_resolution_and_ambiguity(self):
        files = {"training/subject-t1n.nii.gz"}
        self.assertEqual(resolve_remote_path("old/prefix/subject-t1n.nii.gz", files, {"subject-t1n.nii.gz": list(files)}), next(iter(files)))
        with self.assertRaisesRegex(ValueError, "uniquely"):
            resolve_remote_path("old/subject-t1n.nii.gz", files, {"subject-t1n.nii.gz": ["a", "b"]})


if __name__ == "__main__":
    unittest.main()

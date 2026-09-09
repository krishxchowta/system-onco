"""Pinned MONAI SegResNet inference. Predictions never consume reference masks."""
from pathlib import Path
import os
import numpy as np
import nibabel as nib
from nibabel.processing import resample_from_to, resample_to_output
import torch
from monai.networks.nets import SegResNet
from monai.inferers import sliding_window_inference

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / 'data/model/models/model.pt'
MODEL_REVISION = '370f7f9d062745fbac445e7fe6d6616d35df04ec'
REGIONS = ('Tumor Core', 'Whole Tumor', 'Enhancing Tumor')

def device_name():
    return 'cuda' if torch.cuda.is_available() else ('mps' if torch.backends.mps.is_available() else 'cpu')

def load_model(device):
    if not MODEL_PATH.exists():
        raise ValueError('Download the MONAI model using python setup_assets.py first.')
    model = SegResNet(blocks_down=(1, 2, 2, 4), blocks_up=(1, 1, 1), init_filters=16,
                      in_channels=4, out_channels=3, dropout_prob=0.2)
    state = torch.load(MODEL_PATH, map_location='cpu', weights_only=True)
    model.load_state_dict(state.get('model', state), strict=True)
    return model.eval().to(device)

def validate_images(paths):
    if len(paths) != 4:
        raise ValueError('Supply four aligned 3D NIfTI sequences: T1, T1c, T2, FLAIR.')
    images = [nib.load(str(p)) for p in paths]
    ref = images[0]
    if len(ref.shape) != 3 or np.prod(ref.shape) > 32_000_000:
        raise ValueError('Expected a 3D volume with at most 32 million voxels.')
    if not np.isfinite(ref.affine).all() or abs(np.linalg.det(ref.affine[:3, :3])) < 1e-8:
        raise ValueError('Invalid spatial affine.')
    if ref.header.get_xyzt_units()[0] not in ('mm', 'unknown'):
        raise ValueError('NIfTI spatial units must be millimeters.')
    for image in images:
        if image.shape != ref.shape or not np.allclose(image.affine, ref.affine, atol=1e-4):
            raise ValueError('Sequences are not aligned. Register them before analysis.')
        values = image.get_fdata(dtype=np.float32)
        if not np.isfinite(values).all() or not np.any(values):
            raise ValueError('MRI sequence contains non-finite values or is empty.')
    return images

def spatial_metrics(mask, affine, probabilities=None):
    masks = {'Tumor Core': (mask == 1) | (mask == 3), 'Whole Tumor': mask > 0,
             'Enhancing Tumor': mask == 3, 'Non-enhancing Core': mask == 1, 'Edema': mask == 2}
    voxel_volume = abs(float(np.linalg.det(affine[:3, :3])))
    centers = {name: np.argwhere(region).mean(0).tolist() if region.any() else None for name, region in masks.items()}
    score = None
    if probabilities is not None and masks['Whole Tumor'].any():
        score = float(probabilities[1][masks['Whole Tumor']].mean() * 100)
    center = centers['Tumor Core']
    return {'volumes': {name: round(float(region.sum()) * voxel_volume, 2) for name, region in masks.items()},
            'centers': centers, 'center_of_mass': center,
            'center_of_mass_mm': nib.affines.apply_affine(affine, center).tolist() if center else None,
            'coordinate_space': 'original_voxel', 'confidence_score': score,
            'confidence_kind': 'mean whole-tumor sigmoid probability; not calibrated diagnostic confidence',
            'voxel_volume_mm3': voxel_volume}

def save_aligned(array, reference, path, dtype):
    header = reference.header.copy()
    header.set_data_dtype(dtype)
    header.set_slope_inter(1, 0)
    output = nib.Nifti1Image(array.astype(dtype), reference.affine, header)
    output.set_qform(reference.get_qform(), int(reference.header['qform_code']))
    output.set_sform(reference.get_sform(), int(reference.header['sform_code']))
    nib.save(output, path)

def analyze(paths, output, progress=lambda stage, percent: None):
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    progress('Validating four aligned MRI sequences', 5)
    images = validate_images(paths)
    reference = images[0]
    # Match the bundle's native NIfTI axis convention, not a new RAS permutation.
    work_ref = reference
    if not np.allclose(nib.affines.voxel_sizes(reference.affine), [1, 1, 1], atol=0.01):
        work_ref = resample_to_output(reference, voxel_sizes=(1, 1, 1), order=1)
    channels = []
    for index in (1, 0, 2, 3):  # MONAI checkpoint order: T1c, T1, T2, FLAIR.
        image = images[index]
        if work_ref is not reference:
            image = resample_from_to(image, work_ref, order=1)
        values = image.get_fdata(dtype=np.float32)
        nonzero = values != 0
        values[nonzero] = (values[nonzero] - values[nonzero].mean()) / max(float(values[nonzero].std()), 1e-8)
        channels.append(values)
    tensor = torch.from_numpy(np.stack(channels)[None])
    device = device_name()
    progress(f'Running pretrained 3D CNN on {device.upper()}', 15)
    model = load_model(device)
    def predict():
        with torch.inference_mode():
            return sliding_window_inference(tensor, (96, 96, 96), 1, model, overlap=0.25,
                                            mode='gaussian', sw_device=device, device='cpu').sigmoid()[0].numpy()
    try:
        probabilities = predict()
    except (NotImplementedError, RuntimeError) as error:
        if device != 'mps':
            raise
        progress('Apple GPU operation unavailable; retrying on CPU', 20)
        device = 'cpu'
        model = model.to(device)
        torch.mps.empty_cache()
        probabilities = predict()
    progress('Mapping predictions to original MRI space', 70)
    if work_ref is not reference:
        probabilities = np.stack([resample_from_to(nib.Nifti1Image(p, work_ref.affine), reference, order=1).get_fdata(dtype=np.float32) for p in probabilities])
    mask = np.where(probabilities[2] > .5, 3, np.where(probabilities[0] > .5, 1, np.where(probabilities[1] > .5, 2, 0))).astype(np.uint8)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    save_aligned(mask, reference, output / 'segmentation.nii.gz', np.uint8)
    save_aligned(probabilities[1], reference, output / 'probability.nii.gz', np.float32)
    metrics = spatial_metrics(mask, reference.affine, probabilities)
    progress('Computing regional 3D Grad-CAM', 80)
    from explainability import generate_heatmap
    center = metrics['center_of_mass']
    work_center = None if center is None else nib.affines.apply_affine(np.linalg.inv(work_ref.affine) @ reference.affine, center)
    heatmap, bounds = generate_heatmap(model, tensor, device, work_center)
    if work_ref is not reference:
        heatmap = resample_from_to(nib.Nifti1Image(heatmap, work_ref.affine), reference, order=1).get_fdata(dtype=np.float32)
    save_aligned(heatmap, reference, output / 'gradcam.nii.gz', np.float32)
    progress('Saving aligned results', 95)
    return {'metrics': metrics, 'model': 'MONAI SegResNet / BraTS 2018', 'model_revision': MODEL_REVISION,
            'device': device, 'shape': list(reference.shape), 'affine': reference.affine.tolist(),
            'heatmap_scope': 'Regional Grad-CAM of mean tumor-core logit in a 96-voxel crop; outside crop is zero.',
            'heatmap_crop_in_model_voxels': bounds, 'labels': {'1': 'Non-enhancing Core', '2': 'Edema', '3': 'Enhancing Tumor'}}

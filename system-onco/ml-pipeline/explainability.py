"""Gradient attribution for the segmentation model, not a recolored mask."""
import numpy as np
import torch
from monai.visualize import GradCAM

class RegionScore(torch.nn.Module):
    def __init__(self, network):
        super().__init__()
        self.network = network

    def forward(self, x):
        return self.network(x).mean(dim=(2, 3, 4))

def generate_heatmap(model, tensor, device, center=None):
    shape = tensor.shape[2:]
    center = np.asarray(center if center is not None else np.asarray(shape) / 2)
    start = np.maximum(0, np.minimum(np.rint(center).astype(int) - 48, np.maximum(0, np.asarray(shape) - 96)))
    end = np.minimum(start + 96, shape)
    slices = tuple(slice(int(a), int(b)) for a, b in zip(start, end))
    patch = tensor[(slice(None), slice(None), *slices)].to(device)
    pad = []
    for size in reversed(patch.shape[2:]):
        pad.extend([0, (8 - size % 8) % 8])
    patch = torch.nn.functional.pad(patch, pad).requires_grad_(True)
    wrapper = RegionScore(model)
    # A spatial feature layer before the final classifier retains class-specific gradients.
    # MONAI's default display normalizer reverses magnitude (min -> 1).
    # Keep positive attribution high before our explicit [0,1] normalization.
    cam = GradCAM(nn_module=wrapper, target_layers='network.up_layers.2', postprocessing=lambda x: x)
    with torch.enable_grad():
        values = cam(x=patch, class_idx=0)[0, 0].detach().cpu().numpy()
    values = values[tuple(slice(0, int(b-a)) for a, b in zip(start, end))]
    values = (values - values.min()) / max(float(np.ptp(values)), 1e-8)
    values[values < .15] = 0
    result = np.zeros(shape, dtype=np.float32)
    result[slices] = values
    # MONAI registers persistent hooks on the network; remove after this explanation.
    for module in model.modules():
        module._forward_hooks.clear()
        module._backward_hooks.clear()
    model.zero_grad(set_to_none=True)
    return result, {'start': start.tolist(), 'end': end.tolist()}

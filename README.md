# SYSTEM.ONCO

A local brain MRI research dashboard with pretrained MONAI 3D CNN segmentation, an interactive NiiVue viewer, regional Grad-CAM, and measured clinical/patient summaries.

The application lives in [`system-onco/`](system-onco/). See the [setup guide, verified datasets, model limitations, and tests](system-onco/README.md).

After completing the Python environment and asset setup in that guide, start both services:

```sh
cd system-onco
npm ci
npm run dev
```

MRI studies, model weights, generated results, dependencies, and secrets are excluded from this repository. The setup script downloads three complete sample studies and the pinned model checkpoint.

Research software: segmentation results require review and are not a validated clinical diagnosis.

# SYSTEM.ONCO

A local brain MRI research workspace with real pretrained 3D CNN segmentation, NiiVue exploration, measured reports, and optional Gemini narrative synthesis.

## Start

Requirements: Node 20.9+, Python 3.11, and enough memory for 3D inference. Tested here on Apple Silicon with MPS. CUDA is selected when available; CPU is the fallback.

```sh
npm ci
cd ml-pipeline
uv venv --python 3.11 .venv
uv pip sync requirements.txt --python .venv/bin/python
.venv/bin/python setup_assets.py
cd ..
npm run dev
```

`npm run dev` starts both the frontend at http://127.0.0.1:3000 and FastAPI at http://127.0.0.1:8000. Stop both with Ctrl+C. The three samples, weights, and completed analysis results are already present on this machine. Setup is repeatable and only downloads missing files. For independent terminals, use `npm run dev:web` and `npm run dev:api`.

Optional: copy `web/.env.example` to `web/.env.local` and set `GEMINI_API_KEY`. The dashboard always provides a deterministic summary of measured results; when configured, Gemini supplies the narrative through a server-only route. It receives derived metrics, not the MRI files. Missing keys or provider errors leave the measured report usable.

## Use the dashboard

1. Choose one of the three local BraTS studies, or upload four aligned `.nii`/`.nii.gz` sequences: T1, T1c, T2 and FLAIR. Maximum 128 MB compressed per file and 32 million voxels per sequence. This model needs a complete study, not an isolated JPEG or one missing sequence.
2. Choose T1, T1c, T2 or FLAIR in the viewer. Drag the 3D brain to orbit; scroll to zoom. Turn on **Cut through the volume**, move the depth slider, and adjust plane angle/tilt for oblique cutaways. **Play scan** sweeps through layers. Axial, coronal, sagittal and multi views also have continuous slice scanning.
3. Select **Analyze study**. A background job validates and processes the study, generates segmentation and regional Grad-CAM, and returns geometry-preserving NIfTI outputs. Progress and errors appear in the dashboard; completed jobs survive restarts.
4. Inspect **CNN segmentation**, **Tumor probability**, **Regional Grad-CAM**, or the separately labeled **Dataset reference mask**. Reference masks are never fed into inference.
5. Toggle clinical/patient reports. Hover, focus or click a region term to locate its original voxel centroid in the MRI. Download the mask or Grad-CAM output.

**Data & preparation** contains the dataset library, source links, and preparation protocol tables. **Pipeline** contains job history, comparison metrics, model provenance, and the actual processing steps. Those details are kept off the main study dashboard.

## Verified resources

- [Brain Tumor MRI Dataset on Kaggle](https://www.kaggle.com/datasets/masoudnickparvar/brain-tumor-mri-dataset): the requested Version 2 collection contains 7,200 2D MRI images split evenly across glioma, meningioma, pituitary tumor and no-tumor classes (1,400 training and 400 testing images per class). The Kaggle API lists CC BY 4.0 and says the collection combines Figshare, SARTAJ and Br35H sources after deduplication and split cleanup. This is useful for a separate 2D classification track. It does not contain aligned 3D NIfTI sequences or voxel masks, so it is not loaded into the current 3D segmentation viewer or passed to the SegResNet model.
- [Brain Tumor MRI Dataset Version 1 on Mendeley Data](https://data.mendeley.com/datasets/zwr4ntf94j/1) ([DOI 10.17632/zwr4ntf94j.1](https://doi.org/10.17632/zwr4ntf94j.1)): the requested immutable version contains 12,064 preprocessed contrast-enhanced T1 MRI images in JPEG/PNG form, divided into 80% training and 20% testing sets for glioma, meningioma, pituitary and no-tumor classification. The record lists CC BY 4.0. It is catalogued as a separate 2D classification dataset and is not compatible with the four-volume NIfTI segmentation pipeline.
- [Official BraTS Challenge at UPenn](https://www.med.upenn.edu/cbica/brats/) and the [BraTS 2021 data specification](https://www.med.upenn.edu/cbica/brats2021/): primary references for the segmentation task, modality definitions, expert-reviewed region labels, preprocessing, evaluation, access, and required citations. BraTS describes four co-registered, skull-stripped, 1 mm³ MRI volumes and evaluates enhancing tumor, tumor core, and whole tumor with metrics including Dice and 95% Hausdorff distance.
- [MedOtter/BraTS2023 GLI](https://huggingface.co/datasets/MedOtter/brats2023-gli-dataset): three complete cases (`00000`, `00002`, `00003`), each with four MRI sequences and a mask. Dataset commit `b032d353a3e80911a5f850bc54e6fb575298a354`. This is a community mirror, not an official challenge distribution channel. Its card lists CC BY 4.0; retain source attribution and review original challenge terms.
- [MONAI brats_mri_segmentation](https://huggingface.co/MONAI/brats_mri_segmentation/blob/main/docs/README.md): pretrained SegResNet, a 3D residual CNN trained on BraTS 2018. Model commit `370f7f9d062745fbac445e7fe6d6616d35df04ec`; approximately 19 MB weights. Architecture and checkpoint are loaded locally with `weights_only=True`, without executing repository code. Apache 2.0 model; source documentation and data terms are retained under `data/model/`.
- [Cheng et al. brain tumor dataset on Figshare](https://figshare.com/articles/dataset/brain_tumor_dataset/1512427): original research repository cited in the requested Kaggle collection; use its DOI and license to trace source provenance for classification experiments.
- [BraTS-PEDs on The Cancer Imaging Archive](https://www.cancerimagingarchive.net/collection/brats-peds/): an NIH-supported, formally cited pediatric four-modality NIfTI collection with expert masks and defined challenge splits. It is a candidate for external validation only after checking that the model, labels, and intended population are appropriate.

## Inference contract and limits

The pretrained bundle expects **T1c, T1, T2, FLAIR**, whereas the ingestion manifest stores **T1, T1c, T2, FLAIR**. `inference.py` explicitly reorders them. Inputs should already be registered and brain extracted, like BraTS. Validation rejects mismatched shapes/affines, empty sequences and non-finite voxels. Non-1mm data is resampled and results are mapped back to the original geometry. The bundle's native NIfTI spatial-axis convention is retained for 1mm inputs.

The pipeline normalizes nonzero voxels per channel and runs Gaussian sliding-window inference with `96³` windows, 25% overlap and batch size 1 to fit local hardware. This uses smaller windows than the published bundle, so published model scores do not describe this application. Outputs use sigmoid probabilities for overlapping TC, WT and ET regions. Label conversion is `1=non-enhancing core`, `2=edema`, `3=enhancing tumor`, with ET taking precedence over TC and WT. Original affine, qform, sform, dimensions and appropriate output dtype are preserved. Tumor volume is voxel count times the absolute determinant of the affine's spatial block.

Grad-CAM differentiates the mean tumor-core logit through a decoder feature layer in a `96³` crop around the predicted core. It is a **regional explanation**, zero outside the crop, not a whole-volume attribution. Positive attribution is scaled to 0–1 and values below 0.15 are suppressed. MONAI's default reversed display normalization is explicitly disabled. The probability volume is a different, explicitly labeled overlay.

The score in the dashboard is **mean whole-tumor sigmoid probability**, not calibrated diagnostic confidence or accuracy. Segmentation cannot establish tumor type, grade, diagnosis or treatment. This is a research application, not a validated clinical diagnostic device. The model was trained on glioma data and is not an all-brain-tumor detector.

All three real cases were run locally. Whole-tumor Dice against their reference annotations was approximately **0.918, 0.458 and 0.878**, respectively; the second case demonstrates substantial failure despite a high probability score. These are case comparisons, not an independent test benchmark: BraTS editions can share subjects and cohort overlap has not been excluded.

## Files and APIs

- `web/src/components/StudyWorkspace.tsx`: study selection, uploads, jobs and three workspace tabs.
- `web/src/components/viewer/`: client-only NiiVue, slice playback and 3D cutaway controls.
- `web/src/components/report/`: measured/Gemini report and interactive region links.
- `web/src/app/api/generate-report/route.ts`: input validation, structured Gemini response, measured fallback; coordinates and scores remain server-controlled.
- `ml-pipeline/api.py`: catalog, uploads, queued analysis, persistence and allowlisted assets.
- `ml-pipeline/inference.py`, `explainability.py`: actual pretrained segmentation and gradient attribution.
- `ml-pipeline/setup_assets.py`: pinned model and bounded three-case download.

The browser uses `/backend/*`, rewritten by Next.js to the local FastAPI service. Endpoints include `GET /health`, `/studies`, `/protocol`, `/jobs`, `/jobs/{id}`, `POST /studies/upload`, and `POST /studies/{id}/analyze`. `/studies/{id}/volume/{sequence}` and `/jobs/{id}/assets/{name}` serve only registered inputs or completed outputs. Analysis is serialized through one worker, with a bounded queue. An interrupted job is marked failed after restart and can be rerun. Inputs and outputs are stored locally under ignored `ml-pipeline/data/`; they are not auto-deleted.

This local app has no authentication or multiuser isolation. Both servers bind to loopback. Do not expose it as a public service without adding access controls, retention policy and deployment hardening.

## Verification

```sh
npm run build
npm run typecheck
cd ml-pipeline
.venv/bin/python -m unittest discover -s tests -v
```

The 12 tests cover multipart upload/retrieval, invalid/missing/misaligned sequences, output datatype and affine preservation, determinant-based volume calculation, missing regions, interrupted jobs, ingestion normalization and modality pairing. Real-case checks verified output shape, exact affine equality, finite values, label range and regional Grad-CAM bounds for all three downloaded studies. Browser checks exercise the integrated application.

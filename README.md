# SYSTEM.ONCO

## Explainable 3D Brain MRI Research Workspace for Volumetric Brain-Tumor Segmentation

> **From MRI volume to inspectable evidence.**
>
> SYSTEM.ONCO is a local research workspace that connects multimodal 3D brain MRI, pretrained deep-learning segmentation, interactive volumetric visualization, regional Grad-CAM, physical tumor measurements, reference-mask comparison, and optional LLM-assisted reporting in one reproducible workflow.

<img width="1672" height="941" alt="1" src="https://github.com/user-attachments/assets/91dfc39f-d170-4b4b-9933-3016aaf85155" />


---

## Why SYSTEM.ONCO?

Brain MRI analysis is inherently three-dimensional and multimodal. A single study can contain complementary information across **T1, T1c, T2, and FLAIR** sequences, distributed across many spatially related slices.

A segmentation model can identify candidate tumor regions, but a segmentation mask alone does not provide the complete research context needed to inspect that prediction. Researchers may also need to understand:

- where the predicted regions occur in the 3D brain,
- how the model responds across the volume,
- how large the predicted regions are in physical units,
- how the prediction compares with a reference annotation, and
- how the resulting evidence can be communicated clearly.

SYSTEM.ONCO is built around that gap.

<img width="1672" height="941" alt="2" src="https://github.com/user-attachments/assets/1531dfb2-7802-4207-ac58-8f6942898105" />


---

# 01 — The Data: From MRI Slices to a 3D Study

SYSTEM.ONCO works with four complementary MRI sequences from the same study:

| Modality | Role in the study |
|---|---|
| **T1** | Structural/anatomical information |
| **T1c** | Contrast-enhanced T1 information |
| **T2** | Tissue/fluid-sensitive contrast |
| **FLAIR** | Suppresses normal cerebrospinal-fluid signal and can make certain abnormalities more conspicuous |

These modalities are treated as **complementary information about the same anatomy**, rather than as independent images.

### From slices to volume

An MRI study is represented as a stack of spatially related slices. Together, those slices form a **3D volume**.

The workspace can inspect that same volume through multiple orientations:

- **Axial** — horizontal cross-section
- **Coronal** — front-facing vertical cross-section
- **Sagittal** — side-facing vertical cross-section

The fundamental 3D unit is a **voxel**, the volumetric equivalent of a pixel.

### NIfTI and spatial information

The project uses **NIfTI** neuroimaging files. In addition to image values, NIfTI stores spatial metadata such as dimensions, voxel spacing, orientation, and affine information.

This matters because the project does not only ask, "Which voxels are predicted as tumor?" It also asks, "Where are those voxels in physical space?"

### Why alignment matters

Because T1, T1c, T2, and FLAIR are combined, the modalities must correspond spatially. The ingestion and inference pipeline therefore validates properties such as:

- dimensionality,
- spatial shape,
- affine agreement,
- finite voxel values, and
- non-empty volumes.

A valid multi-modal study should represent the same anatomy at corresponding coordinates across modalities.

---

# 02 — The Workspace: One Study, Multiple Layers of Evidence

SYSTEM.ONCO places the model inside an interactive research environment rather than treating inference as the end of the workflow.

The central workspace provides:

1. **Orthogonal MRI views** — inspect the same volume axially, coronally, and sagittally.
2. **3D volume exploration** — orbit, zoom, cut through the volume, and inspect spatial extent.
3. **Segmentation overlays** — view predicted tumor regions directly over MRI anatomy.
4. **Probability overlays** — inspect the model's continuous sigmoid response separately from the segmentation.
5. **Regional Grad-CAM** — inspect a localized attribution visualization.
6. **Reference mask** — compare against the dataset annotation when available.
7. **Measurements and reporting** — move from visual inspection to quantitative summaries.




## Evidence layers

The workspace keeps several concepts visually distinct because they answer different questions:

| Layer | Question it helps answer |
|---|---|
| **MRI** | What does the underlying anatomy look like? |
| **CNN segmentation** | Where does the model predict tumor-related tissue? |
| **Probability** | How strongly does the model respond at each voxel? |
| **Regional Grad-CAM** | Which region is associated with the selected model response? |
| **Reference mask** | How does the prediction compare with the dataset annotation? |

### Reference masks never enter inference

Reference annotations are kept separate from the model input pipeline. They are used for **evaluation, comparison, and analysis**, not to help the CNN make its prediction.

This separation is important for avoiding leakage between inference and evaluation.

---

# 03 — Under the Hood: From NIfTI to Measured Result

The computational pipeline is deliberately explicit. Each stage transforms the data into a more useful representation while preserving spatial context.

<img width="1672" height="941" alt="4" src="https://github.com/user-attachments/assets/7feed38c-69ab-46d7-b110-457941d4a9bc" />


## 1. Acquire

A study is assembled from four aligned NIfTI sequences:

```text
T1 + T1c + T2 + FLAIR
```

The application supports the bundled BraTS-derived studies and complete uploaded studies containing the required modalities.

## 2. Validate

Before inference, the pipeline checks structural and numerical properties of the inputs, including 3D shape, affine alignment, finite voxel values, and non-empty sequences.

The system is designed for **BraTS-like input assumptions**: the uploaded modalities should already be spatially registered and brain-extracted in the expected research-data style.

## 3. Prepare

The inference pipeline performs the preprocessing needed by the local model configuration, including:

- 1 mm resampling when required,
- nonzero-voxel normalization,
- modality reordering to the model's expected channel order.

The model expects the modalities in the order:

```text
T1c, T1, T2, FLAIR
```

while the dataset manifest is stored as:

```text
T1, T1c, T2, FLAIR
```

The inference code explicitly reorders them before creating the model tensor.

## 4. Segment

SYSTEM.ONCO uses a **pretrained MONAI SegResNet**, a 3D convolutional neural network designed for volumetric medical-image segmentation.

At a high level:

```text
4 MRI volumes
      ↓
  3D CNN / SegResNet
      ↓
3 tumor-related probability maps
      ↓
 sigmoid outputs
      ↓
  thresholding
      ↓
segmentation mask
```

The three overlapping tumor regions represented by the model are:

- **Whole Tumor (WT)**
- **Tumor Core (TC)**
- **Enhancing Tumor (ET)**

The local implementation uses sigmoid outputs and a 0.5 segmentation threshold. Label conversion preserves the nested tumor-region semantics used by the application.

### Sliding-window inference

The local pipeline processes the full MRI volume through overlapping 3D windows rather than requiring the entire study to fit into one model pass.

Current application configuration:

```text
Window:     96 × 96 × 96
Overlap:    25%
Batch size: 1
Mode:       Gaussian sliding-window inference
```

The 96³ configuration is an application-level adaptation for local hardware. It should not be treated as identical to the published inference configuration of the pretrained model bundle.

## 5. Explain

The system generates a **regional Grad-CAM** around the predicted tumor core.

Grad-CAM, or Gradient-weighted Class Activation Mapping, uses model activations and gradients to create an attribution heatmap associated with a selected prediction.

In SYSTEM.ONCO, this is a **regional explanation**, not a whole-volume proof of causality and not a replacement for the segmentation mask.

```text
Segmentation
→ what the model predicted

Grad-CAM
→ where the model's response is concentrated
```

## 6. Measure

Once a segmentation mask exists, the system derives physical tumor measurements from the predicted voxels and NIfTI spatial geometry.

The core relationship is:

```text
Physical volume
= number of tumor voxels × physical volume represented by one voxel
```

The implementation obtains the per-voxel volume from the spatial affine rather than assuming a fixed isotropic voxel size.

It also records spatial centroids for predicted regions, enabling the viewer to connect report terms back to their original voxel locations.

## 7. Compare

When a reference annotation is available, the prediction can be compared against it using the **Dice coefficient**.

Conceptually:

```text
                  2 × |Prediction ∩ Reference|
Dice = ─────────────────────────────────────────────
                   |Prediction| + |Reference|
```

Dice ranges from:

```text
0 → no overlap
1 → perfect overlap
```

## 8. Report

The reporting layer combines deterministic measurements with optional natural-language synthesis.

The architecture is intentionally:

```text
MRI
 ↓
CNN inference
 ↓
deterministic metrics
 ↓
optional Gemini narrative
```

The LLM receives derived metrics rather than the original MRI files. Numerical measurements and coordinates remain controlled by the application rather than being generated by the model.

---

# 04 — Evaluation: Three Cases, Three Outcomes

A central research principle in SYSTEM.ONCO is that a successful-looking prediction on one example is not sufficient evidence of robust model behavior.

The current local evaluation includes three complete cases and their reference annotations.

<img width="1672" height="941" alt="5" src="https://github.com/user-attachments/assets/b5ef40bb-209f-4e2f-bad3-907c9b0598a6" />


## Observed Whole-Tumor Dice

| Case | Whole-Tumor Dice | Interpretation at a high level |
|---|---:|---|
| **00000** | **0.918** | Strong spatial agreement in this case |
| **00002** | **0.458** | Substantial disagreement in this case |
| **00003** | **0.878** | Strong spatial agreement in this case |

These values are **case-level comparisons**, not an independent benchmark or a claim of clinical performance.

### Probability is not accuracy

The dashboard's displayed model score is the **mean whole-tumor sigmoid probability**. It is not calibrated diagnostic confidence, and it should not be interpreted as segmentation accuracy.

The difficult case is an important demonstration of this distinction: a high model response does not guarantee that the predicted tumor boundaries agree with the reference annotation.

This motivates the broader SYSTEM.ONCO workflow:

```text
Model output
    ↓
Visual inspection
    +
Reference comparison
    +
Quantitative metrics
    +
Spatial measurements
```

Together, these provide a more informative view of model behavior than a single confidence-like number.

---

# 05 — What the Project Contributes

SYSTEM.ONCO is best understood as an **integrated research workflow around a segmentation model**.

Its current contribution is the combination of:

- geometry-aware preprocessing,
- pretrained 3D CNN segmentation,
- interactive volumetric visualization,
- regional Grad-CAM,
- physical-volume measurement,
- reference-mask comparison, and
- deterministic plus LLM-assisted reporting.

## What the project does not claim

SYSTEM.ONCO is a **research prototype, not a validated clinical diagnostic device**.

In particular:

- the pretrained model is based on glioma/BraTS data and is not an all-brain-tumor detector;
- the application has not established clinical diagnostic performance;
- the displayed sigmoid statistic is not calibrated diagnostic confidence;
- the demonstrated cases are not sufficient to establish generalization across scanners, sites, populations, or acquisition protocols;
- the current local evaluation is not an independent test benchmark.

These limitations are part of the research framing rather than hidden implementation details.

---

# Research Directions

The current system provides a foundation for extending the workflow in four directions.

### Robustness

Evaluate how predictions and measurements change across scanners, acquisition protocols, preprocessing conditions, and real-world datasets.

### Explainability

Study whether attribution regions consistently align with clinically or anatomically meaningful structures and whether regional Grad-CAM provides useful information beyond the segmentation itself.

### Generalization

Extend the workflow to additional tumor types and evaluate alternative segmentation architectures and checkpoints.

### Independent Evaluation

Move from a small set of demonstration cases toward larger, independently defined cohorts with reproducible evaluation protocols.

---

# System Architecture

At a high level, the application is divided into three layers:

```text
┌──────────────────────────────────────────────────────────┐
│                     NEXT.JS / REACT                      │
│  Study selection · viewer · overlays · reports · UX    │
└──────────────────────────────┬───────────────────────────┘
                               │ /backend/*
                               ▼
┌──────────────────────────────────────────────────────────┐
│                         FASTAPI                           │
│  Study catalog · uploads · jobs · persistence · assets  │
└──────────────────────────────┬───────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│                   PYTHON / MONAI                         │
│  Validation · preprocessing · SegResNet · inference    │
│  Grad-CAM · measurements · output NIfTI                 │
└──────────────────────────────────────────────────────────┘
                               │
                               ▼
                    Optional Gemini layer
                 derived metrics → narrative
```

The browser communicates with FastAPI through the Next.js `/backend/*` rewrite. Expensive analysis jobs are serialized through a single worker in the current local configuration, while job metadata is persisted to disk so completed results can survive process restarts.

---

# Repository Structure

```text
system-onco/
├── ml-pipeline/
│   ├── api.py                 # FastAPI service, uploads, jobs, catalog
│   ├── inference.py           # SegResNet loading and 3D inference
│   ├── explainability.py      # Regional Grad-CAM generation
│   ├── ingest_brats.py        # Dataset acquisition and pairing
│   ├── setup_assets.py        # Pinned model/data setup
│   ├── requirements.in
│   ├── requirements.txt
│   └── tests/
│       ├── test_api.py
│       └── test_ingestion.py
│
├── web/
│   ├── src/
│   │   ├── app/
│   │   │   └── api/generate-report/
│   │   │       └── route.ts   # Optional Gemini narrative endpoint
│   │   ├── components/
│   │   │   ├── StudyWorkspace.tsx
│   │   │   ├── ObservationDeck.tsx
│   │   │   ├── report/
│   │   │   └── viewer/
│   │   └── lib/
│   └── package.json
│
├── scripts/
│   └── dev.mjs                # Starts web + API together
│
├── package.json
└── README.md
```

---

# Technical Stack

| Layer | Technologies |
|---|---|
| Frontend | Next.js, React, TypeScript, Tailwind CSS |
| Medical visualization | NiiVue |
| Backend | Python, FastAPI |
| Deep learning | PyTorch, MONAI, SegResNet |
| Medical imaging | NiBabel, NIfTI |
| Dataset | BraTS-derived complete 3D studies |
| Explainability | Grad-CAM via MONAI |
| Reporting | Deterministic metrics + optional Gemini narrative |
| Inference | CPU fallback, CUDA when available, MPS on supported Apple Silicon systems |

---

# Setup

## Requirements

- Node.js 20.9+
- Python 3.11
- Sufficient memory for 3D inference
- A local environment capable of running the selected PyTorch device backend

## Install

From the repository application directory:

```sh
npm ci
cd ml-pipeline
uv venv --python 3.11 .venv
uv pip sync requirements.txt --python .venv/bin/python
.venv/bin/python setup_assets.py
cd ..
```

Then start both services:

```sh
npm run dev
```

The application starts locally at:

```text
Frontend   http://127.0.0.1:3000
FastAPI    http://127.0.0.1:8000
```

For separate terminals:

```sh
npm run dev:web
npm run dev:api
```

### Optional Gemini reporting

Copy:

```text
web/.env.example
```

to:

```text
web/.env.local
```

and provide:

```text
GEMINI_API_KEY=...
```

The measured report remains available without Gemini. Provider failures or a missing key fall back to the deterministic result.

---

# Using the Workspace

### 1. Select or upload a study

Choose one of the bundled studies or upload a complete set of four aligned `.nii` / `.nii.gz` sequences:

```text
T1
T1c
T2
FLAIR
```

The current application enforces a maximum compressed file size of **128 MB per file** and a maximum of **32 million voxels per sequence**.

### 2. Explore the MRI volume

Use the workspace to inspect axial, coronal, sagittal, and 3D views. The viewer supports slice scanning, crosshair navigation, 3D orbit/zoom, volume cutaways, and overlay toggles.

### 3. Run analysis

Select **Analyze study**. A background job validates the study, runs the pretrained segmentation model, generates the derived outputs, and stores geometry-preserving NIfTI results.

### 4. Inspect evidence layers

Toggle:

- CNN segmentation
- tumor probability
- regional Grad-CAM
- dataset reference mask

These views should be interpreted as complementary evidence, not interchangeable outputs.

### 5. Review measurements and reporting

Inspect predicted-region volumes, centroids, comparison metrics, and the optional generated narrative. Region terms in the report can be linked back to the original voxel centroid in the viewer.

---

# Data and Model Provenance

## Dataset

The current sample library is built from a community mirror of the BraTS 2023 GLI dataset:

- Repository: [MedOtter/BraTS2023 GLI](https://huggingface.co/datasets/MedOtter/brats2023-gli-dataset)
- Bundled complete cases: `00000`, `00002`, `00003`
- Each case contains four MRI sequences and a reference mask
- Dataset commit used by the application: `b032d353a3e80911a5f850bc54e6fb575298a354`

The repository retains the source attribution and dataset terms alongside the downloaded resources.

## Model

The project uses the MONAI `brats_mri_segmentation` pretrained bundle:

- Architecture: **SegResNet**
- Type: **3D CNN**
- Training domain: **BraTS 2018**
- Model commit: `370f7f9d062745fbac445e7fe6d6616d35df04ec`
- Weights are loaded locally with `weights_only=True`

The application's preprocessing and local inference configuration differ from the bundle's published inference procedure. Therefore, the published model scores should not be interpreted as the performance of this application.

---

# API Surface

The FastAPI service currently exposes endpoints for:

```text
GET  /health
GET  /studies
GET  /protocol
GET  /jobs
GET  /jobs/{id}
POST /studies/upload
POST /studies/{id}/analyze
```

Registered study inputs and completed job assets are served through allowlisted routes such as:

```text
/studies/{id}/volume/{sequence}
/jobs/{id}/assets/{name}
```

The current job system serializes expensive analysis through a single worker and persists job metadata under the local data directory.

---

# Verification

The repository includes tests for key ingestion and API behavior, including:

- multipart upload and retrieval,
- invalid and incomplete studies,
- spatial/affine mismatch,
- output datatype and affine preservation,
- determinant-based volume calculation,
- missing regions,
- interrupted jobs,
- ingestion normalization, and
- modality pairing.

Run:

```sh
npm run build
npm run typecheck
cd ml-pipeline
.venv/bin/python -m unittest discover -s tests -v
```

The three bundled cases were also checked locally for output shape, affine preservation, finite values, label range, and regional Grad-CAM bounds.

---

# Limitations and Safety Boundaries

SYSTEM.ONCO is intended for **research and educational use**.

It should not be used as a substitute for clinical assessment, diagnosis, treatment planning, or professional interpretation.

The current implementation has no authentication or multi-user isolation and is intentionally designed to run on loopback interfaces for local use. MRI inputs, generated outputs, and other local research artifacts are not automatically deleted.

Do not expose the current application as a public service without adding appropriate access controls, retention policies, resource limits, and deployment hardening.

---

# Research Position

The central contribution of SYSTEM.ONCO is not the claim of a new segmentation architecture. Instead, the project explores how a pretrained volumetric segmentation model can be placed inside a more transparent and inspectable research workflow.

The resulting pipeline is:

```text
Multimodal MRI
     ↓
Geometry-aware validation
     ↓
3D CNN segmentation
     ↓
Probability + segmentation
     ↓
Regional attribution
     ↓
Physical measurements
     ↓
Reference comparison
     ↓
Interpretable reporting
```

> **The contribution is not only a segmentation model.**
>
> **It is a workflow for turning model output into inspectable evidence.**

---

# Team Contribution

SYSTEM.ONCO was developed by a three-person team across three complementary technical domains:

| Area | Responsibility |
|---|---|
| **Data & Visualization** | MRI/NIfTI ingestion, dataset preparation, spatial validation, frontend workspace, NiiVue visualization, and interactive overlays |
| **ML & Inference** | Preprocessing, SegResNet integration, sliding-window inference, probability/segmentation generation, and FastAPI job execution |
| **Explainability & Evaluation** | Grad-CAM, reference comparison, Dice evaluation, physical measurements, reporting, and research interpretation |

The responsibilities are deliberately separated by system boundaries while remaining connected through shared data contracts.

---

# References

- MONAI BraTS MRI Segmentation model documentation: https://huggingface.co/MONAI/brats_mri_segmentation
- MedOtter BraTS2023 GLI dataset mirror: https://huggingface.co/datasets/MedOtter/brats2023-gli-dataset
- Kaggle BraTS2020 dataset reference: https://www.kaggle.com/datasets/awsaf49/brats20-dataset-training-validation

---

## Book Chapter / Presentation

**Book chapter:** `[ADD BOOK CHAPTER TITLE / AUTHORS / PUBLICATION LINK]`

**Presentation:** `[ADD PRESENTATION OR PROJECT DOCUMENTATION LINK]`

---

## Project Status

**Current stage:** Working research prototype

**Primary focus:** Explainable 3D brain MRI segmentation workflow

**Intended context:** Research, experimentation, visualization, and educational demonstration
<img width="1672" height="941" alt="2" src="https://github.com/user-attachments/assets/94855f01-aca4-411a-95d7-00aa9484a568" />

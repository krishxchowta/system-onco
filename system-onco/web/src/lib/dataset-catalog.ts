export type DatasetReference = {
  name: string;
  href: string;
  task: string;
  format: string;
  provenance: string;
  pipelineUse: string;
};

export const DATASET_REFERENCES: DatasetReference[] = [
  {
    name: "BraTS Challenge · UPenn / Synapse",
    href: "https://www.med.upenn.edu/cbica/brats/",
    task: "3D glioma segmentation",
    format: "4 aligned NIfTI volumes + expert mask",
    provenance:
      "Primary challenge source. Multi-institutional data with expert-reviewed tumor-region annotations; access and citation terms apply.",
    pipelineUse: "Preferred source for training and formal evaluation",
  },
  {
    name: "BraTS 2023 GLI · Hugging Face",
    href: "https://huggingface.co/datasets/MedOtter/brats2023-gli-dataset",
    task: "3D glioma segmentation",
    format: "T1n, T1c, T2w, T2-FLAIR + NIfTI mask",
    provenance:
      "Community mirror of BraTS 2023 GLI. Dataset Viewer confirms 1,251 indexed training rows; retain the original challenge attribution and terms.",
    pipelineUse: "3 complete studies installed for this local demo",
  },
  {
    name: "Brain Tumor MRI Dataset · Kaggle",
    href: "https://www.kaggle.com/datasets/masoudnickparvar/brain-tumor-mri-dataset",
    task: "2D four-class classification",
    format: "7,200 images: glioma, meningioma, pituitary, no tumor",
    provenance:
      "Curated from Figshare, SARTAJ and Br35H. Version 2 reports balanced 1,400/400 train/test images per class, deduplication, and CC BY 4.0.",
    pipelineUse: "Classification benchmark only; incompatible with the 3D viewer",
  },
  {
    name: "Cheng brain tumor dataset · Figshare",
    href: "https://figshare.com/articles/dataset/brain_tumor_dataset/1512427",
    task: "2D tumor-type classification",
    format: "Contrast-enhanced T1 MRI slices + labels",
    provenance:
      "Original research repository cited by the Kaggle collection. Use its DOI and license when tracing classification-image provenance.",
    pipelineUse: "Reference source for classification experiments",
  },
  {
    name: "BraTS-PEDs · The Cancer Imaging Archive",
    href: "https://www.cancerimagingarchive.net/collection/brats-peds/",
    task: "3D pediatric tumor segmentation",
    format: "4 aligned NIfTI volumes + expert mask",
    provenance:
      "NIH-supported TCIA collection with a formal data citation, standardized subject naming, and defined train/validation/test groupings.",
    pipelineUse: "External validation after pediatric model review",
  },
];

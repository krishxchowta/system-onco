"""Download three complete studies and a pinned checkpoint."""
import json
from huggingface_hub import hf_hub_download
from ingest_brats import acquire_subjects, DEFAULT_REPO, DEFAULT_OUTPUT, MODALITIES, SPATIAL_SIZE
from inference import MODEL_REVISION

if __name__ == '__main__':
    for filename in ['models/model.pt','configs/inference.json','configs/metadata.json','docs/README.md','docs/data_license.txt','LICENSE']:
        hf_hub_download('MONAI/brats_mri_segmentation', filename, revision=MODEL_REVISION, local_dir=DEFAULT_OUTPUT / 'model')
    subjects, revision = acquire_subjects(DEFAULT_REPO, 'b032d353a3e80911a5f850bc54e6fb575298a354', 3, DEFAULT_OUTPUT)
    manifest = {'schema_version':1,'source':{'type':'huggingface','repo':DEFAULT_REPO,'revision':revision},'channel_order':MODALITIES,'spatial_size':SPATIAL_SIZE,'subjects':subjects}
    (DEFAULT_OUTPUT / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print('Three MRI studies and model weights ready.')

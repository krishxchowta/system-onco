"""Local study catalog, bounded uploads, background CNN jobs and aligned assets."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock
from uuid import uuid4
import json
import os
import shutil
import time
import numpy as np
import nibabel as nib
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from inference import analyze, validate_images, device_name, MODEL_PATH, MODEL_REVISION

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
JOBS = DATA / 'jobs'
JOBS.mkdir(parents=True, exist_ok=True)
executor = ThreadPoolExecutor(max_workers=1)
lock = Lock()
jobs = {}
app = FastAPI(title='SYSTEM.ONCO', version='1.0.0')
origins = [origin.strip() for origin in os.getenv(
    'CORS_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000'
).split(',') if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=['GET', 'POST'],
    allow_headers=['Content-Type'],
)

def resolve_catalog_path(value, subject_id):
    if not value:
        return value
    path = Path(value)
    if path.exists():
        return str(path)
    deployed = DATA / 'raw' / 'ASNR-MICCAI-BraTS2023-GLI-Challenge-TrainingData' / subject_id / path.name
    return str(deployed)

def catalog():
    path = DATA / 'manifest.json'
    manifest = json.loads(path.read_text()) if path.exists() else {'subjects': [], 'source': {}}
    for study in manifest['subjects']:
        study['image'] = [resolve_catalog_path(path, study['subject_id']) for path in study['image']]
        study['label'] = resolve_catalog_path(study.get('label'), study['subject_id'])
    uploaded = DATA / 'uploads'
    for metadata in uploaded.glob('*/study.json') if uploaded.exists() else []:
        manifest['subjects'].append(json.loads(metadata.read_text()))
    return manifest

def study_by_id(study_id):
    study = next((s for s in catalog()['subjects'] if s['subject_id'] == study_id), None)
    if not study:
        raise HTTPException(404, 'Study not found')
    return study

def public_study(study):
    image = nib.load(study['image'][0])
    return {'id': study['subject_id'], 'source': study.get('source', 'BraTS 2023 / Hugging Face'),
            'shape': list(image.shape), 'spacing': nib.affines.voxel_sizes(image.affine).tolist(),
            'sequences': ['t1','t1c','t2','flair'], 'has_reference': bool(study.get('label'))}

@app.get('/health')
def health():
    return {'status': 'ok', 'inference_available': MODEL_PATH.exists(), 'device': device_name(), 'model': 'MONAI SegResNet', 'model_revision': MODEL_REVISION}

@app.get('/studies')
def studies():
    return {'studies': [public_study(s) for s in catalog()['subjects']]}

@app.get('/studies/{study_id}/volume/{sequence}')
def volume(study_id: str, sequence: str):
    study = study_by_id(study_id)
    if sequence == 'reference' and study.get('label'):
        path = study['label']
    elif sequence in ['t1','t1c','t2','flair']:
        path = study['image'][['t1','t1c','t2','flair'].index(sequence)]
    else:
        raise HTTPException(404, 'Sequence unavailable')
    return FileResponse(path, media_type='application/octet-stream', filename=Path(path).name)

@app.post('/studies/upload', status_code=201)
async def upload(t1: UploadFile = File(...), t1c: UploadFile = File(...), t2: UploadFile = File(...), flair: UploadFile = File(...)):
    identifier = 'upload-' + uuid4().hex
    folder = DATA / 'uploads' / identifier
    folder.mkdir(parents=True)
    paths = []
    try:
        for name, file in zip(['t1','t1c','t2','flair'], [t1,t1c,t2,flair]):
            if not (file.filename or '').lower().endswith(('.nii','.nii.gz')):
                raise ValueError('Each sequence must be a .nii or .nii.gz file.')
            suffix = '.nii.gz' if file.filename.lower().endswith('.gz') else '.nii'
            path = folder / (name + suffix)
            total = 0
            with path.open('wb') as output:
                while chunk := await file.read(1024 * 1024):
                    total += len(chunk)
                    if total > 128 * 1024 * 1024:
                        raise ValueError('Maximum 128 MB per sequence.')
                    output.write(chunk)
            paths.append(str(path))
        validate_images(paths)
        study = {'subject_id': identifier, 'image': paths, 'source': 'Local upload', 'label': None}
        (folder / 'study.json').write_text(json.dumps(study))
        return public_study(study)
    except Exception as error:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(422, str(error)) from error
    finally:
        for file in [t1,t1c,t2,flair]:
            await file.close()

def persist(job):
    folder = JOBS / job['id']
    folder.mkdir(exist_ok=True)
    temp = folder / 'job.tmp'
    temp.write_text(json.dumps(job))
    temp.replace(folder / 'job.json')

def work(identifier, study):
    def progress(stage, percent):
        with lock:
            jobs[identifier].update(status='running', stage=stage, progress=percent)
            persist(jobs[identifier])
    try:
        result = analyze(study['image'], JOBS / identifier, progress)
        result['assets'] = {name: f'/backend/jobs/{identifier}/assets/{name}' for name in ['segmentation','probability','gradcam']}
        if study.get('label'):
            truth = nib.load(study['label']).get_fdata()
            pred = nib.load(JOBS / identifier / 'segmentation.nii.gz').get_fdata()
            mapping = {'Tumor Core': (np.isin(pred,[1,3]),np.isin(truth,[1,3])), 'Whole Tumor': (pred>0,truth>0), 'Enhancing Tumor': (pred==3,truth==3)}
            result['reference_dice'] = {k: float(2 * np.logical_and(a,b).sum() / (a.sum()+b.sum())) if a.sum()+b.sum() else None for k,(a,b) in mapping.items()}
        with lock:
            jobs[identifier].update(status='completed', stage='Analysis complete', progress=100, result=result)
            persist(jobs[identifier])
    except Exception as error:
        with lock:
            jobs[identifier].update(status='failed', stage='Analysis failed', error=str(error))
            persist(jobs[identifier])

@app.post('/studies/{study_id}/analyze', status_code=202)
def start_analysis(study_id: str):
    study = study_by_id(study_id)
    if not MODEL_PATH.exists():
        raise HTTPException(503, 'Model weights are not installed.')
    with lock:
        active = [j for j in jobs.values() if j['status'] in ('queued','running')]
        same = next((j for j in active if j['study_id']==study_id), None)
        if same:
            return same.copy()
        if len(active) >= 4:
            raise HTTPException(429, 'Analysis queue is full. Wait for a current study to finish.')
        identifier = uuid4().hex
        job = {'id': identifier, 'study_id': study_id, 'status': 'queued', 'stage': 'Queued for analysis', 'progress': 0, 'created_at': time.time()}
        jobs[identifier] = job
        persist(job)
        response = job.copy()
    executor.submit(work, identifier, study)
    return response

@app.get('/jobs')
def list_jobs():
    return {'jobs': sorted([read_job(p.parent.name) for p in JOBS.glob('*/job.json')], key=lambda j:j['created_at'], reverse=True)}

@app.get('/jobs/{identifier}')
def read_job(identifier: str):
    if not identifier.isalnum() or len(identifier)!=32:
        raise HTTPException(404, 'Job not found')
    with lock:
        if identifier in jobs:
            return jobs[identifier].copy()
        path = JOBS / identifier / 'job.json'
        if not path.exists():
            raise HTTPException(404, 'Job not found')
        job = json.loads(path.read_text())
    if job['status'] in ('queued','running'):
        job.update(status='failed', error='Server restarted during analysis. Run the study again.', stage='Interrupted')
    return job

@app.get('/jobs/{identifier}/assets/{name}')
def asset(identifier: str, name: str):
    job = read_job(identifier)
    if job['status']!='completed' or name not in ['segmentation','probability','gradcam']:
        raise HTTPException(404, 'Output unavailable')
    return FileResponse(JOBS / identifier / (name+'.nii.gz'), media_type='application/octet-stream', filename=name+'.nii.gz')

@app.get('/protocol')
def protocol():
    return {'source': catalog()['source'], 'model_revision': MODEL_REVISION, 'steps': [
        {'step':'Acquire','details':'Four aligned T1, T1c, T2, FLAIR volumes. Three BraTS 2023 cases are downloaded locally.'},
        {'step':'Validate','details':'Check 3D shapes, affine alignment, finite voxels, nonempty sequences, and millimeter units.'},
        {'step':'Prepare','details':'Reorder T1c, T1, T2, FLAIR for the checkpoint. Normalize nonzero voxels per channel. Resample non-1mm input and invert after inference.'},
        {'step':'Segment','details':'Pretrained MONAI SegResNet 3D CNN. 96³ Gaussian sliding windows, 25% overlap, sigmoid threshold 0.5. Native spatial axes follow the bundle.'},
        {'step':'Explain','details':'Regional 96³ Grad-CAM around predicted tumor core. Attributions describe this crop; zero outside. Probability overlay is separately labeled.'},
        {'step':'Measure','details':'Count segmented voxels × absolute affine determinant. Original-voxel centroids drive crosshair navigation. Sigmoid probability is not diagnostic accuracy.'},
        {'step':'Compare','details':'Dice against BraTS reference labels, where available. Reference labels never enter model inference. BraTS 2018 training and 2023 samples may overlap; these cases are not an independent benchmark.'},
        {'step':'Report','details':'Measured summary always available locally. Optional Gemini narrative receives only derived metrics through the server.'}]}

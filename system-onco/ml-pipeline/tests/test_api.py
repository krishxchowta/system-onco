"""Check spatial math, NIfTI metadata and real multipart/API boundaries."""
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import nibabel as nib
import numpy as np
from fastapi.testclient import TestClient
import api
from inference import spatial_metrics, save_aligned, validate_images

class ApiTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        (self.root/'jobs').mkdir()
        self.patches=[patch.object(api,'DATA',self.root),patch.object(api,'JOBS',self.root/'jobs')]
        for item in self.patches:item.start()
        self.client=TestClient(api.app)
        self.array=np.arange(8**3,dtype=np.float32).reshape(8,8,8)
        self.reference=nib.Nifti1Image(self.array,np.diag([-1.,1.,1.,1.]))
        self.path=self.root/'scan.nii.gz';nib.save(self.reference,self.path)
    def tearDown(self):
        self.client.close()
        for item in self.patches:item.stop()
        self.temp.cleanup()
    def files(self):
        return {name:(name+'.nii.gz',self.path.read_bytes(),'application/octet-stream') for name in ['t1','t1c','t2','flair']}
    def test_upload_and_retrieve_identical_nifti(self):
        response=self.client.post('/studies/upload',files=self.files())
        self.assertEqual(response.status_code,201,response.text)
        study=response.json();self.assertFalse(study['has_reference'])
        output=self.client.get('/studies/'+study['id']+'/volume/t1')
        self.assertEqual(output.content,self.path.read_bytes())
        self.assertEqual(len(self.client.get('/studies').json()['studies']),1)
        self.assertEqual(self.client.get('/studies/'+study['id']+'/volume/reference').status_code,404)
    def test_invalid_upload_is_removed(self):
        files=self.files();files['t2']=('bad.nii.gz',b'invalid','application/octet-stream')
        response=self.client.post('/studies/upload',files=files)
        self.assertEqual(response.status_code,422)
        self.assertEqual(list((self.root/'uploads').iterdir()),[])
    def test_missing_modality_is_rejected(self):
        files=self.files();del files['flair']
        self.assertEqual(self.client.post('/studies/upload',files=files).status_code,422)
    def test_misaligned_affine_is_rejected(self):
        other=self.root/'other.nii.gz';affine=self.reference.affine.copy();affine[0,3]=12
        nib.save(nib.Nifti1Image(self.array,affine),other)
        with self.assertRaisesRegex(ValueError,'not aligned'):validate_images([self.path,other,self.path,self.path])
    def test_volume_uses_affine_determinant_and_empty_regions(self):
        mask=np.zeros((3,3,3),dtype=np.uint8);mask[1,1,1]=3
        affine=np.array([[2,1,0,10],[0,3,0,20],[0,0,4,30],[0,0,0,1]],dtype=float)
        metrics=spatial_metrics(mask,affine)
        self.assertAlmostEqual(metrics['volumes']['Whole Tumor'],24)
        self.assertEqual(metrics['center_of_mass'],[1,1,1])
        self.assertEqual(metrics['center_of_mass_mm'],[13,23,34])
        self.assertIsNone(metrics['centers']['Edema'])
        self.assertIsNone(metrics['confidence_score'])
    def test_float_output_preserves_geometry_and_values(self):
        array=np.full(self.reference.shape,.123,dtype=np.float32)
        target=self.root/'probability.nii.gz';save_aligned(array,self.reference,target,np.float32)
        output=nib.load(target)
        np.testing.assert_array_equal(output.affine,self.reference.affine)
        np.testing.assert_allclose(output.get_fdata(),array)
        self.assertEqual(output.header.get_data_dtype(),np.dtype('float32'))
    def test_interrupted_job_and_unavailable_outputs(self):
        identifier='a'*32;folder=self.root/'jobs'/identifier;folder.mkdir()
        (folder/'job.json').write_text(json.dumps({'id':identifier,'status':'running'}))
        self.assertEqual(self.client.get('/jobs/'+identifier).json()['status'],'failed')
        self.assertEqual(self.client.get('/jobs/'+identifier+'/assets/segmentation').status_code,404)
        self.assertEqual(self.client.get('/jobs/not-a-job').status_code,404)
if __name__=='__main__':unittest.main()

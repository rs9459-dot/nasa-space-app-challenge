"""Prototype completeness, provenance and real-engine compatibility."""
import copy
import unittest
from pipeline.crop_reference import load_reference,validate

class CompleteProfilesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.rows,cls.evidence=load_reference()

    def test_all_ten_profiles_are_numerically_complete(self):
        report=validate(self.rows,self.evidence)
        self.assertEqual(report['errors'],[])
        self.assertEqual(report['crop_count'],10)

    def test_assumptions_cannot_pass_as_validated_advice(self):
        report=validate(self.rows,self.evidence,require_advice_ready=True)
        self.assertFalse(report['validated_for_farmer_advice'])
        self.assertTrue(report['errors'])
        spoofed=copy.deepcopy(self.evidence);spoofed['validated_for_farmer_advice']=True
        self.assertTrue(validate(self.rows,spoofed,require_advice_ready=True)['errors'])

    def test_missing_and_unsourced_parameters_fail(self):
        rows=copy.deepcopy(self.rows);rows[0]['kc_mid']=''
        self.assertTrue(validate(rows,self.evidence)['errors'])
        evidence=copy.deepcopy(self.evidence)
        evidence['parameters']['alfalfa']['kc_mid']['source']=''
        self.assertTrue(validate(self.rows,evidence)['errors'])

    def test_bad_date_and_invalid_fraction_fail(self):
        rows=copy.deepcopy(self.rows);rows[0]['plant_month']=13;rows[0]['p_depletion']=1.2
        self.assertTrue(validate(rows,self.evidence)['errors'])

    def test_disabled_heat_gate_is_explicit(self):
        for crop,cells in self.evidence['parameters'].items():
            if cells['gdd_required']['value']==0:
                self.assertEqual(cells['gdd_required']['status'],'policy')
                self.assertIn('DISABLE',cells['gdd_required']['reason'])
        self.assertEqual(self.evidence['parameters']['barley']['base_temp_c']['value'],0)
        self.assertGreater(self.evidence['parameters']['barley']['gdd_required']['value'],1200)

    def test_real_water_engine_accepts_all_profiles(self):
        import numpy as np
        from engine.bundle import load
        from engine.water import crop_tables,simulate
        field,ref=load('nv-fallon-01')
        codes=[r['crop'] for r in self.rows]
        tables=crop_tables(ref.crops,codes,field.soil)
        self.assertTrue(np.isfinite(tables['kc']).all())
        result=simulate(field,[(c,c,c) for c in codes],ref)
        self.assertEqual(result.etc_mm.shape[0],10)
        self.assertTrue(np.isfinite(result.eta_mm).all())
        self.assertTrue((result.eta_mm<=result.etc_mm+1e-8).all())
        self.assertTrue((result.irrigation_mm>=0).all())
        self.assertTrue((result.irrigation_mm[codes.index('fallow')]==0).all())

if __name__=='__main__': unittest.main()

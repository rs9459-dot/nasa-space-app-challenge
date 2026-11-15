import unittest
from types import SimpleNamespace
import pandas as pd
from engine.rotations import enumerate_rotations,candidate_report
class RotationTests(unittest.TestCase):
 def ref(self):
  rows=[dict(crop=c,perennial=p,heavy_feeder=h,plant_month=3,plant_day=1,stage_ini_days=30,stage_dev_days=30,stage_mid_days=30,stage_late_days=30,base_temp_c=0,gdd_required=100,frost_free_days_min=30) for c,p,h in [('alfalfa',1,0),('wheat',0,0),('corn',0,1),('fallow',0,0)]]
  return SimpleNamespace(crops=pd.DataFrame(rows).set_index('crop'),economics=pd.DataFrame([dict(crop='alfalfa',region='US-NV',yield_per_acre=4,price_usd_per_unit=200,cost_usd_per_acre=800)]))
 def test_rules(self):
  ref=self.ref();seqs=enumerate_rotations(list(ref.crops.index),ref)
  self.assertIn(('alfalfa',)*3,seqs);self.assertNotIn(('wheat',)*3,seqs)
  self.assertTrue(all(s.count('fallow')<=1 for s in seqs))
  self.assertTrue(all(not(a=='corn' and b=='corn') for s in seqs for a,b in zip(s,s[1:])))
 def test_missing_economics_excluded(self):
  weather=pd.DataFrame(dict(tmean_c=15,tmin_c=5),index=pd.date_range('2024-01-01','2024-12-31'))
  field=SimpleNamespace(country='US',place='Fallon, Nevada',weather=weather)
  report=candidate_report(field,self.ref())
  self.assertEqual([r['crop'] for r in report if r['eligible']],['alfalfa'])
 def test_disabled_gdd_is_disclosed(self):
  ref=self.ref();ref.crops.loc['alfalfa','gdd_required']=0
  weather=pd.DataFrame(dict(tmean_c=15,tmin_c=5),index=pd.date_range('2024-01-01','2024-12-31'))
  row=candidate_report(SimpleNamespace(country='US',place='Nevada',weather=weather),ref)[0]
  self.assertIn('unchecked',row['warnings'][0])
 def test_unknown_crop_rejected(self):
  with self.assertRaises(ValueError):enumerate_rotations(['unknown'],self.ref())
if __name__=='__main__':unittest.main()

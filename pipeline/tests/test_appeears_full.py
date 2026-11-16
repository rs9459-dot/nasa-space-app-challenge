import unittest,json
from pathlib import Path
from pipeline.satellite import hls_ndvi
class FullSatelliteTests(unittest.TestCase):
 def setUp(self):self.s=json.loads((Path(__file__).resolve().parents[2]/'data/fields/nv-fallon-01/satellite.json').read_text())
 def test_full_request_not_demo(self):
  self.assertEqual(self.s['request_id'],'6935203f-0a90-4846-8a99-eccd74bd0ee2');self.assertEqual(self.s['requested_period'],['2015-01-01','2025-12-31'])
 def test_valid_coverage_and_quality(self):
  for key in ['smap_soil_moisture','ndvi']:
   self.assertEqual({int(r['day'][:4]) for r in self.s[key]},set(range(2015,2026)))
   self.assertTrue(all(r['source'] and r['quality']=='accepted' for r in self.s[key]))
  self.assertTrue(all(0<=r['value']<=1 and r['retrieval_qual_flag']&3==0 for r in self.s['smap_soil_moisture']))
  self.assertTrue(all(-1<=r['value']<=1 and r['fmask']&62==0 for r in self.s['ndvi']))
 def test_srtm_actual_spacing(self):
  r=self.s['slope_pct_srtm'];self.assertAlmostEqual(r['value'],1.047135,places=5);self.assertGreater(r['east_west_m'],180)
 def test_unresolved_not_silently_used(self):
  self.assertEqual(self.s['ecostress_et_mm_day'],[])
 def test_scaled_hls_example(self):
  self.assertAlmostEqual(hls_ndvi(.1437,.2218,64,scale=1),.2136798905608755)

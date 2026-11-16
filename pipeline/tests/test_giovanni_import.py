import unittest,json
from pathlib import Path
from pipeline.giovanni_import import monthly_rain,volumetric
class MonthlyTests(unittest.TestCase):
 def test_rain_leap_year(self):
  self.assertEqual(monthly_rain(1,2020,2),696);self.assertEqual(monthly_rain(1,2021,2),672)
 def test_storage_depth(self):
  self.assertEqual(volumetric(250),.25)
  with self.assertRaises(ValueError):volumetric(-9999)
  with self.assertRaises(ValueError):volumetric(1001)
 def test_months_actual_dataset(self):
  s=json.loads((Path(__file__).resolve().parents[2]/'data/fields/nv-fallon-01/satellite.json').read_text())
  self.assertEqual(len(s['imerg_monthly_precip_mm']),297);self.assertEqual(len(s['nldas_soil_moisture']),300)
  self.assertEqual(s['imerg_monthly_precip_mm'][-1]['month'],'2025-09')
  self.assertTrue(all(r['depth_cm']==[0,100] and 0<=r['value']<=1 for r in s['nldas_soil_moisture']))
 def test_no_missing_month_invention(self):
  s=json.loads((Path(__file__).resolve().parents[2]/'data/fields/nv-fallon-01/satellite.json').read_text())
  self.assertNotIn('2025-10',{r['month'] for r in s['imerg_monthly_precip_mm']})

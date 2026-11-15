import unittest,csv,json
from pipeline.h3_strict import ROOT
class RegionalTests(unittest.TestCase):
 def rows(self):
  with (ROOT/'data/reference/economics.csv').open(newline='',encoding='utf-8') as f:return {r['crop']:r for r in csv.DictReader(f)}
 def test_bean_units_and_forecasts(self):
  r=self.rows()['dry_beans']
  self.assertAlmostEqual(float(r['yield_per_acre']),25.94)
  self.assertAlmostEqual(float(r['price_usd_per_unit']),37.78)
  self.assertEqual(r['unit'],'cwt');self.assertIn('Idaho',r['source_yield'])
  self.assertIn('REGIONAL PROXY',r['source_price'])
 def test_census_yields_and_price_proxies_separate(self):
  rows=self.rows();self.assertAlmostEqual(float(rows['wheat']['yield_per_acre']),283756/4019,places=5)
  self.assertIn('Nevada STATE',rows['wheat']['source_yield'])
  self.assertIn('Idaho STATE',rows['wheat']['source_price'])
 def test_unresolved_stays_missing(self):
  rows=self.rows();self.assertEqual(rows['corn_silage']['price_usd_per_unit'],'')
  self.assertEqual(rows['cover_crop']['cost_usd_per_acre'],'')
if __name__=='__main__':unittest.main()

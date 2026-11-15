import unittest
from pipeline.h3_strict import observed_series,readiness,CROPS
class StrictTests(unittest.TestCase):
 def row(self):return dict(short_desc='HAY, ALFALFA - YIELD, MEASURED IN TONS / ACRE',agg_level_desc='STATE',state_alpha='NV',domain_desc='TOTAL',prodn_practice_desc='ALL PRODUCTION PRACTICES',year='2024',Value='4.5',unit_desc='TONS / ACRE',reference_period_desc='YEAR')
 def test_only_nevada_matching_crop(self):
  row=self.row();other=dict(row,state_alpha='ID',Value='999')
  self.assertEqual(observed_series([{'records':[row,other]}],'HAY, ALFALFA','YIELD')['value'],4.5)
 def test_duplicate_fails(self):
  row=self.row()
  with self.assertRaises(ValueError):observed_series([{'records':[row,row]}],'HAY, ALFALFA','YIELD')
 def test_suppressed_is_not_zero(self):
  self.assertIsNone(observed_series([{'records':[dict(self.row(),Value='(D)')]}],'HAY, ALFALFA','YIELD'))
 def test_missing_crops_never_complete(self):
  self.assertTrue(all(not r['ready'] for r in readiness([],{})))
 def test_numbers_without_approval_cannot_pass(self):
  rows=[dict(crop=c,yield_per_acre=1,price_usd_per_unit=1,cost_usd_per_acre=1) for c in CROPS]
  self.assertTrue(all(not r['ready'] for r in readiness(rows,{})))
class ProductionRestrictionTests(unittest.TestCase):
 def test_production_matches_strict_and_has_no_foreign_proxy(self):
  from pipeline.h3_strict import ROOT
  import csv,json
  ref=ROOT/'data/reference'
  self.assertTrue((ref/'economics-strict.csv').exists())
  with (ref/'economics.csv').open(encoding='utf-8',newline='') as stream: rows=list(csv.DictReader(stream))
  self.assertTrue(all(r['region']=='US-NV' for r in rows))
  self.assertEqual(sum(r['cost_usd_per_acre']!='' for r in rows),7)
  self.assertEqual(next(r for r in rows if r['crop']=='cover_crop')['cost_usd_per_acre'],'')
  ledger=json.loads((ref/'economics-provenance.json').read_text())
  self.assertTrue(all(not r['ready_for_income_comparison'] for r in ledger.values()))
if __name__=='__main__':unittest.main()


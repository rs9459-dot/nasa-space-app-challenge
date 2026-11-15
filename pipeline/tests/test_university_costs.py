import unittest,json,csv
from pipeline.h3_strict import ROOT
from pipeline.university_costs import apply_costs,net_return
class UniversityCostsTests(unittest.TestCase):
 def test_table_water_arithmetic_and_budget_year(self):
  ref=ROOT/'data/reference';registry=json.loads((ref/'university-costs.json').read_text())
  with (ref/'economics.csv').open(newline='',encoding='utf-8') as f:rows={r['crop']:r for r in csv.DictReader(f)}
  for r in registry['records']:
   row=rows[r['crop']]
   self.assertAlmostEqual(float(row['cost_usd_per_acre']),r['reported_full_cost_usd_per_acre']-r['excluded_water_usd_per_acre'],places=2)
   self.assertEqual(row['years_averaged'],str(r['budget_year']))
   self.assertIn(r['source'],row['source_cost']);self.assertIn('PROTOTYPE',row['source_cost'])
  self.assertEqual(float(rows['barley']['cost_usd_per_acre']),963.07)
  self.assertEqual(float(rows['alfalfa']['cost_usd_per_acre']),843.36)
  self.assertEqual(rows['cover_crop']['cost_usd_per_acre'],'')
 def test_missing_is_unavailable_not_zero(self):
  self.assertEqual(net_return(dict(yield_per_acre=0,price_usd_per_unit=0,cost_usd_per_acre=''),0)['status'],'estimate unavailable')
 def test_net_return_subtracts_water_once_and_retains_losses(self):
  result=net_return(dict(yield_per_acre=1,price_usd_per_unit=100,cost_usd_per_acre=200),25)
  self.assertEqual(result['net_return_usd_per_acre'],-125)
  self.assertIn('Prototype',result['label'])
 def test_bad_water_deduction_rejected(self):
  bad=dict(records=[dict(crop='x',reported_full_cost_usd_per_acre=1,excluded_water_usd_per_acre=2)],unavailable={})
  with self.assertRaises(ValueError):apply_costs([dict(crop='x')],{'x':{}},bad)
if __name__=='__main__':unittest.main()

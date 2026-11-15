import unittest
from types import SimpleNamespace
import numpy as np,pandas as pd
from engine.types import WaterResult,Signals
from engine.yields import evaluate,display_net_return
class YieldTests(unittest.TestCase):
 def setup(self,ec=0,water_price=10,eta=100,cost=100):
  field=SimpleNamespace(country='US',place='Nevada',soil={'ec_ds_m':ec},water={'water_cost_usd_per_af':water_price})
  profile=dict(crop='alfalfa',ky=1.1,ece_threshold_ds_m=2,salinity_slope_pct=7.3,legume=1,residue_score=2,deep_roots=3,cover_benefit=2)
  ref=SimpleNamespace(crops=pd.DataFrame([profile]).set_index('crop'),economics=pd.DataFrame([dict(crop='alfalfa',region='US-NV',yield_per_acre=4,price_usd_per_unit=200,cost_usd_per_acre=cost)]))
  water=WaterResult([('alfalfa',)*3],np.array([[2021,2022,2023]]),np.full((1,1,3),100.),np.full((1,1,3),float(eta)),np.full((1,1,3),304.8))
  return field,water,ref
 def test_water_cost_once_and_averages(self):
  o=evaluate(*self.setup(),Signals());self.assertAlmostEqual(o.income_usd[0,0],690);self.assertAlmostEqual(o.water_af[0,0],1)
 def test_salinity_reduces_yield(self):
  o=evaluate(*self.setup(ec=6),Signals());self.assertAlmostEqual(o.yield_frac[0,0,0],.708)
 def test_water_stress_reduces_net_return(self):
  full=evaluate(*self.setup(),Signals());cut=evaluate(*self.setup(eta=50),Signals())
  self.assertLess(cut.income_usd[0,0],full.income_usd[0,0])
 def test_missing_price_never_zero(self):
  o=evaluate(*self.setup(water_price=None),Signals());self.assertTrue(np.isnan(o.income_usd[0,0]));self.assertIsNone(display_net_return(o.income_usd[0,0])['value'])
 def test_missing_production_cost_unavailable(self):
  self.assertTrue(np.isnan(evaluate(*self.setup(cost=''),Signals()).income_usd[0,0]))
 def test_invalid_water_rejected(self):
  with self.assertRaises(ValueError):evaluate(*self.setup(eta=101),Signals())
 def test_zero_et_does_not_invent_harvest(self):
  f,w,r=self.setup(eta=0);w.etc_mm[:]=0
  self.assertEqual(evaluate(f,w,r,Signals()).yield_frac[0,0,0],0)
if __name__=='__main__':unittest.main()

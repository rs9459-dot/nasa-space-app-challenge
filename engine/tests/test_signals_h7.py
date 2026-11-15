import unittest
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
import tempfile
import pandas as pd
from engine.signals import compute,annual_flow

class SignalsTests(unittest.TestCase):
    def setUp(self):
        base=Path(__file__).resolve().parents[2]/"data"/"raw"/"test-signals";base.mkdir(parents=True,exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(dir=base);self.addCleanup(self.temp.cleanup)
        p=patch('engine.signals.data_dir',return_value=Path(self.temp.name));p.start();self.addCleanup(p.stop)
        dates=pd.date_range('2020-01-01','2020-12-31')
        self.field=SimpleNamespace(field_id='test',weather=pd.DataFrame({'precip_mm':1.},index=dates),soil={},water={},satellite={})
    def test_missing_neutral(self):
        s=compute(self.field);self.assertEqual((s.start_depletion_frac,s.rain_scale,s.erosion_weight,s.history_confirmed,s.drought_years),(0,1,1,None,[]))
    def test_moisture_depth_and_age(self):
        self.field.soil={'fc_top_vol_pct':40,'wp_top_vol_pct':20,'horizons':[{'top_cm':0,'bottom_cm':18}]}
        row=dict(day='2020-12-25',value=.3,unit='m3/m3',quality='accepted',source='fixture',depth_cm=[0,18])
        self.field.satellite={'smap_soil_moisture':[row]};self.assertAlmostEqual(compute(self.field).start_depletion_frac,.5)
        row['depth_cm']=[0,5];self.assertEqual(compute(self.field).start_depletion_frac,0)
        row['depth_cm']=[0,18];row['day']='2019-12-25';self.assertEqual(compute(self.field).start_depletion_frac,0)
    def test_rain_overlap_and_clamp(self):
        rows=[dict(month=f'2020-{m:02d}',value=100,unit='mm/month',quality='accepted',source='fixture') for m in range(1,13)]
        self.field.satellite={'imerg_monthly_precip_mm':rows};self.assertEqual(compute(self.field).rain_scale,2)
        rows.pop();self.assertEqual(compute(self.field).rain_scale,1)
    def test_duplicate_month_rejected(self):
        rows=[dict(month=f'2020-{m:02d}',value=30,unit='mm/month',quality='accepted',source='fixture') for m in range(1,13)]
        rows.append(rows[0]);self.field.satellite={'imerg_monthly_precip_mm':rows};self.assertEqual(compute(self.field).rain_scale,1)
    def test_slope_fallback_conflict(self):
        self.field.soil={'slope_pct':.5,'source':'SSURGO'};self.assertAlmostEqual(compute(self.field).erosion_weight,1.1)
        self.field.satellite={'slope_pct_srtm':dict(value=10,unit='percent',quality='accepted',source='SRTM')};self.assertEqual(compute(self.field).erosion_weight,1)
    def test_history_requires_review(self):
        self.field.satellite={'history_comparison':dict(method='reviewed HLS-CDL comparison',reviewed=True,source='fixture',confirmed=False)}
        self.assertIs(compute(self.field).history_confirmed,False)
    def test_flow_quartile_and_allocations(self):
        folder=Path(self.temp.name)/'fields'/'test';folder.mkdir(parents=True)
        rows=[]
        for year,value in [(2017,10),(2018,20),(2019,30),(2020,40)]:
            rows.extend({'day':str(d.date()),'flow_cfs':value} for d in pd.date_range(f'{year}-01-01',f'{year}-12-31'))
        pd.DataFrame(rows).to_csv(folder/'nwis_flow.csv',index=False)
        self.field.water={'allocation_fraction_by_year':{'2018':.2,'2020':.5,'2021':.1}}
        self.assertEqual(compute(self.field).drought_years,[2017,2018])
    def test_incomplete_flow_excluded(self):
        d=pd.DataFrame({'day':pd.date_range('2020-01-01','2020-12-30'),'flow_cfs':1})
        self.assertTrue(annual_flow(d).empty)
    def test_real_fallon(self):
        from engine.bundle import load
        from engine import signals
        # Restore real data root only within this check.
        with patch('engine.signals.data_dir',return_value=Path(signals.__file__).resolve().parents[1]/'data'):
            field,_=load('nv-fallon-01');s=compute(field)
        self.assertTrue({2014,2015}.issubset(s.drought_years));self.assertEqual(s.rain_scale,1);self.assertIsNone(s.history_confirmed);self.assertAlmostEqual(s.erosion_weight,1.1)
    def test_signal_changes_water_simulation(self):
        from engine.bundle import load
        from engine.water import simulate
        from engine.types import Signals
        field,ref=load('nv-fallon-01')
        full=simulate(field,[('alfalfa',)*3],ref,Signals(),allocation={2025:1.})
        dry=simulate(field,[('alfalfa',)*3],ref,Signals(start_depletion_frac=.8,rain_scale=.5),allocation={2025:1.})
        self.assertGreater(float(dry.irrigation_mm.mean()),float(full.irrigation_mm.mean()))
    def test_soil_weight_reaches_yield_output(self):
        from engine.tests.test_yields_h5 import YieldTests
        from engine.yields import evaluate
        from engine.types import Signals
        args=YieldTests().setup()
        base=evaluate(*args,Signals(erosion_weight=1))
        weighted=evaluate(*args,Signals(erosion_weight=2))
        self.assertNotEqual(float(base.soil_score[0]),float(weighted.soil_score[0]))
    def test_future_and_bad_quality_moisture_neutral(self):
        self.field.soil={'fc_top_vol_pct':40,'wp_top_vol_pct':20,'horizons':[{'top_cm':0,'bottom_cm':18}]}
        self.field.satellite={'smap_soil_moisture':[dict(day='2021-01-01',value=.2,unit='m3/m3',quality='accepted',source='fixture',depth_cm=[0,18])]}
        self.assertEqual(compute(self.field).start_depletion_frac,0)
    def test_bad_units_rain_neutral(self):
        self.field.satellite={'imerg_monthly_precip_mm':[dict(month=f'2020-{m:02d}',value=30,unit='mm/hour',quality='accepted',source='fixture') for m in range(1,13)]}
        self.assertEqual(compute(self.field).rain_scale,1)

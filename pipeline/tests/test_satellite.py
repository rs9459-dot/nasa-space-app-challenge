import unittest
from pipeline.satellite import smap_good,hls_ndvi,slope_pct,seasonal_summary
class SatelliteTests(unittest.TestCase):
    def test_smap_quality(self):
        self.assertEqual(smap_good(.2,0),.2);self.assertEqual(smap_good(.2,8),.2)
        for q in [1,2,3,65534,None,1.5]:self.assertIsNone(smap_good(.2,q))
    def test_smap_fill(self):
        for v in [-9999,float('nan'),1.1,None]:self.assertIsNone(smap_good(v,0))
    def test_hls_sensor_bands(self):
        self.assertAlmostEqual(hls_ndvi(2000,6000,0,scale=.0001),.5)
        self.assertAlmostEqual(hls_ndvi(.2,.6,0,scale=1),.5)
    def test_hls_clouds_and_fill(self):
        for q in [2,4,8,16,32,192,255,None]:self.assertIsNone(hls_ndvi(2000,6000,q,scale=.0001))
        self.assertIsNone(hls_ndvi(-9999,6000,0,scale=.0001));self.assertIsNone(hls_ndvi(0,0,0,scale=1))
    def test_slope(self):
        self.assertAlmostEqual(slope_pct(101,99,100,100,east_west_m=200,north_south_m=200),1)
        self.assertIsNone(slope_pct(None,99,100,100,east_west_m=200,north_south_m=200))
    def test_summary_no_gap_fill(self):
        s=seasonal_summary([{'day':'2020-01-01','value':.2},{'day':'2022-01-01','value':.8}]);self.assertEqual([x['year'] for x in s],[2020,2022])

import unittest
from pipeline.nevada_census import census_yield
class CensusTests(unittest.TestCase):
 def rows(self,production='200',area='10'):
  common=dict(agg_level_desc='STATE',state_alpha='NV',domain_desc='TOTAL',prodn_practice_desc='ALL PRODUCTION PRACTICES')
  return [dict(common,short_desc='BARLEY - ACRES HARVESTED',Value=area),dict(common,short_desc='BARLEY - PRODUCTION, MEASURED IN BU',Value=production)]
 def test_derivation(self):self.assertEqual(census_yield(self.rows(),'BARLEY','BU')['value'],20)
 def test_suppression_and_zero_area_unavailable(self):
  self.assertIsNone(census_yield(self.rows('(D)'),'BARLEY','BU'))
  self.assertIsNone(census_yield(self.rows(area='0'),'BARLEY','BU'))
 def test_no_crop_class_substitution(self):self.assertIsNone(census_yield(self.rows(),'WHEAT, SPRING, (EXCL DURUM)','BU'))
 def test_duplicates_not_averaged(self):self.assertIsNone(census_yield(self.rows()+self.rows(),'BARLEY','BU'))
if __name__=='__main__':unittest.main()

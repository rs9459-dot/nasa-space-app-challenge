import unittest
from pipeline.ers_economics import extract
class ERSTests(unittest.TestCase):
 def rows(self):
  return [dict(Year='2025',Size='No specific size',Region='Basin and Range',Item=i,Value=str(v),Units='dollars per planted acre',Category='cost',**{'Survey base year':'2019'}) for i,v in [('Total, operating costs',100),('Total, allocated overhead',200),('Total, costs listed',300)]]
 def test_costs_reconcile_but_not_farmer_ready(self):
  self.assertFalse(extract(self.rows(),2025)[0]['farmer_income_ready'])
 def test_mixed_acre_basis_rejected(self):
  rows=self.rows();rows[0]['Units']='dollars per harvested acre'
  with self.assertRaises(ValueError):extract(rows,2025)
 def test_duplicate_rejected(self):
  rows=self.rows()
  with self.assertRaises(ValueError):extract(rows+[rows[0]],2025)
 def test_wrong_total_rejected(self):
  rows=self.rows();rows[-1]['Value']='999'
  with self.assertRaises(ValueError):extract(rows,2025)
if __name__=='__main__':unittest.main()

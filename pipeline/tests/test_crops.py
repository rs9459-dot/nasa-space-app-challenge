import json
import unittest
from pipeline.crops import parse_response

class CropResponseTests(unittest.TestCase):
    def test_namespaced_legacy_response(self):
        row=parse_response('<ns:return xmlns:ns="urn:cdl">{x: 1, y: 2, value: 36, category: "Alfalfa"}</ns:return>')
        self.assertEqual(row['crop'],'alfalfa')
        self.assertEqual(row['cdl_code'],36)

    def test_unmapped_category_retained(self):
        row=parse_response('<return>{"value":5,"category":"Soybeans"}</return>')
        self.assertIsNone(row['crop'])
        self.assertEqual(row['category'],'Soybeans')

    def test_corn_is_not_assumed_silage(self):
        self.assertEqual(parse_response('<r>{"value":1}</r>')['crop'],'corn')

    def test_invalid_missing_and_boolean_codes_rejected(self):
        for value in [None,True,'unavailable']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_response('<r>'+json.dumps({'value':value})+'</r>')

    def test_service_error_is_not_crop_zero(self):
        with self.assertRaises(ValueError): parse_response('<r>{"error":"no raster"}</r>')

if __name__=='__main__': unittest.main()

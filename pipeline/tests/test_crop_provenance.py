"""Guard against treating blanks/proxies as measured crop parameters."""
import csv
import json
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]

class ParameterEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with (ROOT/'data/reference/crops.csv').open(encoding='utf-8',newline='') as f:
            cls.rows=list(csv.DictReader(f))
        cls.evidence=json.loads((ROOT/'data/reference/crop_parameter_provenance.json').read_text(encoding='utf-8'))['parameters']

    def test_every_parameter_has_evidence_or_missing_reason(self):
        self.assertEqual(len(self.rows),10)
        for row in self.rows:
            for column,value in row.items():
                if column in ('crop','source'): continue
                with self.subTest(crop=row['crop'],column=column):
                    record=self.evidence[row['crop']][column]
                    if value=='':
                        self.assertIsNone(record['value'])
                        self.assertEqual(record['status'],'unavailable')
                        self.assertTrue(record['reason'].strip())
                    else:
                        self.assertEqual(float(value),record['value'])
                        self.assertIn(record['status'],('published_generic','regional_proxy'))
                        self.assertTrue(record['source'])

    def test_proxy_and_yield_type_are_not_hidden(self):
        self.assertEqual(self.evidence['corn']['frost_free_days_min']['status'],'regional_proxy')
        self.assertEqual(self.evidence['corn']['ky']['value'],1.25)
        self.assertIsNone(self.evidence['corn_silage']['ky']['value'])

    def test_unresolved_units_and_species_remain_missing(self):
        for crop in ('corn','barley','safflower'):
            self.assertIsNone(self.evidence[crop]['gdd_required']['value'])
        self.assertTrue(all(v['value'] is None for v in self.evidence['cover_crop'].values()))

if __name__=='__main__': unittest.main()

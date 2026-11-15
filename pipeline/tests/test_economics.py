import copy
import unittest
from pipeline.economics import parse_overview,quantity,aggregate,audit

class EconomicsTests(unittest.TestCase):
    def test_suppressed_data_is_missing_not_zero(self):
        for value in ['(D)','(NA)','(S)','', '(Z)']:
            self.assertEqual(quantity(value,'yield'),(None,None))

    def test_html_entities_nested_tags_and_commas(self):
        html='<table><tr><td><b>HAY, ALFALFA</b></td><td></td><td>1,000</td><td>4.5 TONS / ACRE</td><td>4,500 TONS</td><td>173 $ / TON</td><td>778,500</td></tr></table>'
        rows=parse_overview(html,'Nevada',2024,'https://example.test')
        self.assertEqual(rows[0]['yield_per_acre'],4.5)
        self.assertEqual(rows[0]['price_usd_per_unit'],173)
        self.assertEqual(rows[0]['yield_unit'],rows[0]['price_unit'])

    def test_changed_schema_is_not_empty_success(self):
        with self.assertRaises(ValueError):parse_overview('<p>Error</p>','Nevada',2024,'x')

    def test_averages_only_observed_years(self):
        rows=[dict(crop='alfalfa',geography='Nevada',year=y,yield_per_acre=v,yield_unit='short_ton',source='x') for y,v in [(2022,4.4),(2023,None),(2024,4.5)]]
        result=aggregate(rows,'alfalfa','Nevada','yield_per_acre')
        self.assertAlmostEqual(result['value'],4.45)
        self.assertEqual(result['years'],[2022,2024])

    def test_duplicate_year_and_mixed_units_fail(self):
        row=dict(crop='barley',geography='Utah',year=2024,yield_per_acre=90,yield_unit='bushel',source='x')
        with self.assertRaises(ValueError):aggregate([row,row],'barley','Utah','yield_per_acre')
        other=copy.deepcopy(row);other.update(year=2023,yield_unit='cwt')
        with self.assertRaises(ValueError):aggregate([row,other],'barley','Utah','yield_per_acre')

    def test_unknown_cost_cannot_appear_complete(self):
        row=dict(crop='barley',region='US-NV-Churchill',yield_per_acre=90,price_usd_per_unit=7.5,cost_usd_per_acre='',source_yield='NASS',source_price='NASS',source_cost='UNAVAILABLE',unit='bushel',years_averaged='2024')
        self.assertFalse(audit([row])[0]['numerically_complete'])
        self.assertIn('cost_usd_per_acre',audit([row])[0]['missing'])

    def test_live_evidence_conversion_and_budget_water_split(self):
        from pathlib import Path
        import json
        root=Path(__file__).resolve().parents[2]/'data/reference'
        evidence=json.loads((root/'economics-legacy-provenance.json').read_text())
        self.assertAlmostEqual(evidence['sorghum']['price_usd_per_unit']['value'],7.15*.56)
        self.assertEqual(evidence['sorghum']['price_usd_per_unit']['unit'],'bushel')
        self.assertEqual(evidence['safflower']['price_usd_per_unit']['unit'],'lb')
        for budget in json.loads((root/'economics-cost-evidence.json').read_text()):
            self.assertFalse(budget['approved_for_current_income'])
            self.assertAlmostEqual(budget['arithmetic_cost_without_irrigation_line_usd_per_acre'],budget['reported_total_cost_usd_per_acre']-budget['reported_irrigation_line_usd_per_acre'],places=2)

class VerificationTests(unittest.TestCase):
    def test_changed_and_missing_observation_fail(self):
        from pipeline.economics_verify import verify_observations
        row=dict(crop='barley',year=2024,geography='Utah',source='x',yield_per_acre=90)
        self.assertEqual(verify_observations([row],[])[0]['status'],'changed_or_mismatched')
        changed=dict(row,yield_per_acre=91)
        self.assertIn('yield_per_acre',verify_observations([row],[changed])[0]['differences'])

    def test_visual_review_bound_to_source_hash(self):
        from pipeline.economics_verify import attach_review
        review={'source_sha256':'abc'}
        check={};attach_review(check,{'status':'retrieved','sha256':'abc'},review)
        self.assertEqual(check['manual_review'],review)
        for snapshot in [{'status':'retrieved','sha256':'changed'},{'status':'retrieval_failed'}]:
            check={};attach_review(check,snapshot,review)
            self.assertNotIn('manual_review',check)

    def test_water_only_deductions_preserve_power_and_fees(self):
        import json
        from pipeline.economics import ROOT
        review=json.loads((ROOT/'data/reference/economics-budget-review.json').read_text())
        self.assertEqual(review['alfalfa']['water_only_deduction'],100)
        self.assertEqual(review['barley']['water_only_deduction'],0)
        self.assertTrue(all(not r['approved_for_current_income'] for r in review.values()))

if __name__=='__main__':unittest.main()


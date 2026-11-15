"""Report unresolved source restrictions without changing the partner engine."""
import json
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def audit(root=ROOT):
    ledger=json.loads((root/'data/reference/crop_parameter_provenance.json').read_text())
    cells=[dict(crop=crop,parameter=name,**cell) for crop,params in ledger['parameters'].items() for name,cell in params.items()]
    unresolved=[r for r in cells if r.get('status') in {'model_assumption','derived_assumption','regional_proxy','policy'}]
    economics=json.loads((root/'data/reference/economics-provenance.json').read_text())
    return dict(challenge_resource_url='https://www.spaceappschallenge.org/2026/challenges/adapting-farms-with-nasa-data/?tab=resources',
        status='blocked_for_resource_only_farmer_recommendations',
        crop_parameter_status_counts=dict(Counter(r.get('status','unknown') for r in cells)),
        unresolved_crop_parameters=unresolved,
        supplementary_crop_sources_require_review=True,
        economics_rows_ready=[crop for crop,row in economics.items() if row.get('ready_for_income_comparison')],
        county_quickstats_status='not_queried_pending_access',
        satellite_status='not_integrated_not_claimed_as_used',
        scope='Standalone audit; not wired into partner API. Published generic values also require resource-list and local relevance review.')

if __name__=='__main__':
    result=audit()
    target=ROOT/'data/reference/resource-compliance-audit.json'
    target.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k!='unresolved_crop_parameters'},indent=2))

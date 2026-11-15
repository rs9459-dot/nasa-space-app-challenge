"""Validate crop profiles and report evidence quality, without confusing it with calibration."""
from __future__ import annotations
import argparse
from collections import Counter
import csv
from datetime import date
import json
import math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
STATUSES={'published_generic','published_local','regional_proxy','derived_assumption','model_assumption','policy'}
BOOLEAN={'perennial','heavy_feeder','legume'}
STAGES=['stage_ini_days','stage_dev_days','stage_mid_days','stage_late_days']

def validate(rows, evidence, *, require_advice_ready=False):
    errors=[]; counts=Counter(); seen=set()
    if not rows: errors.append('No crop profiles')
    for row in rows:
        crop=row.get('crop','')
        if not crop or crop in seen: errors.append(f'Duplicate/empty crop code: {crop}')
        seen.add(crop); values={}
        cells=evidence.get('parameters',{}).get(crop,{})
        for column,raw in row.items():
            if column in ('crop','source'): continue
            try:
                value=float(raw)
                if not math.isfinite(value): raise ValueError()
                values[column]=value
            except (ValueError,TypeError):
                errors.append(f'{crop}.{column}: missing/nonfinite numeric value'); continue
            record=cells.get(column,{})
            status=record.get('status'); counts[status]+=1
            if status not in STATUSES or not record.get('source') or record.get('value')!=value:
                errors.append(f'{crop}.{column}: missing/mismatched cell evidence')
            if status in {'model_assumption','derived_assumption','policy'} and not record.get('reason'):
                errors.append(f'{crop}.{column}: assumption/policy needs rationale')
            if column in BOOLEAN and value not in (0,1): errors.append(f'{crop}.{column}: expected boolean')
            if column in STAGES and (value<0 or value!=int(value)): errors.append(f'{crop}.{column}: invalid stage days')
            if column in ('residue_score','deep_roots','cover_benefit') and not 0<=value<=3:
                errors.append(f'{crop}.{column}: score outside 0-3')
        try:
            date(2001,int(values['plant_month']),int(values['plant_day']))
            if values['plant_month']%1 or values['plant_day']%1: raise ValueError()
        except (ValueError,KeyError): errors.append(f'{crop}: invalid planting date')
        if sum(values.get(c,0) for c in STAGES)>365: errors.append(f'{crop}: season exceeds one year')
        if not 0<values.get('p_depletion',0)<1: errors.append(f'{crop}: depletion must be between 0 and 1')
        if values.get('root_depth_m',0)<=0: errors.append(f'{crop}: nonpositive root depth')
        for column in ['kc_ini','kc_mid','kc_end','ky','ece_threshold_ds_m','salinity_slope_pct','gdd_required','frost_free_days_min']:
            if values.get(column,-1)<0: errors.append(f'{crop}.{column}: negative value')
        if values.get('gdd_required')==0:
            record=cells.get('gdd_required',{})
            if record.get('status')!='policy' or 'DISABLE' not in record.get('reason',''):
                errors.append(f'{crop}: zero GDD gate must explicitly disclose disabled check')
        if not row.get('source'): errors.append(f'{crop}: missing source summary')
    if require_advice_ready:
        if not evidence.get('validated_for_farmer_advice'):
            errors.append('Local agronomic validation is absent; farmer-advice readiness is false')
        if any(counts[s] for s in ('model_assumption','derived_assumption','regional_proxy')):
            errors.append('Unreviewed assumptions/proxies cannot pass advice-readiness validation')
    return {'computationally_complete':not errors,'validated_for_farmer_advice':bool(evidence.get('validated_for_farmer_advice')),
            'crop_count':len(rows),'evidence_counts':dict(counts),'errors':errors}

def load_reference(root=ROOT):
    with (root/'data/reference/crops.csv').open(encoding='utf-8',newline='') as f: rows=list(csv.DictReader(f))
    evidence=json.loads((root/'data/reference/crop_parameter_provenance.json').read_text(encoding='utf-8'))
    return rows,evidence

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-advice-ready',action='store_true')
    args=parser.parse_args()
    result=validate(*load_reference(),require_advice_ready=args.require_advice_ready)
    print(json.dumps(result,indent=2))
    if result['errors']: raise SystemExit(1)

if __name__=='__main__': main()

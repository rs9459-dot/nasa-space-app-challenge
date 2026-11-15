"""H4 prototype eligibility and three-year rotation rules. Not agronomic validation."""
from itertools import product
import math
import pandas as pd
from engine.types import Rotation

def _finite(row,names):
    try:return all(math.isfinite(float(row[k])) and float(row[k])>=0 for k in names)
    except (KeyError,TypeError,ValueError):return False

def candidate_report(field,ref):
    # Current pilot supports only an explicitly identified Nevada field.
    region='US-NV' if field.country=='US' and 'Nevada' in field.place else None
    weather=field.weather.sort_index();result=[]
    for crop,row in ref.crops.iterrows():
        reasons=[];warnings=[]
        econ=ref.economics[(ref.economics['crop']==crop)&(ref.economics['region']==region)]
        if len(econ)!=1 or not _finite(econ.iloc[0],['yield_per_acre','price_usd_per_unit','cost_usd_per_acre']):reasons.append('matching complete economics unavailable')
        fields=['plant_month','plant_day','stage_ini_days','stage_dev_days','stage_mid_days','stage_late_days','base_temp_c','gdd_required','frost_free_days_min','perennial','heavy_feeder']
        if not _finite(row,fields):reasons.append('incomplete crop profile')
        else:
            gdds=[];frost_runs=[]
            duration=int(sum(float(row[k]) for k in fields[2:6]))
            for year in sorted(set(weather.index.year)):
                start=pd.Timestamp(year=year,month=int(row['plant_month']),day=int(row['plant_day']))
                days=pd.date_range(start,periods=duration,freq='D')
                season=weather.reindex(days)
                if duration==0 or season[['tmean_c','tmin_c']].isna().any().any():continue
                gdds.append(float((season.tmean_c-float(row['base_temp_c'])).clip(lower=0).sum()))
                run=best=0
                for temp in season.tmin_c:
                    run=run+1 if temp>0 else 0;best=max(best,run)
                frost_runs.append(best)
            if not gdds:reasons.append('no complete growing-season weather')
            else:
                if float(row['gdd_required'])>0 and min(gdds)<float(row['gdd_required']):reasons.append('heat requirement fails in at least one complete season')
                if float(row['frost_free_days_min'])>0 and min(frost_runs)<float(row['frost_free_days_min']):reasons.append('frost-free requirement fails in at least one complete season')
            if float(row['gdd_required'])==0:warnings.append('heat eligibility unchecked: requirement disabled, not zero biological need')
        result.append(dict(crop=crop,eligible=not reasons,reasons=reasons,warnings=warnings+['Prototype profiles and historical costs; not validated farmer advice']))
    return result

def candidate_crops(field,ref):
    return [r['crop'] for r in candidate_report(field,ref) if r['eligible']]

def enumerate_rotations(candidates,ref)->list[Rotation]:
    candidates=list(dict.fromkeys(candidates))
    for crop in candidates:
        if crop not in ref.crops.index:raise ValueError('Unknown crop: '+crop)
        if not _finite(ref.crops.loc[crop],['perennial','heavy_feeder']):raise ValueError('Missing rotation flags: '+crop)
    rotations=[]
    for seq in product(candidates,repeat=3):
        if seq.count('fallow')>1:continue
        if len(set(seq))==1 and not bool(float(ref.crops.loc[seq[0],'perennial'])):continue
        if any(bool(float(ref.crops.loc[a,'heavy_feeder'])) and bool(float(ref.crops.loc[b,'heavy_feeder'])) for a,b in zip(seq,seq[1:])):continue
        rotations.append(seq)
    return rotations

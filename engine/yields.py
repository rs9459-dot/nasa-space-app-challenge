"""H5 prototype FAO-response calculations. NaN net returns mean estimate unavailable."""
import math
import numpy as np
import pandas as pd
from engine.types import Outcomes
MM_PER_AF=304.8

def number(value):
    try:
        n=float(value)
        return n if math.isfinite(n) and n>=0 else None
    except (TypeError,ValueError):return None

def evaluate(field,water_result,ref,signals):
    """Calculate prototype yield fraction and annual three-year-average net return.

    FAO Ky water fraction times linear salinity factor, clipped 0..1. Field soil EC
    is provisionally treated as ECe; local measurement equivalence is unverified.
    Observed USDA yields are a prototype baseline, NOT independent unstressed Ym;
    applying stress can double-count stress already present in observed averages.
    Historical cost dollars and separate revenue years are not inflation aligned.
    Missing economics/EC/water price produce NaN, never invented zero. Consumers
    must render nonfinite numbers as unavailable, not serialize NaN as JSON.

    Soil rubric: average across 3 years of (3*legume + residue + deep_roots +
    cover_benefit*erosion_weight), divided by its maximum (9+3*weight), times 10.
    Clip 0..10. Ordinal design only; no measured soil-health or carbon gain.
    """
    rotations=water_result.rotations
    shape=(len(rotations),len(water_result.sequences),3)
    etc=np.asarray(water_result.etc_mm,dtype=float);eta=np.asarray(water_result.eta_mm,dtype=float);irrigation=np.asarray(water_result.irrigation_mm,dtype=float)
    for array in (etc,eta,irrigation):
        if array.shape!=shape or not np.isfinite(array).all() or (array<0).any():raise ValueError('Invalid water arrays')
    if (eta>etc+1e-6).any():raise ValueError('ETa exceeds ETc')
    weight=number(signals.erosion_weight)
    if weight is None or weight<1:raise ValueError('Invalid erosion weight')
    ec=number(field.soil.get('ec_ds_m'));water_price=number(field.water.get('water_cost_usd_per_af'))
    frac=np.full(shape,np.nan);annual=np.full(shape,np.nan);score=np.full(len(rotations),np.nan)
    for i,rotation in enumerate(rotations):
        scores=[]
        for j,crop in enumerate(rotation):
            if crop not in ref.crops.index:raise ValueError('Unknown crop '+crop)
            profile=ref.crops.loc[crop]
            if crop=='fallow':
                if (irrigation[i,:,j]>1e-6).any():raise ValueError('Fallow irrigation must be zero')
                frac[i,:,j]=0;annual[i,:,j]=0;scores.append(0);continue
            ky=number(profile.get('ky'));threshold=number(profile.get('ece_threshold_ds_m'));slope=number(profile.get('salinity_slope_pct'))
            if None not in (ky,threshold,slope,ec):
                ratio=np.divide(eta[i,:,j],etc[i,:,j],out=np.zeros(shape[1]),where=etc[i,:,j]>0)
                water_factor=np.clip(1-ky*(1-ratio),0,1)
                # Zero seasonal ET provides no physiological basis for harvest.
                water_factor=np.where(etc[i,:,j]>0,water_factor,0)
                salt_factor=np.clip(1-slope*max(ec-threshold,0)/100,0,1)
                frac[i,:,j]=water_factor*salt_factor
            econ=ref.economics[(ref.economics['crop']==crop)&(ref.economics['region']=='US-NV')] if field.country=='US' and 'Nevada' in field.place else pd.DataFrame()
            if len(econ)==1:
                row=econ.iloc[0];y=number(row.get('yield_per_acre'));price=number(row.get('price_usd_per_unit'));cost=number(row.get('cost_usd_per_acre'))
                if None not in (y,price,cost,water_price):annual[i,:,j]=frac[i,:,j]*y*price-cost-water_price*irrigation[i,:,j]/MM_PER_AF
            flags=[number(profile.get(k)) for k in ['legume','residue_score','deep_roots','cover_benefit']]
            scores.append(np.nan if None in flags else 3*flags[0]+flags[1]+flags[2]+weight*flags[3])
        score[i]=np.clip(np.mean(scores)/(9+3*weight)*10,0,10)
    return Outcomes(rotations=rotations,yield_frac=frac,income_usd=annual.mean(axis=2),water_af=(irrigation/MM_PER_AF).mean(axis=2),soil_score=score)

def display_net_return(value):
    """Safe scalar output label for API/dashboard adapters; no nonstandard JSON NaN."""
    return dict(label='Prototype net return; historical costs and regional proxies',status='available' if math.isfinite(float(value)) else 'estimate unavailable',value=float(value) if math.isfinite(float(value)) else None,unit='USD/acre/year')

"""H7 conservative, sourced signals. Missing evidence preserves neutral interface defaults."""
from __future__ import annotations
import math
import re
import pandas as pd
from engine.types import Signals
from engine.bundle import data_dir


def finite(value):
    try:
        v=float(value)
        return v if math.isfinite(v) else None
    except (ValueError,TypeError):return None


def annual_flow(frame):
    """Calendar-year mean flow; require every day, unique dates, finite nonnegative values."""
    if not {'day','flow_cfs'}.issubset(frame.columns):return pd.Series(dtype=float)
    d=frame.copy();d['day']=pd.to_datetime(d['day'],errors='coerce');d['flow_cfs']=pd.to_numeric(d['flow_cfs'],errors='coerce')
    d=d[d['day'].notna() & d.flow_cfs.ge(0) & d.flow_cfs.map(math.isfinite)]
    if d.day.duplicated().any():return pd.Series(dtype=float)
    d=d.set_index('day');out={}
    for year,g in d.groupby(d.index.year):
        expected=pd.date_range(f'{year}-01-01',f'{year}-12-31')
        if g.index.sort_values().equals(expected):out[year]=float(g.flow_cfs.mean())
    return pd.Series(out,dtype=float)


def compute(field):
    """Return Signals using validated observations, never a fabricated satellite value.

    As-of date is the final bundled weather day, NOT today's date: this is a
    historical prototype, not a live drought monitor. Moisture must be quality
    accepted, m3/m3, source-cited, <=31 days old, and explicitly depth-comparable
    to SSURGO top-horizon FC/WP. Do not substitute root-zone for surface moisture.
    IMERG/POWER ratio uses only common complete calendar years and is clamped
    to [0.5,2]; these bounds are design safeguards, not measured correction factors.
    Erosion weight=1+min(slope_pct,20)/5, range 1..5, an ordinal design rubric.
    SRTM vs SSURGO disagreement >2 percentage points returns neutral weight.
    NWIS drought=annual mean flow strictly below the complete-year 25th percentile;
    union with sourced allocations <0.5. No inference for missing allocation years.
    NDVI agreement remains unknown unless a source-cited reviewed comparison exists.
    """
    out=Signals();sat=field.satellite or {};soil=field.soil or {}
    weather=field.weather.copy();weather.index=pd.to_datetime(weather.index)
    if weather.empty:return out
    asof=weather.index.max().normalize()
    notes=[f'H7 historical as-of {asof.date()}; neutral defaults are no signal, not measurements']
    fc=finite(soil.get('fc_top_vol_pct'));wp=finite(soil.get('wp_top_vol_pct'))
    horizons=soil.get('horizons',[])
    depth=[horizons[0].get('top_cm'),horizons[0].get('bottom_cm')] if horizons else None
    eligible=[]
    for key in ('smap_soil_moisture','nldas_soil_moisture'):
        for row in sat.get(key,[]):
            day=pd.to_datetime(row.get('day'),errors='coerce');v=finite(row.get('value'))
            if pd.isna(day) or day.tzinfo is not None:continue
            if (row.get('quality')=='accepted' and row.get('unit')=='m3/m3' and row.get('source') and row.get('depth_cm')==depth and depth is not None and v is not None and 0<=v<=1 and 0<=(asof-day.normalize()).days<=31):eligible.append((day,v,row['source']))
    if eligible and fc is not None and wp is not None and 0<=wp<fc<=100:
        day,v,source=max(eligible,key=lambda x:x[0]);out.start_depletion_frac=max(0,min(1,(fc/100-v)/((fc-wp)/100)));notes.append(source+f'; moisture {day.date()}, depth-matched')
    else:notes.append('Moisture unavailable/stale/depth-incomparable: start depletion remains neutral 0')
    monthly={};ambiguous=set()
    for row in sat.get('imerg_monthly_precip_mm',[]):
        month=row.get('month','');v=finite(row.get('value'))
        if re.fullmatch(r'\d{4}-\d{2}',month) and 1<=int(month[5:])<=12 and row.get('unit')=='mm/month' and row.get('quality')=='accepted' and row.get('source') and v is not None and v>=0:
            if month in monthly:ambiguous.add(month)
            monthly[month]=(v,row['source'])
    ratios=[];used=[]
    if 'precip_mm' in weather:
        for year,g in weather.groupby(weather.index.year):
            months=[f'{year}-{m:02d}' for m in range(1,13)]
            expected=pd.date_range(f'{year}-01-01',f'{year}-12-31')
            rain=pd.to_numeric(g.precip_mm,errors='coerce')
            if not g.index.sort_values().equals(expected) or not rain.map(math.isfinite).all() or (rain<0).any() or any(m not in monthly or m in ambiguous for m in months):continue
            power=float(rain.sum())
            if power>0:ratios.append((sum(monthly[m][0] for m in months),power));used.extend(monthly[m][1] for m in months)
    if ratios:
        raw=sum(x[0] for x in ratios)/sum(x[1] for x in ratios);out.rain_scale=max(.5,min(2,raw));notes.extend(sorted(set(used)));notes.append(f'IMERG/POWER complete common years={len(ratios)}; raw ratio={raw:.6g}; clamp [0.5,2]')
    else:notes.append('No complete overlapping IMERG/POWER years: rain_scale neutral 1')
    mapped=finite(soil.get('slope_pct'));srtm=sat.get('slope_pct_srtm')
    observed=finite(srtm.get('value')) if isinstance(srtm,dict) and srtm.get('source') and srtm.get('unit')=='percent' and srtm.get('quality')=='accepted' else None
    if observed is not None and observed>=0 and mapped is not None and mapped>=0 and abs(observed-mapped)>2:notes.append('SRTM/SSURGO slope discrepancy >2 percentage points: erosion weight neutral')
    else:
        slope=observed if observed is not None and observed>=0 else mapped
        if slope is not None and slope>=0:
            out.erosion_weight=1+min(slope,20)/5;notes.append((srtm['source'] if observed is not None and observed>=0 else soil.get('source_detail',soil.get('source','SSURGO')))+'; ordinal slope weight, not measured erosion')
    # A reviewed comparison is evidence supplied by the H6 validation step, not a raw NDVI threshold.
    check=sat.get('history_comparison',{})
    if isinstance(check,dict) and check.get('method')=='reviewed HLS-CDL comparison' and check.get('source') and check.get('reviewed') is True and isinstance(check.get('confirmed'),bool):
        out.history_confirmed=check['confirmed'];notes.append(check['source'])
    else:notes.append('HLS-CDL agreement unknown: reviewed seasonal comparison unavailable')
    drought=set()
    for year,value in (field.water or {}).get('allocation_fraction_by_year',{}).items():
        v=finite(value)
        if str(year).isdigit() and v is not None and 0<=v<.5 and int(year)<=asof.year:drought.add(int(year))
    if drought:notes.append((field.water or {}).get('source','Water allocations')+'; allocation <0.5')
    # Field has no flow member: read only the existing owned-by-Abdullah auxiliary bundle file.
    if re.fullmatch(r'[A-Za-z0-9_-]+',field.field_id):
        path=data_dir()/'fields'/field.field_id/'nwis_flow.csv'
        if path.exists():
            yearly=annual_flow(pd.read_csv(path));yearly=yearly[yearly.index<=asof.year]
            if len(yearly)>=4:
                q=float(yearly.quantile(.25));drought.update(int(y) for y,v in yearly.items() if v<q);notes.append('USGS NWIS bundle nwis_flow.csv; annual calendar-year mean, complete days; bottom quartile; threshold '+str(q)+' cfs')
    out.drought_years=sorted(drought);out.sources=list(dict.fromkeys(notes));return out

"""Build H6 bundle from the completed full 2015-2025 AppEEARS request only.
Usage: python -m pipeline.appeears_import
Raw archives remain in ignored data/raw/appeears; their hashes are committed in report.
"""
import json,hashlib,math
from pathlib import Path
import pandas as pd
from pipeline.satellite import smap_good,hls_ndvi,seasonal_summary,slope_pct
ROOT=Path(__file__).resolve().parents[1]
TASK='6935203f-0a90-4846-8a99-eccd74bd0ee2'
URL='https://appeears.earthdatacloud.nasa.gov/view/'+TASK

def checked_csv(path,field=True):
    d=pd.read_csv(path)
    if field and (not d.ID.eq('nv-fallon-01').all() or not (d.Latitude-39.38).abs().lt(1e-7).all() or not (d.Longitude+118.77).abs().lt(1e-7).all()):raise ValueError('Wrong extraction location')
    return d

def build():
    raw=ROOT/'data/raw/appeears';folder=raw/'2015-2025';srtm=raw/'srtm'
    request=json.loads(next(folder.glob('*request.json')).read_text())
    dates=request.get('params',{}).get('dates',[])
    if len(dates)!=1 or dates[0].get('startDate')!='01-01-2015' or dates[0].get('endDate')!='12-31-2025' or dates[0].get('recurring',False):raise ValueError('Full 2015-2025 request required')
    hashes={str(p.relative_to(raw)):hashlib.sha256(p.read_bytes()).hexdigest() for f in (folder,srtm) for p in f.iterdir() if p.is_file()}
    result=dict(requested_period=['2015-01-01','2025-12-31'],request_id=TASK,provenance='NASA AppEEARS point extraction; quality-filtered observations',sources=[URL],smap_soil_moisture=[],ndvi=[],nldas_soil_moisture=[],imerg_monthly_precip_mm=[],ecostress_et_mm_day=[])
    report={'request_id':TASK,'raw_sha256':hashes,'products':{},'limitations':[]}
    sm=checked_csv(next(folder.glob('*SPL3SMP*results.csv')))
    for _,row in sm.iterrows():
        day=str(row.Date)
        if not '2015-01-01'<=day<='2025-12-31':raise ValueError('Date outside request')
        for orbit,suffix in [('AM',''),('PM','_pm')]:
            prefix=f'SPL3SMP_E_006_Soil_Moisture_Retrieval_Data_{orbit}_'
            value=smap_good(row[prefix+'soil_moisture'+suffix],row[prefix+'retrieval_qual_flag'+suffix])
            if value is not None:result['smap_soil_moisture'].append(dict(day=day,value=value,unit='m3/m3',source='https://doi.org/10.5067/M20OXIZHY3RJ',product='SPL3SMP_E.006',quality='accepted',retrieval_qual_flag=int(row[prefix+'retrieval_qual_flag'+suffix]),orbit=orbit,depth_cm=[0,5],resolution_m=9000))
    report['products']['SMAP']={'raw_date_rows':len(sm),'accepted_AM_PM_observations':len(result['smap_soil_moisture']),'note':'AM and PM are distinct observations; no daily averaging or root-zone conversion.'}
    for product,nir in [('HLSL30','B05'),('HLSS30','B8A')]:
        d=checked_csv(next(folder.glob('*'+product+'*results.csv')));count=0
        for _,row in d.iterrows():
            value=hls_ndvi(row[f'{product}_020_B04'],row[f'{product}_020_{nir}'],row[f'{product}_020_Fmask'],scale=1)
            day=str(row.Date)
            if not '2015-01-01'<=day<='2025-12-31':raise ValueError('Date outside request')
            if value is not None:
                result['ndvi'].append(dict(day=day,value=value,unit='1',source=f'https://doi.org/10.5067/HLS/{product}.002',product=product+'.020',quality='accepted',fmask=int(row[f'{product}_020_Fmask'])));count+=1
        report['products'][product]={'raw_rows':len(d),'accepted':count,'reflectance_scale_applied':1,'scale_evidence':'Download README section 3: AppEEARS point values are already scaled; verified reflectance values in CSV.'}
    result['ndvi'].sort(key=lambda x:(x['day'],x['product']))
    result['ndvi_annual_summary']=seasonal_summary(result['ndvi'])
    months={}
    for row in result['ndvi']:months.setdefault(row['day'][:7],[]).append(row['value'])
    result['ndvi_monthly_summary']=[dict(month=m,count=len(v),mean=sum(v)/len(v),min=min(v),max=max(v)) for m,v in sorted(months.items())]
    d=checked_csv(next(srtm.glob('*results.csv')),False).set_index('ID')
    if not all(k in d.index for k in ('center','east','west','north','south')):raise ValueError('Missing SRTM sample')
    dx=abs(float(d.loc['east','SRTMGL1_NC_003_Sample_X_30m'])-float(d.loc['west','SRTMGL1_NC_003_Sample_X_30m']))
    dy=abs(float(d.loc['north','SRTMGL1_NC_003_Line_Y_30m'])-float(d.loc['south','SRTMGL1_NC_003_Line_Y_30m']))
    # SRTMGL1 is a one-arcsecond geographic grid; use actual returned pixel index separation.
    ew=6371008.8*math.cos(math.radians(39.38))*math.radians(dx/3600)
    ns=6371008.8*math.radians(dy/3600)
    z=lambda k:float(d.loc[k,'SRTMGL1_NC_003_SRTMGL1_DEM'])
    slope=slope_pct(z('east'),z('west'),z('north'),z('south'),east_west_m=ew,north_south_m=ns)
    result['slope_pct_srtm']=dict(value=slope,unit='percent',quality='accepted',source='https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL1_NC.003',product='SRTMGL1_NC.003',day='2000-02-11',method='Neighborhood central differences, actual pixel-index spacing on 1 arcsecond grid; spherical local distance',east_west_m=ew,north_south_m=ns,center_elevation_m=z('center'),limitations='DEM neighborhood gradient, not surveyed parcel slope; center depression is not resolved by central differences.')
    report['products']['SRTM']=result['slope_pct_srtm']
    eco=checked_csv(next(folder.glob('*ECO*results.csv')))
    good=eco.ECO_L3T_JET_002_ETdaily.notna() & eco.ECO_L3T_JET_002_cloud.eq(0)
    result['ecostress_unresolved_unit_observations']=[dict(observed_at=row.Date,value=float(row.ECO_L3T_JET_002_ETdaily),unit='unresolved',cloud=0,source='https://doi.org/10.5067/ECOSTRESS/ECO_L3T_JET.002',quality='quarantined: unit discrepancy') for row in eco[good].itertuples()]
    report['products']['ECOSTRESS']={'raw_rows':len(eco),'finite_clear_rows_quarantined':int(good.sum()),'reason':'V002 catalog/user-guide report W/m2, other literature reports mm/day. No conversion or engine use until authoritative resolution; cloud-only screening is not full quality validation.'}
    report['limitations']=['IMERG and NLDAS not retrieved; their lists remain empty, not zero observations.','SMAP 0-5 cm depth is not comparable to SSURGO 0-18 cm horizon without validated method; H7 keeps depletion neutral.','No automatic crop/cutting confirmation from NDVI; reviewed comparison pending.','ECOSTRESS unit ambiguity preserved; mm/day series remains empty.','Eleven-year request window does not mean daily valid observations for all products.']
    result['limitations']=report['limitations'];result['sources']+=sorted({r['source'] for r in result['ndvi']+result['smap_soil_moisture']})+[result['slope_pct_srtm']['source']]
    for key in ['smap_soil_moisture','ndvi']:
        days=[r['day'] for r in result[key]];report['products'][key+'_coverage']={'count':len(days),'first':min(days) if days else None,'last':max(days) if days else None,'years':sorted({int(d[:4]) for d in days})}
    target=ROOT/'data/fields/nv-fallon-01/satellite.json';target.write_text(json.dumps(result,indent=2,allow_nan=False),encoding='utf-8')
    (ROOT/'docs/H6_FULL_VALIDATION.json').write_text(json.dumps(report,indent=2,allow_nan=False),encoding='utf-8')
    if (ROOT/'data/raw/giovanni').exists():
        from pipeline.giovanni_import import build as import_monthly
        import_monthly()
    return report
if __name__=='__main__':print(json.dumps(build()['products'],indent=2))

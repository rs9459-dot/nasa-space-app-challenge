"""Import NASA Giovanni single-grid-cell monthly results without filling missing months."""
import calendar,csv,hashlib,io,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
RAIN_VAR='mean_GPM_3IMERGM_07_precipitation'
SOIL_VAR='mean_NLDAS_NOAH0125_M_2_0_SoilM_0_100cm'

def monthly_rain(rate,year,month):
    if not math.isfinite(rate) or rate<0:raise ValueError('Invalid rain rate')
    return rate*24*calendar.monthrange(year,month)[1]

def volumetric(storage,depth_m=1):
    if not math.isfinite(storage) or storage<0 or depth_m<=0:raise ValueError('Invalid soil storage/depth')
    value=storage/(1000*depth_m)
    if value>1:raise ValueError('Volumetric fraction above one')
    return value

def read_giovanni(path,variable):
    text=Path(path).read_text(encoding='utf-8-sig');lines=text.splitlines()
    start=next(i for i,l in enumerate(lines) if l.startswith('time,'))
    meta={r[0].rstrip(':'):r[1].strip() for r in csv.reader(lines[:start]) if len(r)>=2}
    if meta.get('User Bounding Box')!='-118.771,39.379,-118.769,39.381':raise ValueError('Wrong requested region')
    fill=float(next(v for k,v in meta.items() if k.startswith('Fill Value')))
    seen=set();rows=[];rejected=0
    for row in csv.DictReader(io.StringIO('\n'.join(lines[start:])),skipinitialspace=True):
        month=row['time'][:7]
        if month in seen:raise ValueError('Duplicate month')
        seen.add(month);value=float(row[variable])
        if not math.isfinite(value) or value==fill or value<0:rejected+=1;continue
        if not '2001-01'<=month<='2025-12':raise ValueError('Unexpected time span')
        rows.append((month,value))
    return rows,meta,rejected

def build():
    raw=ROOT/'data/raw/giovanni';target=ROOT/'data/fields/nv-fallon-01/satellite.json'
    satellite=json.loads(target.read_text());report={}
    for kind,var,glob,doi,unit in [('imerg_monthly_precip_mm',RAIN_VAR,'*GPM*.csv','https://doi.org/10.5067/GPM/IMERG/3B-MONTH/07','mm/month'),('nldas_soil_moisture',SOIL_VAR,'*NLDAS*.csv','https://doi.org/10.5067/WB224IA3PVOJ','m3/m3')]:
        path=next(raw.glob(glob));rows,meta,rejected=read_giovanni(path,var)
        observations=[]
        for month,value in rows:
            year,m=map(int,month.split('-'));day=f'{month}-{calendar.monthrange(year,m)[1]:02d}'
            obs=dict(month=month,day=day,value=monthly_rain(value,year,m) if kind.startswith('imerg') else volumetric(value),unit=unit,quality='accepted',source=doi,source_query=meta['URL to Reproduce Results'],data_bounding_box=meta['Data Bounding Box'],native_value=value,native_unit='mm/hr' if kind.startswith('imerg') else 'kg/m2',temporal_support='monthly mean',note='Single coarse-grid cell near Fallon, not a field measurement; missing months not interpolated')
            if kind=='nldas_soil_moisture':obs.update(depth_cm=[0,100],product='NLDAS_NOAH0125_M.2.0',conversion='Monthly 0-100cm storage kg/m2 / (1000 kg/m3 * 1 m); direct aggregate, not availability percent')
            else:obs.update(product='GPM_3IMERGM.07',conversion='monthly mean mm/hr * 24 * calendar days in month')
            observations.append(obs)
        satellite[kind]=observations
        if doi not in satellite['sources']:satellite['sources'].append(doi)
        report[kind]=dict(count=len(rows),first=rows[0][0],last=rows[-1][0],rejected=rejected,raw_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),metadata=meta,native_unit='mm/hr' if kind.startswith('imerg') else 'kg/m2',output_unit=unit)
    satellite['limitations']=[s for s in satellite['limitations'] if not s.startswith('IMERG and NLDAS not retrieved')]
    satellite['limitations']+=['IMERG Final V07 available here only through 2025-09; no 2025 full-year correction.','NLDAS is model-derived monthly 0-100cm moisture on 0.125-degree grid, not a SMAP measurement or depth-equivalent to top-horizon SSURGO FC/WP.']
    target.write_text(json.dumps(satellite,indent=2,allow_nan=False),encoding='utf-8')
    (ROOT/'docs/H6_GIOVANNI_VALIDATION.json').write_text(json.dumps(report,indent=2,allow_nan=False),encoding='utf-8')
    return report
if __name__=='__main__':print(json.dumps(build(),indent=2))

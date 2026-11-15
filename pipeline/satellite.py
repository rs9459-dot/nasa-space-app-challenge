"""H6 quality-controlled satellite transforms; no synthetic observations or gap filling."""
import argparse
import csv
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SMAP_SOURCE='https://nsidc.org/data/user-resources/help-center/how-do-i-interpret-surface-and-quality-flag-information-level-2-and-3-passive-soil-moisture-products'
HLS_SOURCE='https://github.com/nasa/HLS-Data-Resources/blob/main/r/HLS_Tutorial.Rmd'


def finite(value):
    try:
        v=float(value)
        return v if math.isfinite(v) else None
    except (TypeError,ValueError):return None


def integer(value):
    v=finite(value)
    return int(v) if v is not None and v.is_integer() else None


def smap_good(value,quality):
    """Recommended, retrieval attempted: quality bits 0 and 1 both zero."""
    v=finite(value);q=integer(quality)
    return v if v is not None and 0<=v<=1 and q is not None and 0<=q<65534 and q&3==0 else None


def hls_ndvi(red,nir,fmask,*,scale):
    """Reject fill, cloud/adjacency/shadow/snow/water and high aerosol (conservative)."""
    r=finite(red);n=finite(nir);q=integer(fmask)
    if r is None or n is None or q is None or not 0<=q<255 or q&62 or q>>6==3:return None
    if r==-9999 or n==-9999 or scale<=0: return None
    r*=scale;n*=scale
    if r<0 or n<0 or r+n<=0:return None
    value=(n-r)/(n+r)
    return value if -1<=value<=1 else None


def slope_pct(east,west,north,south,*,east_west_m,north_south_m):
    """Central differences over measured sample separations; neighborhood-scale slope."""
    z=[finite(v) for v in (east,west,north,south)]
    if None in z or -32768 in z or east_west_m<=0 or north_south_m<=0:return None
    return 100*math.hypot((z[0]-z[1])/east_west_m,(z[2]-z[3])/north_south_m)


def seasonal_summary(observations):
    """Calendar-year/month bins; no crop identity or cutting detection inferred."""
    groups=defaultdict(list)
    for row in observations:
        groups[row['day'][:4]].append(row['value'])
    return [{'year':int(y),'count':len(v),'min':min(v),'max':max(v),'mean':sum(v)/len(v)} for y,v in sorted(groups.items())]


def import_hls(path,*,product,red_column,nir_column,qa_column,date_column,scale):
    """Explicit column/scale mapping avoids assuming AppEEARS CSV scaling/header names."""
    if product not in ('HLSL30.020','HLSS30.020'):raise ValueError('Unsupported HLS product')
    source='https://doi.org/10.5067/HLS/'+product.split('.')[0]+'.002'
    observations=[];rejected=0
    from datetime import datetime
    with Path(path).open(encoding='utf-8-sig',newline='') as f:
        for row in csv.DictReader(f):
            value=hls_ndvi(row[red_column],row[nir_column],row[qa_column],scale=scale)
            if value is None:rejected+=1;continue
            date=row[date_column]
            parsed=None
            for fmt in ('%Y-%m-%d','%m-%d-%Y','%Y%j'):
                try:parsed=datetime.strptime(date,fmt).date();break
                except ValueError:pass
            if parsed is None:raise ValueError('Unrecognized observation date')
            observations.append(dict(day=parsed.isoformat(),value=value,unit='1',source=source,product=product,quality='Fmask bits 1-5 clear; no high aerosol'))
    observations.sort(key=lambda x:x['day'])
    return dict(observations=observations,rejected_rows=rejected,annual_summary=seasonal_summary(observations),input_sha256=hashlib.sha256(Path(path).read_bytes()).hexdigest(),scale_applied=scale)


def main():
    p=argparse.ArgumentParser(description='Import verified HLS point CSV using explicit metadata mapping')
    p.add_argument('csv');p.add_argument('--product',required=True);p.add_argument('--red',required=True);p.add_argument('--nir',required=True);p.add_argument('--qa',required=True);p.add_argument('--date',required=True);p.add_argument('--scale',type=float,required=True);p.add_argument('--output',required=True)
    a=p.parse_args();result=import_hls(a.csv,product=a.product,red_column=a.red,nir_column=a.nir,qa_column=a.qa,date_column=a.date,scale=a.scale)
    Path(a.output).write_text(json.dumps(result,indent=2,allow_nan=False),encoding='utf-8')

if __name__=='__main__':main()

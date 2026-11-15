"""Fetch CDL point history. Run: python -m pipeline.crops --help.

Requires pyproj. TLS verification stays enabled. Raw responses and failures are retained.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import time
import ssl
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ENDPOINT = 'https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue'
CDL_CODES = {1:'corn',21:'barley',23:'wheat',24:'wheat',36:'alfalfa',42:'dry_beans',33:'safflower',4:'sorghum',61:'fallow'}

def parse_response(text):
    """Parse namespace-wrapped JSON; support service's unquoted-key legacy object."""
    payload = ''.join(ET.fromstring(text).itertext()).strip()
    payload = re.sub(r'([{,]\s*)([A-Za-z_][A-Za-z_0-9]*)(\s*:)', r'\1"\2"\3', payload)
    obj = json.loads(payload)
    code = obj.get('value')
    if isinstance(code, bool) or not str(code).isdigit():
        raise ValueError('CDL response has no integer value')
    code = int(code)
    return dict(cdl_code=code, crop=CDL_CODES.get(code), category=obj.get('category'))

def fetch(year, x, y, raw_dir):
    url = ENDPOINT + '?' + urllib.parse.urlencode(dict(year=year,x=x,y=y))
    for attempt in range(3):
        try:
            import truststore
            context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            with urllib.request.urlopen(url, timeout=25, context=context) as response:
                text=response.read().decode('utf-8')
            (raw_dir/f'{year}-{x:.1f}-{y:.1f}.xml').write_text(text,encoding='utf-8')
            return dict(year=year, **parse_response(text), source=url, retrieved_at=datetime.now(timezone.utc).isoformat())
        except Exception as exc:
            if attempt == 2: return dict(year=year,error=f'{type(exc).__name__}: {exc}',source=url)
            time.sleep(attempt+1)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--field-id',default='nv-fallon-01')
    parser.add_argument('--lat',type=float,default=39.38)
    parser.add_argument('--lon',type=float,default=-118.77)
    parser.add_argument('--start',type=int,default=2008)
    parser.add_argument('--end',type=int,default=2025)
    args=parser.parse_args()
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,62}',args.field_id): parser.error('Invalid field ID')
    if not -90<=args.lat<=90 or not -180<=args.lon<=180 or args.end<args.start: parser.error('Invalid coordinates/year range')
    from pyproj import Transformer
    x,y=Transformer.from_crs('EPSG:4326','EPSG:5070',always_xy=True).transform(args.lon,args.lat)
    root=Path(__file__).resolve().parents[1]
    raw=root/'data/raw/cdl'/args.field_id; raw.mkdir(parents=True,exist_ok=True)
    with ThreadPoolExecutor(max_workers=6) as pool:
        rows=list(pool.map(lambda year:fetch(year,x,y,raw),range(args.start,args.end+1)))
    # Check neighbours in latest successfully retrieved year; no inference of farm boundaries.
    good=[r for r in rows if 'error' not in r]
    neighbours=[]
    if good:
        year=good[-1]['year']
        for dx,dy in [(100,0),(-100,0),(0,100),(0,-100)]:
            neighbours.append(dict(dx_m=dx,dy_m=dy,**fetch(year,x+dx,y+dy,raw)))
    report=dict(field_id=args.field_id,lat=args.lat,lon=args.lon,x_epsg5070=x,y_epsg5070=y,history=rows,neighbours=neighbours)
    (raw/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    errors=[r for r in rows if 'error' in r]
    if errors:
        print(f'Incomplete: {len(errors)} failed years. Report: {raw / "report.json"}. Existing crop history preserved.')
        raise SystemExit(1)
    target=root/'data/fields'/args.field_id/'crop_history.json'
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')
    print(f'Saved {len(rows)} years to {target}. Neighbour checks: {raw / "report.json"}')

if __name__=='__main__': main()

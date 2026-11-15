"""Read-only QuickStats acquisition. Never logs credentials or credential-bearing URLs."""
import json, ssl, urllib.parse, urllib.request
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parents[1]
BASE='https://quickstats.nass.usda.gov/api/api_GET/'
COMMODITIES=['HAY','CORN','WHEAT','BARLEY','SORGHUM','BEANS','SAFFLOWER']

def load_key():
    import os
    key=os.environ.get('NASS_API_KEY','').strip()
    if not key:
        for line in (ROOT/'.env').read_text(encoding='utf-8-sig').splitlines():
            if '=' in line and line.split('=',1)[0].strip()=='NASS_API_KEY':
                key=line.split('=',1)[1].strip().strip('"').strip("'")
    if not key or key=='paste_your_key_here': raise ValueError('NASS_API_KEY not configured')
    return key

def query(key,commodity,level,measure):
    import truststore
    params=dict(source_desc='SURVEY',sector_desc='CROPS',group_desc='FIELD CROPS',commodity_desc=commodity,
                statisticcat_desc=measure,agg_level_desc=level,state_alpha='NV',freq_desc='ANNUAL',
                reference_period_desc='YEAR',domain_desc='TOTAL',year__GE='2021',year__LE='2025',format='JSON')
    if level=='COUNTY':
        params['county_name']='CHURCHILL'
        params['county_code']='001'
    if level=='CENSUS_COUNTY':
        params.update(agg_level_desc='COUNTY',source_desc='CENSUS',county_code='001',year='2022')
        params.pop('year__GE',None);params.pop('year__LE',None)
    if measure=='PRICE RECEIVED': params.pop('reference_period_desc',None)
    result=dict(endpoint=BASE,parameters=params,checked_at=datetime.now(timezone.utc).isoformat())
    try:
        request=urllib.request.Request(BASE+'?'+urllib.parse.urlencode(dict(params,key=key)),headers={'User-Agent':'FarmLine research pipeline'})
        with urllib.request.urlopen(request,context=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT),timeout=45) as response:
            payload=json.load(response)
        if 'data' not in payload:
            result.update(status='api_error',error='API response had no data array')
        else:
            rows=[r for r in payload['data'] if 2021 <= int(r['year']) <= 2025]
            result.update(status='records_returned' if rows else 'no_records',records=rows)
    except urllib.error.HTTPError as exc:
        # NASS uses HTTP 400 for empty queries as well as invalid filters; retain sanitized body for review.
        body=exc.read().decode('utf-8',errors='replace').replace(key,'[REDACTED]')
        result.update(status='http_error',http_status=exc.code,response_message=body[:1500])
    except Exception as exc:
        result.update(status='retrieval_failed',error_type=type(exc).__name__)
    return result

def main():
    key=load_key()
    jobs=[(c,'COUNTY','YIELD') for c in COMMODITIES]+[(c,'STATE','YIELD') for c in COMMODITIES]+[(c,'STATE','PRICE RECEIVED') for c in COMMODITIES]+[(c,'CENSUS_COUNTY','YIELD') for c in ['HAY','CORN','WHEAT','BARLEY']]
    with ThreadPoolExecutor(max_workers=3) as pool:
        results=list(pool.map(lambda args:query(key,*args),jobs))
    report=dict(dataset='USDA NASS QuickStats',queried_at=datetime.now(timezone.utc).isoformat(),
      meaning='Raw official survey records. State queries are comparison evidence, not automatically approved county fallbacks. No county suppression inferred from errors or absence.',queries=results)
    target=ROOT/'data/reference/quickstats-nevada-2021-2025.json'
    target.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    for r in results:
        p=r['parameters'];rows=r.get('records',[])
        print(p['commodity_desc'],p['agg_level_desc'],p['statisticcat_desc'],r['status'],len(rows))
    print('Saved sanitized official response records; key excluded.')
if __name__=='__main__': main()

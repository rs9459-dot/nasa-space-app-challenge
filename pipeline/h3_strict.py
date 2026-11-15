"""Strict H3 input table: unsupported regional transfers remain evidence, not inputs."""
import csv,json,math,argparse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CROPS=['alfalfa','wheat','barley','sorghum','dry_beans','safflower','corn_silage','cover_crop']
HEADERS=['crop','region','years_averaged','yield_per_acre','unit','price_usd_per_unit','cost_usd_per_acre','source_yield','source_price','source_cost']
DESCRIPTIONS={'alfalfa':'HAY, ALFALFA','corn_silage':'CORN, SILAGE'}

def observed_series(queries,description,statistic):
    found={}
    for query in queries:
        for r in query.get('records',[]):
            expected=description+' - '+statistic
            if not r.get('short_desc','').startswith(expected+','):continue
            if r.get('agg_level_desc')!='STATE' or r.get('state_alpha')!='NV':continue
            if r.get('domain_desc')!='TOTAL' or r.get('prodn_practice_desc')!='ALL PRODUCTION PRACTICES':continue
            year=int(r['year'])
            if not 2021<=year<=2025:continue
            try:value=float(r['Value'].replace(',',''))
            except (ValueError,TypeError):continue
            if not math.isfinite(value) or value<0:raise ValueError('Invalid observation')
            key=(year,r['unit_desc'],r['reference_period_desc'])
            if key in found:raise ValueError('Duplicate observation')
            found[key]=value
    if not found:return None
    if len({(k[1],k[2]) for k in found})!=1:raise ValueError('Mixed units or reference periods')
    return dict(value=sum(found.values())/len(found),years=sorted(k[0] for k in found),unit=next(iter(found))[1],period=next(iter(found))[2])

def build(root=ROOT):
    queries=json.loads((root/'data/reference/quickstats-nevada-2021-2025.json').read_text())['queries']
    rows=[];ledger={}
    for crop in CROPS:
        row={k:'' for k in HEADERS};row.update(crop=crop,region='US-NV',source_yield='UNAVAILABLE: no accepted matching observation',source_price='UNAVAILABLE: no accepted matching observation',source_cost='UNAVAILABLE: no approved comparable cost and irrigation accounting')
        ledger[crop]={'ready_for_income_comparison':False,'source_geography':'Nevada state where supplied; not Churchill County','cost_basis_resolved':False}
        for stat,col,src,required_unit in [('YIELD','yield_per_acre','source_yield','TONS / ACRE'),('PRICE RECEIVED','price_usd_per_unit','source_price','$ / TON')]:
            series=observed_series(queries,DESCRIPTIONS[crop],stat) if crop in DESCRIPTIONS else None
            if series:
                if series['unit']!=required_unit:raise ValueError('Unexpected quantity basis')
                row[col]=round(series['value'],6);row['unit']='short_ton'
                row[src]='USDA NASS QuickStats; Nevada STATE; '+series['period']+'; years '+','.join(map(str,series['years']))+'; https://quickstats.nass.usda.gov/; raw quickstats-nevada-2021-2025.json'
                if stat=='YIELD':row['years_averaged']=','.join(map(str,series['years']))
                ledger[crop][col]=series
        if crop=='cover_crop':
            row.update(yield_per_acre=0,price_usd_per_unit=0,unit='no_sale',years_averaged='policy',source_yield='POLICY: no harvested sale; not measured biomass',source_price='POLICY: terminated cover crop has no sale revenue')
        rows.append(row)
    target=root/'data/reference/economics-strict.csv'
    with target.open('w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=HEADERS);w.writeheader();w.writerows(rows)
    (root/'data/reference/economics-strict-provenance.json').write_text(json.dumps(ledger,indent=2)+'\n')
    return rows,ledger

def readiness(rows,ledger):
    report=[]
    for crop in CROPS:
        matches=[r for r in rows if r['crop']==crop]
        if len(matches)!=1:report.append(dict(crop=crop,ready=False,reasons=['missing or duplicate crop']));continue
        row=matches[0];reasons=[]
        for k in ['yield_per_acre','price_usd_per_unit','cost_usd_per_acre']:
            try:
                n=float(row[k])
                if not math.isfinite(n) or n<0:raise ValueError()
            except (ValueError,TypeError):reasons.append('missing/invalid '+k)
        if not ledger.get(crop,{}).get('ready_for_income_comparison'):reasons.append('provenance not approved')
        report.append(dict(crop=crop,ready=not reasons,reasons=reasons))
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--require-complete',action='store_true');args=parser.parse_args()
    rows,ledger=build();report=readiness(rows,ledger)
    (ROOT/'data/reference/h3-completion-check.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
    if args.require_complete and not all(r['ready'] for r in report):raise SystemExit(1)

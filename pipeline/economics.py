"""Fetch keyless NASS annual overviews and audit economics reference readiness.

Run python -m pipeline.economics fetch --state Nevada --years 2022 2023 2024
or python -m pipeline.economics audit. Never treats suppressed/unavailable data as zero.
"""
from __future__ import annotations
import argparse
import csv
from datetime import datetime,timezone
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import ssl
import urllib.parse
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
COMMODITIES={'HAY, ALFALFA':'alfalfa','CORN, SILAGE':'corn_silage','CORN, GRAIN':'corn',
             'BARLEY':'barley','SORGHUM, GRAIN':'sorghum','BEANS, DRY EDIBLE':'dry_beans',
             'SAFFLOWER':'safflower','WHEAT, SPRING, (EXCL DURUM)':'wheat'}

class OverviewParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.rows=[]; self.row=None; self.cell=None
    def handle_starttag(self,tag,attrs):
        if tag=='tr': self.row=[]
        if tag in ('td','th') and self.row is not None: self.cell=[]
    def handle_data(self,data):
        if self.cell is not None: self.cell.append(data)
    def handle_endtag(self,tag):
        if tag in ('td','th') and self.cell is not None:
            self.row.append(' '.join(''.join(self.cell).split()));self.cell=None
        if tag=='tr' and self.row is not None:
            self.rows.append(self.row);self.row=None

def quantity(text,kind):
    pattern=r'^([0-9,]+(?:\.[0-9]+)?)\s+(TONS|BU|CWT|LB)\s*/\s*ACRE$' if kind=='yield' else r'^([0-9,]+(?:\.[0-9]+)?)\s*\$\s*/\s*(TON|BU|CWT|LB)$'
    match=re.fullmatch(pattern,text.strip())
    if not match: return None,None
    return float(match[1].replace(',','')),{'TONS':'short_ton','TON':'short_ton','BU':'bushel','CWT':'cwt','LB':'lb'}[match[2]]

def parse_overview(html,state,year,url):
    parser=OverviewParser();parser.feed(html);observations=[]
    for row in parser.rows:
        if len(row)!=7 or row[0] not in COMMODITIES: continue
        crop=COMMODITIES[row[0]]
        yield_value,yield_unit=quantity(row[3],'yield')
        price,price_unit=quantity(row[5],'price')
        observations.append(dict(crop=crop,commodity=row[0],geography=state,geography_level='state',year=year,
             yield_per_acre=yield_value,yield_unit=yield_unit,price_usd_per_unit=price,price_unit=price_unit,
             raw_yield=row[3],raw_price=row[5],source=url,
             notes='State annual estimate, not field yield or unstressed potential yield. Missing/suppressed values remain null.'))
    if not observations: raise ValueError('No recognized crop observations: verify response and page schema')
    return observations

def aggregate(observations,crop,state,measure):
    rows=[r for r in observations if r['crop']==crop and r['geography']==state and r.get(measure) is not None]
    if not rows: return None
    unit_key='yield_unit' if measure=='yield_per_acre' else 'price_unit'
    if len({r[unit_key] for r in rows})!=1: raise ValueError('Mixed units must be normalized explicitly')
    if len({r['year'] for r in rows})!=len(rows): raise ValueError('Duplicate year would bias the mean')
    return dict(value=sum(r[measure] for r in rows)/len(rows),unit=rows[0][unit_key],
                years=sorted(r['year'] for r in rows),sources=[r['source'] for r in rows])

def audit(rows):
    report=[]
    for row in rows:
        missing=[]
        for column in ('yield_per_acre','price_usd_per_unit','cost_usd_per_acre'):
            try:
                number=float(row[column])
                if not math.isfinite(number) or number<0: raise ValueError()
            except (ValueError,TypeError):missing.append(column)
        for column in ('source_yield','source_price','source_cost','unit','years_averaged'):
            if not row.get(column) or 'UNAVAILABLE' in row[column] or 'PROVISIONAL' in row[column]: missing.append(column)
        report.append(dict(crop=row['crop'],region=row['region'],numerically_complete=not missing,missing=missing))
    return report

def build_legacy_evidence():
    NV_ALF='https://naes.unr.edu/publication.aspx?PubID=3855'
    NV_BAR='https://naes.unr.edu/publication.aspx?PubID=2301'
    UT='https://extension.usu.edu/apec/files/uploads/Agribusiness-and-Food/Budgets/Crops/Box-Elder/BoxElderCounty2011Crops-DF7-17.pdf'
    BEANS='https://coststudyfiles.ucdavis.edu/uploads/cs_public/06/bc/06bc592c-7a81-4472-b7f2-42404f401fd5/beans_sc_sv08.pdf'
    SAFF='https://coststudyfiles.ucdavis.edu/uploads/cs_public/63/a9/63a948b0-8cef-4843-b66c-ac27006f726f/safflowersv2011.pdf'
    COVER='https://coststudyfiles.ucdavis.edu/uploads/pub/2022/09/28/2022covercropsbenefits.pdf'
    budgets=[]
    for crop,year,region,total,irrigation,url,table,note in [
     ('alfalfa',2008,'Northwestern Nevada',943.36,111,NV_ALF,'Production Table 2','Website table heading says wine grapes despite alfalfa content. Verify original PDF before approval. Irrigation line includes operations; no separate water purchase price.'),
     ('barley',2008,'Northwestern Nevada',963.07,56,NV_BAR,'Table 1','Two-row malting barley, not generic feed barley. Irrigation deduction is POWER, not water-purchase cost; preserve the distinction.'),
     ('wheat',2011,'Box Elder County Utah',451,36,UT,'Table 8, p10','Regional irrigated-wheat proxy; wheat class not verified as spring wheat. Irrigation line is an annual operating expense.'),
     ('corn_silage',2011,'Box Elder County Utah',402.25,36,UT,'Table 6, p8','Regional flood-irrigation proxy. Does not provide a current silage price.'),
     ('dry_beans',2008,'Sacramento Valley California',999,85,BEANS,'Table 2, p11','Dry bush/vine varieties include lima and blackeye beans; commodity/species match requires review. Water line retained separately from irrigation labor.'),
     ('safflower',2011,'Sacramento Valley California',350,11,SAFF,'Table 2, p10','Irrigated bed-planted system; water line rounded in published table.'),
     ('cover_crop',2022,'Lower Sacramento Valley California',156,22,COVER,'Tables 1/2, p7','OPERATING costs only, not full economic ownership costs. Vetch/peas/rye mixture is not sole rye; proxy only. Nitrogen credit excluded because sole rye is not a legume.')]:
        budgets.append(dict(crop=crop,currency_year=year,source_geography=region,
            reported_total_cost_usd_per_acre=total,reported_irrigation_line_usd_per_acre=irrigation,
            arithmetic_cost_without_irrigation_line_usd_per_acre=round(total-irrigation,2),
            source=url,table=table,notes=note,approved_for_current_income=False,
            exclusion_warning='Arithmetic subtraction is for audit only. It is not automatically an appropriate cost adjustment: identify whether water.json replaces water price, pumping, labor, or all irrigation operating cost. Historic nominal dollars are not 2024/2026 costs.'))
    review_path=ROOT/'data/reference/economics-budget-review.json'
    if review_path.exists():
        review=json.loads(review_path.read_text(encoding='utf-8'))
        for budget in budgets:
            budget['verification_review']=review.get(budget['crop'],{})
    (ROOT/'data/reference/economics-cost-evidence.json').write_text(json.dumps(budgets,indent=2)+'\n',encoding='utf-8')
    observations=[]
    for path in (ROOT/'data/reference').glob('economics-observations-*.json'):
        observations.extend(json.loads(path.read_text(encoding='utf-8')))
    table=ROOT/'data/reference/economics-legacy-proxies.csv'
    with table.open(encoding='utf-8',newline='') as f:
        reader=csv.DictReader(f);headers=reader.fieldnames;rows=list(reader)
    evidence={}
    selection={'alfalfa':'Nevada','corn_silage':'Nevada','wheat':'Idaho','barley':'Utah','sorghum':'Kansas','safflower':'Utah'}
    for row in rows:
        crop=row['crop'];state=selection.get(crop)
        entry=dict(target_region='US-NV-Churchill',source_geography=state,
                   county_status='County QuickStats not queried by this keyless overview path. This is not evidence of suppression.',
                   geographic_transfer='Nevada state fallback' if state=='Nevada' else 'Out-of-state proxy; local market/crop suitability not verified')
        for field,column in [('yield_per_acre','source_yield'),('price_usd_per_unit','source_price')]:
            result=aggregate(observations,crop,state,field) if state else None
            if result:
                value=result['value'];unit=result['unit'];conversion=None
                # US short hundredweight = 100 lb. Sorghum bushel = 56 lb (USDA ERS).
                if field=='price_usd_per_unit' and crop=='sorghum' and unit=='cwt':
                    value*=.56;unit='bushel';conversion='USD/cwt * 56/100 = USD/bushel; USDA ERS Feed Grains documentation https://ers.usda.gov/data-products/feed-grains-database/documentation'
                if field=='price_usd_per_unit' and crop=='safflower' and unit=='cwt':
                    value/=100;unit='lb';conversion='USD/cwt / 100 = USD/lb (US hundredweight)'
                row[field]=round(value,6)
                if field=='yield_per_acre':row['unit']=unit
                elif row['unit'] and row['unit']!=unit:raise RuntimeError('Unresolved yield/price unit mismatch')
                row[column]='USDA NASS state overview; '+str(state)+'; years '+','.join(map(str,result['years']))+'; '+' ; '.join(result['sources'])+(' ; '+conversion if conversion else '')
                entry[field]=dict(value=row[field],unit=unit,years=result['years'],sources=result['sources'],conversion=conversion)
                if field=='yield_per_acre':row['years_averaged']=','.join(map(str,result['years']))
            else:
                row[field]='';row[column]='UNAVAILABLE: no verified current matching observation. Historical budget evidence is separate.'
                entry[field]=dict(value=None,reason=row[column])
        row['cost_usd_per_acre']=''
        row['source_cost']='UNAVAILABLE for current-income comparison: historical cost evidence retained in economics-cost-evidence.json; base year, system and water-charge alignment required.'
        entry['cost_usd_per_acre']=dict(value=None,reason=row['source_cost'])
        if crop=='cover_crop':
            row['yield_per_acre']=0;row['price_usd_per_unit']=0;row['unit']='no_sale';row['years_averaged']='policy'
            row['source_yield']=row['source_price']='POLICY: terminated sole-rye cover crop has no harvested sale in this model; no fabricated biomass yield or nitrogen credit.'
            entry['yield_per_acre']=entry['price_usd_per_unit']=dict(value=0,status='no_sale_policy')
        entry['ready_for_income_comparison']=False;evidence[crop]=entry
    with table.open('w',encoding='utf-8',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=headers);writer.writeheader();writer.writerows(rows)
    (ROOT/'data/reference/economics-legacy-provenance.json').write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
    print(f'Updated {len(rows)} rows with verified available observations; saved {len(budgets)} historical budget records separately.')



def build_reference():
    """Production table follows the user's challenge-resource restriction."""
    from pipeline.h3_strict import build
    import shutil
    rows,ledger=build(ROOT)
    ref=ROOT/'data/reference'
    from pipeline.university_costs import apply_costs
    rows,ledger=apply_costs(rows,ledger,json.loads((ref/'university-costs.json').read_text(encoding='utf-8')))
    order=json.loads((ref/'university-costs.json').read_text())['priority']
    rows.sort(key=lambda row:order.index(row['crop']))
    with (ref/'economics.csv').open('w',encoding='utf-8',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    (ref/'economics-provenance.json').write_text(json.dumps(ledger,indent=2)+'\n',encoding='utf-8')

    print(f'Built {len(rows)} prototype rows with {sum(r["cost_usd_per_acre"] not in ["",None] for r in rows)} cited university costs; unmatched costs stay blank.')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest='command',required=True)
    fetch=commands.add_parser('fetch');fetch.add_argument('--state',default='Nevada')
    fetch.add_argument('--years',nargs='+',type=int,default=[2022,2023,2024])
    commands.add_parser('audit'); commands.add_parser('build')
    args=parser.parse_args()
    if args.command=='build':
        build_reference(); return
    if args.command=='audit':
        with (ROOT/'data/reference/economics.csv').open(encoding='utf-8',newline='') as f: result=audit(list(csv.DictReader(f)))
        print(json.dumps(result,indent=2));return
    import truststore
    folder=ROOT/'data/raw/nass-overviews';folder.mkdir(parents=True,exist_ok=True)
    all_rows=[]
    for year in args.years:
        if not 1900<=year<=datetime.now().year: parser.error('Invalid year')
        url='https://www.nass.usda.gov/Quick_Stats/Ag_Overview/stateOverview.php?'+urllib.parse.urlencode(dict(state=args.state,year=year))
        with urllib.request.urlopen(url,context=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT),timeout=40) as response:
            html=response.read().decode('utf-8')
        observations=parse_overview(html,args.state,year,url)
        for row in observations: row['retrieved_at']=datetime.now(timezone.utc).isoformat()
        safe=re.sub('[^A-Za-z0-9-]','-',args.state)
        (folder/f'{safe}-{year}.html').write_text(html,encoding='utf-8')
        all_rows.extend(observations)
    target=ROOT/'data/reference'/f'economics-observations-{safe.lower()}.json'
    target.write_text(json.dumps(all_rows,indent=2)+'\n',encoding='utf-8')
    print(f'Saved {len(all_rows)} sourced observations to {target}')

if __name__=='__main__':main()

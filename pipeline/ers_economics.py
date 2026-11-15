"""Preserve ERS accounting basis; never silently transfer benchmarks to farm inputs."""
import csv,json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ITEMS={'Total, operating costs','Total, allocated overhead','Total, costs listed','Yield','Price'}
def extract(rows,year):
    selected=[r for r in rows if int(r['Year'])==year and r['Size']=='No specific size' and r['Item'].strip() in ITEMS]
    output=[]
    for region in sorted({r['Region'] for r in selected}):
        subset=[r for r in selected if r['Region']==region]
        values={}
        for row in subset:
            item=row['Item'].strip()
            if item in values: raise ValueError('Duplicate accounting item')
            values[item]={'value':float(row['Value']),'units':row['Units'],'category':row['Category'],'survey_base_year':row['Survey base year']}
        for item in ['Total, operating costs','Total, allocated overhead','Total, costs listed']:
            if item not in values or values[item]['units']!='dollars per planted acre': raise ValueError('Missing or changed cost basis')
        if abs(values['Total, operating costs']['value']+values['Total, allocated overhead']['value']-values['Total, costs listed']['value'])>.03:
            raise ValueError('Cost totals do not reconcile')
        output.append(dict(region=region,year=year,items=values,farmer_income_ready=False,
          limitations=['Regional sector benchmark, not field-specific cost.','Planted-acre basis must not be mixed with harvested-acre yield.','Irrigation water/power separation unresolved; no additional water charge may be added blindly.','Crop-class, production-system and geographic transfer require review.']))
    if not output:raise ValueError('No benchmark records')
    return output

def main():
    manifest=json.loads((ROOT/'data/reference/h3-official-downloads.json').read_text())
    result=[]
    for entry in manifest:
        if not entry['file'].endswith('.csv'):continue
        path=ROOT/'data/raw/h3-official'/entry['file']
        if hashlib.sha256(path.read_bytes()).hexdigest()!=entry['sha256']:raise ValueError('Source hash mismatch')
        with path.open(encoding='utf-8-sig',newline='') as stream:rows=list(csv.DictReader(stream))
        result.append(dict(commodity=entry['file'][:-4],source=entry['source'],source_sha256=entry['sha256'],benchmarks=extract(rows,2025)))
    (ROOT/'data/reference/ers-benchmarks-2025.json').write_text(json.dumps(result,indent=2)+'\n')
    print('Validated',sum(len(r['benchmarks']) for r in result),'regional benchmarks; farm approvals: 0')
if __name__=='__main__':main()

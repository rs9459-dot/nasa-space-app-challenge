"""Explicit user-authorized USDA regional prototype economics, never local measurements."""
import json,math

def apply_regional(rows,ledger,root):
    from pipeline.economics import aggregate
    sources={s:json.loads((root/f'data/reference/economics-observations-{s.lower()}.json').read_text()) for s in ['Utah','Idaho','Kansas']}
    choices={'wheat':'Idaho','barley':'Utah','sorghum':'Kansas','safflower':'Utah'}
    for row in rows:
        crop=row['crop']
        if crop not in choices:continue
        state=choices[crop]
        for column,source_column in [('yield_per_acre','source_yield'),('price_usd_per_unit','source_price')]:
            if row[column] not in ['',None]:continue
            result=aggregate(sources[state],crop,state,column)
            if result is None:continue
            unit=result['unit'];value=result['value'];conversion=None
            if column=='price_usd_per_unit' and unit=='cwt':
                if crop=='sorghum':value*=.56;unit='bushel';conversion='USD/cwt * 56/100 = USD/bushel'
                elif crop=='safflower':value/=100;unit='lb';conversion='USD/cwt / 100 = USD/lb'
            if row['unit'] and row['unit']!=unit:raise ValueError('Regional quantity mismatch')
            row['unit']=unit;row[column]=round(value,6)
            row[source_column]=f"PROTOTYPE REGIONAL PROXY, NOT FALLON OBSERVATION; USDA NASS; {state} STATE; years {result['years']}; "+'; '.join(result['sources'])+(('; '+conversion) if conversion else '')
            ledger[crop][column]=dict(result,value=row[column],unit=unit,source_geography=state,regional_proxy=True,conversion=conversion)
    # Matched aggregate bean class for both USDA measures; forecasts excluded.
    path=root/'data/reference/quickstats-idaho-beans.json'
    if path.exists():
        records=[r for q in json.loads(path.read_text()) for r in q.get('records',[])]
        row=next(r for r in rows if r['crop']=='dry_beans')
        for stat,column,src,period,unit,factor in [('YIELD','yield_per_acre','source_yield','YEAR','LB / ACRE',.01),('PRICE RECEIVED','price_usd_per_unit','source_price','MARKETING YEAR','$ / CWT',1)]:
            matches=[r for r in records if r.get('short_desc')==f'BEANS, DRY EDIBLE, (EXCL CHICKPEAS) - {stat}, MEASURED IN {unit}' and r.get('reference_period_desc')==period and r.get('prodn_practice_desc')=='ALL PRODUCTION PRACTICES' and r.get('state_alpha')=='ID' and r.get('agg_level_desc')=='STATE']
            if not matches:continue
            if len({r['year'] for r in matches})!=len(matches):raise ValueError('Duplicate bean year')
            values=[float(r['Value'].strip().replace(',','')) for r in matches]
            if not all(math.isfinite(v) and v>=0 for v in values):raise ValueError('Invalid bean value')
            row[column]=round(sum(values)/len(values)*factor,6);row['unit']='cwt'
            row[src]=f"PROTOTYPE REGIONAL PROXY, NOT FALLON OBSERVATION; USDA NASS QuickStats; Idaho STATE; dry edible beans excluding chickpeas (aggregate classes); {period}; years "+','.join(str(y) for y in sorted(int(r['year']) for r in matches))+'; https://quickstats.nass.usda.gov/; raw quickstats-idaho-beans.json'+('; yield LB/ACRE divided by 100 to CWT/ACRE' if stat=='YIELD' else '')
            ledger['dry_beans'][column]=dict(value=row[column],unit='cwt',regional_proxy=True,source_geography='Idaho',years=sorted(int(r['year']) for r in matches),commodity='dry edible beans excluding chickpeas; aggregate class proxy, not a pinto-specific price')
    return rows,ledger

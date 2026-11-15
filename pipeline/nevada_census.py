"""Derive a disclosed Nevada Census yield only from unsuppressed matching totals."""
import math

def census_yield(records,commodity,unit):
    def value(description):
        found=[r for r in records if r.get('short_desc')==description and r.get('agg_level_desc')=='STATE' and r.get('state_alpha')=='NV' and r.get('domain_desc')=='TOTAL' and r.get('prodn_practice_desc')=='ALL PRODUCTION PRACTICES']
        if len(found)!=1:return None
        try:n=float(found[0]['Value'].strip().replace(',',''))
        except (ValueError,TypeError):return None
        return n if math.isfinite(n) and n>=0 else None
    area=value(commodity+' - ACRES HARVESTED')
    production=value(commodity+' - PRODUCTION, MEASURED IN '+unit)
    if area is None or area<=0 or production is None:return None
    return dict(value=production/area,harvested_acres=area,production=production,year=2022,geography='Nevada state',method='Census production divided by harvested acres; derived, not reported annual yield or unstressed potential yield')

def apply_nevada_census(rows,ledger,queries):
    records=[r for q in queries for r in q.get('records',[])]
    for crop,commodity in [('wheat','WHEAT, SPRING, (EXCL DURUM)'),('barley','BARLEY')]:
        result=census_yield(records,commodity,'BU')
        if result is None:continue
        row=next(r for r in rows if r['crop']==crop)
        row['yield_per_acre']=round(result['value'],6);row['unit']='bushel';row['years_averaged']='2022'
        row['source_yield']=f"USDA NASS 2022 Census of Agriculture; Nevada STATE; {commodity}; {result['production']} BU / {result['harvested_acres']} harvested acres; derived yield; https://quickstats.nass.usda.gov/; raw quickstats-nevada-census-2022.json; county totals suppressed, not a Fallon measurement"
        ledger[crop]['yield_per_acre']=result
    return rows,ledger

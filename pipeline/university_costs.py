"""Apply user-authorized published university full costs, excluding water purchase charges."""
import math

def apply_costs(rows,ledger,registry):
    index={r['crop']:r for r in registry['records']}
    for row in rows:
        crop=row['crop'];entry=ledger[crop]
        entry['prototype']=True
        entry['display_label']='Prototype estimate; historical nominal university costs; not current farm advice'
        if crop not in index:
            row['cost_usd_per_acre']='';row['source_cost']='UNAVAILABLE: '+registry['unavailable'].get(crop,'No verified full-cost budget')
            entry['cost_usd_per_acre']={'value':None,'reason':row['source_cost']}
            continue
        r=index[crop];total=r['reported_full_cost_usd_per_acre'];water=r['excluded_water_usd_per_acre']
        if not all(math.isfinite(float(v)) and v>=0 for v in [total,water]) or water>total:raise ValueError('Invalid university water split')
        cost=round(total-water,2)
        if cost!=r['cost_usd_per_acre']:raise ValueError('University arithmetic mismatch')
        row['cost_usd_per_acre']=cost
        row['years_averaged']=str(r['budget_year'])
        row['source_cost']=f"{r['university']}; {r['title']}; {r['region']}; {r['budget_year']}; {r['table']}; {r['source']}; full published cost {total:.2f} minus water charge {water:.2f} = {cost:.2f} USD/acre; no inflation adjustment; PROTOTYPE. {r['notes']}"
        entry['cost_usd_per_acre']=dict(value=cost,budget=r)
        entry['cost_basis_resolved']=True
        entry['years_averaged_meaning']='Budget cost year only, per user request; revenue observation years retained in source columns and provenance.'
        entry['ready_for_income_comparison']=False
        entry['prototype_net_return_available']=all(row.get(k) not in ['',None] for k in ['yield_per_acre','price_usd_per_unit','cost_usd_per_acre'])
    return rows,ledger

def net_return(row,water_charge):
    """Single-year prototype arithmetic; caller must enforce crop/year/region caveats."""
    try: values=[float(row[k]) for k in ['yield_per_acre','price_usd_per_unit','cost_usd_per_acre']]+[float(water_charge)]
    except (ValueError,TypeError,KeyError):return {'label':'Prototype estimate','status':'estimate unavailable','net_return_usd_per_acre':None}
    if not all(math.isfinite(v) and v>=0 for v in values):return {'label':'Prototype estimate','status':'estimate unavailable','net_return_usd_per_acre':None}
    y,p,c,w=values
    return {'label':'Prototype net return; historical cost basis','status':'available','net_return_usd_per_acre':round(y*p-c-w,2)}

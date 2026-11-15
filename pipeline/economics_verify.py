"""Re-fetch primary sources and check reference transcriptions. Not a local-market certification."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
import ssl
import urllib.request

from pipeline.economics import ROOT,parse_overview,aggregate

def fetch_source(url,folder):
    import truststore
    digest=hashlib.sha256(url.encode()).hexdigest()[:16]
    try:
        with urllib.request.urlopen(url,context=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT),timeout=40) as response:
            body=response.read(); final_url=response.url
        pdf=body.startswith(b'%PDF')
        path=folder/(digest+('.pdf' if pdf else '.html'))
        path.write_bytes(body)
        return dict(status='retrieved',url=url,final_url=final_url,sha256=hashlib.sha256(body).hexdigest(),
                    snapshot=str(path.relative_to(ROOT)),is_pdf=pdf,body=body)
    except Exception as exc:
        return dict(status='retrieval_failed',url=url,error=f'{type(exc).__name__}: {exc}')

def verify_observations(stored,fresh):
    fields=['commodity','yield_per_acre','yield_unit','price_usd_per_unit','price_unit','raw_yield','raw_price']
    index={(r['crop'],r['year'],r['geography']):r for r in fresh}
    checks=[]
    for row in stored:
        other=index.get((row['crop'],row['year'],row['geography']))
        differences=['row missing'] if other is None else [f for f in fields if row.get(f)!=other.get(f)]
        checks.append(dict(crop=row['crop'],geography=row['geography'],year=row['year'],
                           status='matches_primary_source' if not differences else 'changed_or_mismatched',differences=differences,source=row['source']))
    return checks

def attach_review(check, snapshot, review):
    """A human review applies only to the exact source bytes inspected."""
    if not review:
        return
    if snapshot.get('status') == 'retrieved' and review.get('source_sha256') == snapshot.get('sha256'):
        check['manual_review'] = review
    elif review.get('source_sha256'):
        check['manual_review_status'] = 'stale_or_source_unavailable_requires_review'

def main():
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    folder=ROOT/'data/raw/economics-verification'/stamp;folder.mkdir(parents=True,exist_ok=True)
    observations=[]
    for path in (ROOT/'data/reference').glob('economics-observations-*.json'):
        observations.extend(json.loads(path.read_text(encoding='utf-8')))
    budgets=json.loads((ROOT/'data/reference/economics-cost-evidence.json').read_text(encoding='utf-8'))
    urls=sorted({r['source'] for r in [*observations,*budgets]})
    with ThreadPoolExecutor(max_workers=5) as pool:
        fetched=dict(zip(urls,pool.map(lambda url:fetch_source(url,folder),urls)))
    checks=[]
    for url in sorted({r['source'] for r in observations}):
        snapshot=fetched[url];stored=[r for r in observations if r['source']==url]
        if snapshot['status']!='retrieved':
            checks.extend(dict(crop=r['crop'],year=r['year'],status='not_reverified',source=url,error=snapshot['error']) for r in stored);continue
        try:
            fresh=parse_overview(snapshot['body'].decode('utf-8'),stored[0]['geography'],stored[0]['year'],url)
            checks.extend(verify_observations(stored,fresh))
        except Exception as exc:
            checks.append(dict(status='parse_failed',source=url,error=str(exc)))
    review_path=ROOT/'data/reference/economics-budget-review.json'
    reviews=json.loads(review_path.read_text(encoding='utf-8')) if review_path.exists() else {}
    budget_checks=[]
    page_index={'wheat':9,'corn_silage':7,'dry_beans':10,'safflower':9,'cover_crop':6}
    for row in budgets:
        snapshot=fetched[row['source']];check=dict(crop=row['crop'],source=row['source'],currency_year=row['currency_year'],approved_for_current_income=False)
        if snapshot['status']!='retrieved':
            check.update(status='not_reverified',error=snapshot['error'])
        elif snapshot['is_pdf']:
            try:
                from pypdf import PdfReader
                reader=PdfReader(BytesIO(snapshot['body']));page=page_index[row['crop']]
                text=reader.pages[page].extract_text() or ''
                normalized=re.sub(r'\s+','',text).replace(',','')
                values=[row['reported_total_cost_usd_per_acre'],row['reported_irrigation_line_usd_per_acre']]
                found=[str(int(v)) if v==int(v) else f'{v:.2f}' for v in values]
                check.update(status='numeric_strings_located_needs_visual_check' if all(v in normalized for v in found) else 'manual_table_review_required',page=page+1,numbers_located=[v for v in found if v in normalized])
            except Exception as exc:check.update(status='manual_table_review_required',error=str(exc))
        else:
            text=snapshot['body'].decode('utf-8',errors='replace')
            total=f"{row['reported_total_cost_usd_per_acre']:,.2f}"
            check.update(status='publisher_html_values_located' if total in text else 'manual_table_review_required',original_pdf_verified=False)
        attach_review(check,snapshot,reviews.get(row['crop']))
        budget_checks.append(check)
    result=dict(checked_at=datetime.now(timezone.utc).isoformat(),
       meaning='Source transcription and arithmetic checks, NOT proof of current/local relevance or farmer-advice readiness.',
       sources=[{k:v for k,v in record.items() if k!='body'} for record in fetched.values()],
       observation_checks=checks,budget_checks=budget_checks,
       summary=dict(observations=len(observations),observations_matching=sum(r['status']=='matches_primary_source' for r in checks),
                    budgets=len(budgets),retrieval_failures=sum(r['status']=='retrieval_failed' for r in fetched.values())),
       current_income_ready=False)
    result['summary'].update(
        budget_pdfs_visually_checked=sum(c.get('manual_review',{}).get('transcription_status')=='original_pdf_visually_confirmed' for c in budget_checks),
        budget_publisher_html_checked=sum(c.get('manual_review',{}).get('transcription_status')=='publisher_html_confirmed_original_pdf_not_verified' for c in budget_checks),
        budgets_not_retrieved_this_run=sum(c['status']=='not_reverified' for c in budget_checks),
        current_income_rows_approved=0)
    target=ROOT/'data/reference/economics-verification.json' 
    target.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result['summary'],indent=2));print(target)

if __name__=='__main__':main()

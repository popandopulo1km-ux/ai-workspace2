"""Customers on documents where the selected CRM card(s) are the partner.

Read-only; own purchases alone never qualify. Money is aggregated from the
same signed facts as history. Ambiguous CRM names never receive a guessed link.
"""
import re
import history_service as h
from crm_directory import resolve_many


def buyers(params):
    if params.get('role') != 'partner':
        raise ValueError('Список доступен в разрезе «Партнёр»')
    ref, start, end, channel, _, _ = h.conditions(params)
    refs = list(dict.fromkeys(params.get('groupRefs') or [ref]))
    summary = h.history(params, include_hidden=True)
    groups = [r['name'] for r in summary['groups']]
    if params.get('status') == 'earlier':
        year, month = map(int, start.split('-'))
        end = f'{year-1}-12' if month == 1 else f'{year}-{month-1:02}'
        start = h.MIN_MONTH
    page = max(0, min(int(params.get('buyerPage', 0)), 10000))
    result = dict(items=[], total=0, page=page, pageSize=50, known=summary['known'],
                  totals={k:dict(turnover=0,income=0) for k in ('partner','personal','overall')})
    if not groups or end < start:
        return result
    sql = '''FROM facts f WHERE f.month BETWEEN ? AND ?
      AND (f.file_id,f.source_row) IN (
        SELECT l.file_id,l.source_row FROM partner_data.links l
        JOIN partner_mapping m ON m.partner_id=l.partner_id
        WHERE m.ref IN (''' + ','.join('?' for _ in refs) + '''))
      AND f.grp IN (''' + ','.join('?' for _ in groups) + ')'
    args = [start, end] + refs + groups
    if channel != 'all':
        sql += ' AND f.kind=?'
        args.append(channel)
    with h.connect() as db:
        result['total'] = db.execute('SELECT COUNT(DISTINCT f.source_name) '+sql, args).fetchone()[0]
        page_rows = db.execute('SELECT f.source_name, SUM(f.amount) turnover, SUM(f.income) income '+sql+' GROUP BY f.source_name ORDER BY f.source_name LIMIT 50 OFFSET ?', args+[page*50]).fetchall()
        names = [r['source_name'] for r in page_rows]
        attributed = dict(db.execute('SELECT COALESCE(SUM(f.amount),0) turnover, COALESCE(SUM(f.income),0) income '+sql,args).fetchone())
        # Identical period, channel and TG/status universe for the union and partner subset.
        union_params={**params,'from':start,'to':end}
        _,_,_,_,union_where,union_args=h.conditions(union_params)
        union_where+=' AND f.month>=? AND f.grp IN ('+','.join('?' for _ in groups)+')'
        overall=dict(db.execute('SELECT COALESCE(SUM(f.amount),0) turnover, COALESCE(SUM(f.income),0) income FROM facts f WHERE '+union_where,union_args+[start]+groups).fetchone())
        _,_,_,_,own_where,own_args=h.conditions({**union_params,'role':'counterparty'})
        own_where+=' AND f.month>=? AND f.grp IN ('+','.join('?' for _ in groups)+')'
        personal=dict(db.execute('SELECT COALESCE(SUM(f.amount),0) turnover, COALESCE(SUM(f.income),0) income FROM facts f WHERE '+own_where,own_args+[start]+groups).fetchone())
        result['totals']=dict(partner={k:overall[k]-personal[k] for k in overall},overall=overall,personal=personal,attributed=attributed)
        own_names={r[0] for r in db.execute('SELECT source_name FROM mapping WHERE ref IN ('+','.join('?' for _ in refs)+')',refs)}
        group_rows = db.execute('SELECT f.source_name, f.grp, SUM(f.amount) turnover, SUM(f.income) income '+sql+' AND f.source_name IN ('+','.join('?' for _ in names)+') GROUP BY f.source_name,f.grp ORDER BY f.grp',args+names).fetchall() if names else []
        by_name={name:[] for name in names}
        for row in group_rows:
            if row['grp'] not in h.HIDDEN_GROUPS:
                by_name[row['source_name']].append(dict(name=row['grp'],turnover=row['turnover'],income=row['income']))
        resolved = resolve_many(names)
        for row in page_rows:
            name=row['source_name']
            resolution=resolved[name]
            target=resolution['target']
            match = re.fullmatch(r'(CO|C)_([1-9]\d*)', target['ref']) if target else None
            url = ('https://crm2.waterman-t.com/crm/'+('company' if match[1]=='CO' else 'contact')+'/details/'+match[2]+'/') if match else None
            result['items'].append(dict(name=name, ref=target['ref'] if match else None, url=url, crmName=target['name'] if match else None, code1c=target['code1c'] if match else None, matchStatus=resolution['matchStatus'],candidateCount=resolution['candidateCount'],turnover=row['turnover'],income=row['income'],groups=by_name[name],isPersonal=name in own_names))
    return result

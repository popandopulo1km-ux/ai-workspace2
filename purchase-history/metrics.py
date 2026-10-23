"""Read-only additions to the existing purchase-history totals. All amounts are kopecks."""
def purchase_metrics(db, params, a, b, known, active, aggregate, totals, hidden, min_month, month_list, where, args):
    pa=str(int(a[:4])-1)+a[4:]
    pb=str(int(b[:4])-1)+b[4:]
    complete=known and pa>=min_month
    previous=[r for r in aggregate if pa<=r['month']<=pb and r['grp'] in active]
    prior_turnover=sum(r['sales']+r['returns'] for r in previous)
    prior_income=sum(r['income'] for r in previous)
    all_previous=[r for r in aggregate if pa<=r['month']<=pb]
    lifetime_total=sum(r['sales']+r['returns'] for r in aggregate)
    lifetime_groups={}
    for r in aggregate:lifetime_groups[r['grp']]=lifetime_groups.get(r['grp'],0)+r['sales']+r['returns']
    prior_groups={}
    for r in all_previous:
        v=prior_groups.setdefault(r['grp'],[0,False]);v[0]+=r['sales']+r['returns'];v[1]=v[1] or bool(r['last'])
    prior_total=sum(r['sales']+r['returns'] for r in all_previous)
    prior_bought=sum(name in active and name not in hidden and prior_total>0 and val[0]*100>=prior_total*2 for name,val in prior_groups.items())
    count=0
    if known and active:
        # A purchase is a document, not an SKU row; the same invoice across TG/group members counts once.
        source_groups=set(active)
        if 'Бойлеры' in source_groups:source_groups.add('Бойлеры бытовые')
        sql="FROM facts f WHERE "+where+" AND f.month>=? AND f.kind!='returns' AND f.amount>0 AND f.grp IN ("+','.join('?' for _ in source_groups)+')'
        values=args+[a]+sorted(source_groups)
        missing=db.execute("SELECT COUNT(*) "+sql+" AND (f.doc IS NULL OR trim(f.doc)='')",values).fetchone()[0]
        if missing:count=None
        else:count=db.execute('SELECT COUNT(*) FROM (SELECT DISTINCT f.source_name,f.kind,f.doc,f.date '+sql+')',values).fetchone()[0]
    elif not known:count=None
    n=len(month_list(a,b))
    return dict(comparison=dict(fromMonth=pa,toMonth=pb,available=complete,
        reason='' if complete else 'Недостаточно истории для сравнения' if pa<min_month else 'Неполное сопоставление истории',
        turnoverDelta=totals['sales']+totals['returns']-prior_turnover if complete else None,
        incomeDelta=totals['income']-prior_income if complete else None,
        boughtDelta=totals['bought']-prior_bought if complete else None),
        purchases=dict(count=count,months=n,average=count/n if count is not None else None))

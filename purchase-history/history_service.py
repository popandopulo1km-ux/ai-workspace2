from metrics import purchase_metrics
import sqlite3, calendar, re
from contextlib import closing
from pathlib import Path
import identity

def canonical_group(name):return 'Бойлеры' if name=='Бойлеры бытовые' else name
GROUP_SQL="CASE WHEN f.grp='Бойлеры бытовые' THEN 'Бойлеры' ELSE f.grp END"
DB=Path(__file__).with_name('history.sqlite')
PARTNER_DB=Path(__file__).with_name('partners.sqlite')
HIDDEN_GROUPS = frozenset(["Разное","Без группы","Давальческое Инжиниринг","ИНСТРУМЕНТ АРЕНДНЫЙ","Мебель и оборудование 10,10","Проч. Разн. 10,09","Строит. отд  10,01","я Водяной-Инжиниринг","я МОЯ ВАННАЯ Новгородская","я НЕЛИКВИД","я ОБСЧЁТ","яТАНК","яяя ДОСТАВКИ"])

def available_period():
    with closing(sqlite3.connect(DB.as_uri()+'?mode=ro',uri=True)) as source:
        first,last=source.execute('SELECT min(month),max(month) FROM files').fetchone()
        complete=source.execute('SELECT count(DISTINCT kind),count(*) FROM files WHERE month=?',(last,)).fetchone()
        if complete!=(3,3):raise RuntimeError('Последний месяц загружен не полностью')
        meta=dict(source.execute('SELECT key,value FROM meta'))
    y,m=map(int,last.split('-'));n=y*12+m-1-11
    return dict(minMonth=first,maxMonth=last,defaultFrom=max(first,f'{n//12:04}-{n%12+1:02}'),
                cutoff=f'{last}-{calendar.monthrange(y,m)[1]:02}',snapshot=meta.get('sourceSnapshot',''))

PERIOD=available_period()
MIN_MONTH=PERIOD['minMonth'];MAX_MONTH=PERIOD['maxMonth']
def connect():
    if not DB.exists():raise RuntimeError('Подготавливается проверенная история покупок. Повторите через минуту.')
    db=sqlite3.connect(DB.as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    if PARTNER_DB.exists():db.execute('ATTACH DATABASE ? AS partner_data',(PARTNER_DB.as_uri()+'?mode=ro',))
    identity.install(db,DB)
    return db
def months(a,b):
    y,m=map(int,a.split('-')); result=[]
    while f'{y:04}-{m:02}'<=b:
        result.append(f'{y:04}-{m:02}');m+=1
        if m==13:y+=1;m=1
    return result
def age(last,end):return (int(end[:4])-int(last[:4]))*12+int(end[5:7])-int(last[5:7]) if last else None
def conditions(params):
    ref=params.get('ref','')
    if not re.fullmatch(r'(CO|C)_[1-9]\d*',ref):raise ValueError('Не определена карточка КА')
    a=params.get('from') or PERIOD['defaultFrom'];b=params.get('to') or MAX_MONTH
    if not(MIN_MONTH<=a<=b<=MAX_MONTH) or not all(re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])',m) for m in (a,b)):raise ValueError(f'Выберите период в пределах {MIN_MONTH} — {MAX_MONTH}, начало не позже окончания.')
    channel=params.get('channel','all')
    if channel not in ('all','wholesale','retail','returns'):raise ValueError('Неизвестный источник')
    refs=list(dict.fromkeys(params.get('groupRefs') or [ref]))
    if len(refs)>500 or any(not isinstance(r,str) or not re.fullmatch(r'(CO|C)_[1-9]\d*',r) for r in refs):raise ValueError('Неверный состав группы')
    sql='f.month<=? AND f.source_name IN (SELECT source_name FROM mapping WHERE ref IN ('+','.join('?' for _ in refs)+'))';args=[b]+refs
    role=params.get('role','counterparty')
    if role not in ('counterparty','partner'):raise ValueError('Неизвестный разрез покупок')
    if role=='partner':
        if not PARTNER_DB.exists():raise ValueError('Индекс покупок партнёров ещё не подготовлен')
        own='f.source_name IN (SELECT source_name FROM mapping WHERE ref IN ('+','.join('?' for _ in refs)+'))'
        invited='(f.file_id,f.source_row) IN (SELECT l.file_id,l.source_row FROM partner_data.links l JOIN partner_mapping m ON m.partner_id=l.partner_id WHERE m.ref IN ('+','.join('?' for _ in refs)+'))'
        sql='f.month<=? AND ('+own+' OR '+invited+')';args=[b]+refs+refs
    if channel!='all':sql+=' AND f.kind=?';args.append(channel)
    return ref,a,b,channel,sql,args
def history(params, include_hidden=False):
    ref,a,b,channel,where,args=conditions(params)
    with connect() as db:
        card=db.execute('SELECT * FROM cards WHERE ref=?',(ref,)).fetchone()
        card=dict(card) if card else dict(ref=ref,status='unmatched')
        refs=list(dict.fromkeys(params.get('groupRefs') or [ref]))
        role=params.get('role','counterparty')
        members=[role_status(db,r,role) for r in refs]
        known=all(m and m['status'] in ('matched','no_history') for m in members)
        matching_issues=identity.issues(db,refs)
        if not known and any(m and m['status'] in ('matched','partial') for m in members):card['status']='partial'
        elif not known:card['status']='unmatched'
        else:card['status']='matched'
        _,_,_,_,lifetime_where,lifetime_args=conditions(dict(params,to=MAX_MONTH))
        aggregate=db.execute('''SELECT '''+GROUP_SQL+''' grp,f.month,
        SUM(CASE WHEN kind!='returns' THEN amount ELSE 0 END) sales,
        SUM(CASE WHEN kind='returns' THEN amount ELSE 0 END) returns,SUM(income) income,
        MAX(CASE WHEN kind!='returns' AND amount>0 THEN date ELSE '' END) last
        FROM facts f WHERE '''+lifetime_where+' GROUP BY '+GROUP_SQL+',f.month',lifetime_args).fetchall()
        bygroup={canonical_group(r[0]):[] for r in db.execute('SELECT name FROM groups ORDER BY name')}
        for r in aggregate:bygroup.setdefault(r['grp'],[]).append(dict(r))
        group_rows=[]
        lifetime_turnover=sum(r['sales']+r['returns'] for r in aggregate)
        period_turnover=sum(r['sales']+r['returns'] for r in aggregate if a<=r['month']<=b)
        for name,items in bygroup.items():
            selected=[r for r in items if a<=r['month']<=b]
            last=max((r['last'] for r in items if r['month']<=b),default='')
            had_sales=any(r['last'] for r in selected)
            turnover=sum(r['sales']+r['returns'] for r in selected)
            lifetime_group_turnover=sum(r['sales']+r['returns'] for r in items)
            lifetime_significant=known and lifetime_turnover>0 and lifetime_group_turnover*100>=lifetime_turnover*2
            significant=known and period_turnover>0 and turnover*100>=period_turnover*2
            bought=significant
            had_past=any(r['last'] for r in items if r['month']<a)
            share=100*turnover/period_turnover if period_turnover>0 else None
            status='unknown' if not known else 'buying' if bought else 'low_share' if had_sales or turnover!=0 else 'earlier' if had_past else 'returns' if any(r['month']<=b for r in items) else 'never'
            group_rows.append(dict(name=name,lifetimeTurnover=lifetime_group_turnover,turnoverShare=share,qualifiesBuying=bought,recommendationEarlier=lifetime_significant and had_past and not had_sales,pastSales=sum(r['sales'] for r in items if r['month']<a),pastReturns=sum(r['returns'] for r in items if r['month']<a),pastIncome=sum(r['income'] for r in items if r['month']<a),sales=sum(r['sales'] for r in selected),returns=sum(r['returns'] for r in selected),income=sum(r['income'] for r in selected),last=last,gap=age(last,b),status=status,hasMovement=bool(selected)))
        counts={s:sum(r['status']==s for r in group_rows) for s in ('buying','earlier','low_share','never','returns','unknown')}
        group=canonical_group(params.get('group',''));q=params.get('q','').strip().casefold();status=params.get('status','all')
        if status not in ('all',*counts):raise ValueError('Неизвестный статус')
        shown=[r for r in group_rows if (not group or r['name']==group) and (not q or q in r['name'].casefold()) and (status=='all' or (r['recommendationEarlier'] if status=='earlier' else r['status']==status))]
        sort=params.get('sort','turnover')
        keys={'turnover':lambda r:r['sales']+r['returns'],'income':lambda r:r['income'],'gap':lambda r:r['gap'] if r['gap'] is not None else -1,'name':lambda r:r['name']}
        if sort not in keys:raise ValueError('Неизвестная сортировка')
        shown.sort(key=keys[sort],reverse=sort!='name')
        active={r['name'] for r in shown};series={m:dict(month=m,sales=0,returns=0,income=0) for m in months(a,b)}
        for r in aggregate:
            if r['grp'] in active and r['month'] in series:
                for f in ('sales','returns','income'):series[r['month']][f]+=r[f]
        totals={f:sum(r[f] for r in shown) for f in ('sales','returns','income')}
        totals.update(last=max((r['last'] for r in shown),default=''),bought=sum(r['status']=='buying' for r in shown))
        # Presentation only: keep monetary totals, last purchase and monthly series unchanged.
        shown=[r for r in shown if include_hidden or r['name'] not in HIDDEN_GROUPS]
        visible_rows=[r for r in group_rows if r['name'] not in HIDDEN_GROUPS]
        counts={s:sum((r['recommendationEarlier'] if s=='earlier' else r['status']==s) for r in visible_rows) for s in counts}
        totals['bought']=sum(r['status']=='buying' for r in shown)
        bygroup={name:items for name,items in bygroup.items() if name not in HIDDEN_GROUPS}
        metrics=purchase_metrics(db,params,a,b,known,active,aggregate,totals,HIDDEN_GROUPS,MIN_MONTH,months,where,args)
        return dict(**metrics,buyingThresholdPercent=2,lifetimeTurnover=lifetime_turnover,periodTurnover=period_turnover,matchingIssues=matching_issues,role=role,visibilityNote='Часть ТГ скрыта из списка. Общий оборот, доход и помесячные суммы включают скрытые группы.',card=card,known=known,fromMonth=a,toMonth=b,channel=channel,periodBounds=PERIOD,cutoff=PERIOD['cutoff'],snapshot=PERIOD['snapshot'],groups=shown,allGroups=list(bygroup),counts=counts,totals=totals,monthly=list(series.values()),quantity=None)

def role_status(db,ref,role):
    buyer=db.execute('SELECT status FROM cards WHERE ref=?',(ref,)).fetchone()
    if any(r[1]=='identity_data' for r in db.execute('PRAGMA database_list')):
        return {'status':buyer['status'] if buyer else 'unmatched'}
    partner=db.execute('SELECT status FROM partner_data.cards WHERE ref=?',(ref,)).fetchone() if PARTNER_DB.exists() else None
    bs=buyer['status'] if buyer else 'unmatched';ps=partner['status'] if partner else 'unmatched'
    if role=='counterparty':
        # A verified partner-only identity has zero own sales, not unknown sales.
        return {'status':'matched' if bs=='unmatched' and ps=='matched' else bs}
    if bs in ('partial','ambiguous') or ps in ('partial','ambiguous'):
        return {'status':'partial' if 'matched' in (bs,ps) or 'partial' in (bs,ps) else 'ambiguous'}
    return {'status':'matched' if 'matched' in (bs,ps) else 'unmatched'}

def details(params):
    ref,a,b,channel,where,args=conditions(params);group=params.get('group','')
    if not group:raise ValueError('Выберите товарную группу')
    with connect() as db:
        query='FROM facts f WHERE '+where+' AND f.month>=? AND '+GROUP_SQL+'=?'
        values=args+[a,canonical_group(group)];q=params.get('product','').strip().casefold()
        data=[dict(r) for r in db.execute('''SELECT f.sku,MAX(f.name) name,
        SUM(CASE WHEN kind!='returns' THEN amount ELSE 0 END) sales,
        SUM(CASE WHEN kind='returns' THEN amount ELSE 0 END) returns,SUM(income) income,
        MAX(CASE WHEN kind!='returns' AND amount>0 THEN date ELSE '' END) last '''+query+' GROUP BY f.sku ORDER BY SUM(amount) DESC',values)]
        if q:data=[r for r in data if q in r['name'].casefold() or q in r['sku'].casefold()]
        page=max(0,min(int(params.get('page',0)),10000));size=40
        series=[dict(r) for r in db.execute('SELECT f.month,SUM(amount) turnover,SUM(income) income '+query+' GROUP BY f.month ORDER BY f.month',values)]
        return dict(items=data[page*size:(page+1)*size],total=len(data),page=page,pageSize=size,monthly=series,group=group)

def documents(params):
    ref,a,b,channel,where,args=conditions(params);sku=params.get('sku','');group=params.get('group','')
    if not sku or not group:raise ValueError('Выберите товар')
    with connect() as db:
        query='FROM facts f WHERE '+where+' AND f.month>=? AND '+GROUP_SQL+'=? AND f.sku=?'
        values=args+[a,canonical_group(group),sku];page=max(0,int(params.get('docPage',0)))
        items=[dict(r) for r in db.execute('SELECT file_id,source_row,doc,date,kind,amount,income '+query+' ORDER BY date DESC,file_id,source_row LIMIT 40 OFFSET ?',values+[page*40])]
        total=db.execute('SELECT COUNT(*) '+query,values).fetchone()[0]
        return dict(items=items,total=total,page=page,pageSize=40)

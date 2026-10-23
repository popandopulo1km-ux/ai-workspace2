"""Read-only bulk history for an already-authorized set of CRM references."""
import json,sys,time,re
from history_service import connect,MAX_MONTH,HIDDEN_GROUPS

def summarize(refs):
    if not isinstance(refs,list) or len(refs)>5000 or any(not re.fullmatch(r'(CO|C)_[1-9]\d*',r) for r in refs):
        raise ValueError('Неверный список карточек')
    # Existing access-review exclusion: do not silently bypass it in bulk analytics.
    refs=list(dict.fromkeys(r for r in refs if r!='CO_97'))
    y,m=map(int,MAX_MONTH.split('-'));n=y*12+m-12;start=f'{n//12:04}-{n%12+1:02}';end=MAX_MONTH
    prior_start=str(int(start[:4])-1)+start[4:];prior_end=str(int(end[:4])-1)+end[4:]
    with connect() as db:
        db.execute('CREATE TEMP TABLE selected_refs(ref TEXT PRIMARY KEY)')
        db.executemany('INSERT INTO selected_refs VALUES(?)',[(r,) for r in refs])
        states={r['ref']:r['status'] for r in db.execute('SELECT c.ref,c.status FROM cards c JOIN selected_refs s ON s.ref=c.ref')}
        groups=[r[0] for r in db.execute('SELECT name FROM groups ORDER BY name')]
        def ingest(rows,target):
            for r in rows:
                key=(r['ref'],r['grp']);v=target.setdefault(key,dict(turnover=0,lifetimeTurnover=0,priorTurnover=0,priorIncome=0,currentIncome=0,last='',past=False,current=False))
                v['lifetimeTurnover']+=r['lifetimeTurnover'] or 0
                v['priorTurnover']+=r['priorTurnover'] or 0
                v['priorIncome']+=r['priorIncome'] or 0;v['currentIncome']+=r['currentIncome'] or 0
                v['turnover']+=r['turnover'] or 0;v['last']=max(v['last'],r['last'] or '');v['past']=v['past'] or bool(r['past']);v['current']=v['current'] or bool(r['current'])
        own={}
        ingest(db.execute('''SELECT m.ref,f.grp,SUM(CASE WHEN f.month>=? THEN f.sales+f.returns ELSE 0 END) turnover,
            SUM(CASE WHEN f.month>=? AND f.month<? THEN f.sales+f.returns ELSE 0 END) priorTurnover,
            SUM(f.sales+f.returns) lifetimeTurnover,MAX(f.last_date) last,MAX(CASE WHEN f.month<? AND f.last_date!='' THEN 1 ELSE 0 END) past,
            MAX(CASE WHEN f.month>=? AND f.last_date!='' THEN 1 ELSE 0 END) current,
            SUM(CASE WHEN f.month>=? AND f.month<? THEN f.income ELSE 0 END) priorIncome,
            SUM(CASE WHEN f.month>=? THEN f.income ELSE 0 END) currentIncome
            FROM selected_refs s CROSS JOIN mapping m ON m.ref=s.ref
            CROSS JOIN monthly f ON f.source_name=m.source_name WHERE f.month<=? GROUP BY m.ref,f.grp''',(start,prior_start,start,start,start,prior_start,start,start,end)),own)
        partner={k:dict(v) for k,v in own.items()}
        # Exclude own-source rows already counted above; partner links have unique fact identities.
        ingest(db.execute('''SELECT m.ref,f.grp,SUM(CASE WHEN f.month>=? THEN f.amount ELSE 0 END) turnover,
            SUM(CASE WHEN f.month>=? AND f.month<? THEN f.amount ELSE 0 END) priorTurnover,
            SUM(f.amount) lifetimeTurnover,MAX(CASE WHEN f.kind!='returns' AND f.amount>0 THEN f.date ELSE '' END) last,
            MAX(CASE WHEN f.month<? AND f.kind!='returns' AND f.amount>0 THEN 1 ELSE 0 END) past,
            MAX(CASE WHEN f.month>=? AND f.kind!='returns' AND f.amount>0 THEN 1 ELSE 0 END) current,
            SUM(CASE WHEN f.month>=? AND f.month<? THEN f.income ELSE 0 END) priorIncome,
            SUM(CASE WHEN f.month>=? THEN f.income ELSE 0 END) currentIncome
            FROM selected_refs s CROSS JOIN partner_mapping m ON m.ref=s.ref
            CROSS JOIN partner_data.links l ON l.partner_id=m.partner_id
            CROSS JOIN facts f ON f.file_id=l.file_id AND f.source_row=l.source_row
            WHERE f.month<=? AND NOT EXISTS(SELECT 1 FROM mapping own WHERE own.ref=s.ref AND own.source_name=f.source_name)
            GROUP BY m.ref,f.grp''',(start,prior_start,start,start,start,prior_start,start,start,end)),partner)
        totals={};lifetime_totals={}
        for label,values in [('partner',partner),('counterparty',own)]:
            totals[label]={};lifetime_totals[label]={}
            for (ref,group),value in values.items():lifetime_totals[label][ref]=lifetime_totals[label].get(ref,0)+value['lifetimeTurnover']
            for (ref,group),value in values.items():totals[label][ref]=totals[label].get(ref,0)+value['turnover']
        def summary(ref,values,label):
            known=states.get(ref) in ('matched','no_history');total=totals[label].get(ref,0);lifetime_total=lifetime_totals[label].get(ref,0);rows=[]
            for name in groups:
                if name in HIDDEN_GROUPS:continue
                v=values.get((ref,name),{});turnover=v.get('turnover',0);last=v.get('last','');current=v.get('current',False)
                lifetime_turnover=v.get('lifetimeTurnover',0)
                significant=known and lifetime_total>0 and lifetime_turnover*100>=lifetime_total*2
                buying=significant and current
                status='unknown' if not known else 'buying' if buying else 'low_share' if last and not significant else 'earlier' if last and significant else 'returns' if (ref,name) in values else 'never'
                rows.append(dict(name=name,status=status,last=last,turnover=turnover,priorTurnover=v.get('priorTurnover',0),lifetimeTurnover=lifetime_turnover,priorIncome=v.get('priorIncome',0),currentIncome=v.get('currentIncome',0),turnoverShare=100*lifetime_turnover/lifetime_total if lifetime_total>0 else None,recommendationEarlier=significant and bool(v.get('past')) and not current))
            return dict(known=known,groups=rows,periodTurnover=total,lifetimeTurnover=lifetime_total)
        result={r:dict(partner=summary(r,partner,'partner'),counterparty=summary(r,own,'counterparty')) for r in refs}
        for roles in result.values():
            for h in roles.values():
                for g in h['groups']:g['incomeDeclined']=g['priorIncome']>g['currentIncome']
        db.execute('CREATE TEMP TABLE lost_pairs(ref TEXT,grp TEXT,PRIMARY KEY(ref,grp))')
        db.executemany('INSERT INTO lost_pairs VALUES(?,?)',[(ref,g['name']) for ref,h in result.items() for g in h['partner']['groups'] if g['recommendationEarlier'] and g['incomeDeclined']])
        # One sale may be linked to several CRM cards. Count its income once per TG.
        db.execute('CREATE TEMP TABLE lost_partner_groups(partner_id TEXT,grp TEXT,PRIMARY KEY(partner_id,grp))')
        db.execute('INSERT OR IGNORE INTO lost_partner_groups SELECT m.partner_id,e.grp FROM lost_pairs e JOIN partner_mapping m ON m.ref=e.ref')
        financial=[dict(r) for r in db.execute('''WITH unique_facts AS (
            SELECT f.file_id,f.source_row,f.grp,f.month,f.income FROM lost_pairs e
            CROSS JOIN mapping m ON m.ref=e.ref CROSS JOIN facts f ON f.source_name=m.source_name AND f.grp=e.grp
            WHERE f.month>=? AND f.month<=?
            UNION
            SELECT f.file_id,f.source_row,f.grp,f.month,f.income FROM (SELECT DISTINCT partner_id FROM lost_partner_groups) p
            CROSS JOIN partner_data.links l ON l.partner_id=p.partner_id
            CROSS JOIN facts f ON f.file_id=l.file_id AND f.source_row=l.source_row
            CROSS JOIN lost_partner_groups e ON e.partner_id=p.partner_id AND e.grp=f.grp
            WHERE f.month>=? AND f.month<=?
        ) SELECT grp name,SUM(CASE WHEN month<? THEN income ELSE 0 END) priorIncome,
            SUM(CASE WHEN month>=? THEN income ELSE 0 END) currentIncome FROM unique_facts GROUP BY grp''',(prior_start,end,prior_start,end,start,start))]
        for r in financial:r['incomeDecline']=r['priorIncome']-r['currentIncome']
        return dict(fromMonth=start,toMonth=end,priorFromMonth=prior_start,priorToMonth=prior_end,lostIncomeByGroup=financial,refs=result)

def compact(data):
    # Node only needs classification, not all monetary columns for every KA/TG.
    for roles in data['refs'].values():
        for h in roles.values():
            h['groups']=[{k:g[k] for k in ('name','status','last','recommendationEarlier','incomeDeclined','priorTurnover','turnover')} for g in h['groups']]
    return data

if __name__=='__main__':
    try:print(json.dumps(dict(success=True,data=compact(summarize(json.load(sys.stdin)['refs']))),ensure_ascii=False,separators=(',',':')))
    except Exception as e:print(json.dumps(dict(success=False,error=dict(message=str(e))),ensure_ascii=False));sys.exit(1)

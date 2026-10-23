"""Read-only sales extraction. One source name can belong to only one economic identity."""
import json,sys
from history_service import connect,MAX_MONTH,HIDDEN_GROUPS
refs=json.load(open(sys.argv[1],encoding='utf-8'))
with connect() as d:
 clusters={}
 for ref in refs:
  row=d.execute('SELECT * FROM identity_data.cards WHERE ref=?',(ref,)).fetchone()
  card=dict(row) if row else dict(ref=ref,status='missing',code1c='')
  key='code:'+card['code1c'] if card.get('code1c') else 'ref:'+ref
  c=clusters.setdefault(key,dict(key=key,cards=[],names=set(),known=True))
  c['cards'].append(card)
  c['known']=c['known'] and card.get('status') in ['matched','no_history']
  c['names'].update(r[0] for r in d.execute('SELECT source_name FROM mapping WHERE ref=?',(ref,)))
 owners={}
 for k,c in clusters.items():
  for n in c['names']:owners.setdefault(n,[]).append(k)
 collisions={n:ks for n,ks in owners.items() if len(ks)>1}
 d.execute('CREATE TEMP TABLE analytical_sources(key TEXT,source_name TEXT UNIQUE)')
 for k,c in clusters.items():
  if any(n in collisions for n in c['names']):c['known']=False
  if c['known']:d.executemany('INSERT INTO analytical_sources VALUES(?,?)',[(k,n) for n in c['names']])
  c['names']=sorted(c['names'])
 rows=d.execute("""SELECT s.key,f.grp,f.date,SUM(f.amount),SUM(f.income),
 MAX(CASE WHEN f.kind!='returns' AND f.amount>0 THEN 1 ELSE 0 END)
 FROM facts f JOIN analytical_sources s ON s.source_name=f.source_name
 WHERE f.month<=? GROUP BY s.key,f.grp,f.date""",(MAX_MONTH,)).fetchall()
 files=d.execute('SELECT month,count(DISTINCT kind),count(*) FROM files WHERE month<=? GROUP BY month',(MAX_MONTH,)).fetchall()
 assert files and all(r[1]==3 for r in files),'Incomplete sales months'
 result=dict(clusters=list(clusters.values()),daily=dict(rows=[list(r) for r in rows],files=[list(r) for r in files]),
  groups=[r[0] for r in d.execute('SELECT name FROM groups ORDER BY name') if r[0] not in HIDDEN_GROUPS],
  collisions=collisions,maxMonth=MAX_MONTH)
 json.dump(result,open(sys.argv[2],'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))

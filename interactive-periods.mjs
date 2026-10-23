export const defaults=['2025-10-01','2026-09-30','2024-10-01','2025-09-30'];
// Input contains only identities permitted by the existing OAuth data endpoint.
// Select units by eligible passports, but never truncate their purchases by farmer.
export function economicUnits(data,selected){
 const byKey=new Map(data.clients.map(c=>[c.key,c])),sets=new Map(),owners=new Map();
 for(const c of data.clients){
  const keys=[...new Set([c.key,...c.groupKeys])].sort(),id=JSON.stringify(keys);
  for(const key of keys){if(owners.has(key)&&owners.get(key)!==id)throw Error('Несогласованный состав группы: '+key);owners.set(key,id);}
  sets.set(c.key,keys);
 }
 const result=new Map();
 for(const seed of selected){
  const keys=sets.get(seed.key),key='unit:'+JSON.stringify(keys);if(result.has(key))continue;
  const members=keys.map(k=>byKey.get(k)).filter(Boolean);
  const union=f=>[...new Set(members.flatMap(m=>m[f]||[]))];
  const heads=union('groupHeads'),head=members.find(m=>m.refs.some(ref=>heads.includes(ref)))||members[0];
  const known=members.length===keys.length&&members.every(m=>m.known&&Number.isSafeInteger(m.lifetimeTotal)&&!m.rows.some(r=>r.groupUnknown));
  const total=members.reduce((n,m)=>n+m.periodTotal,0);
  const questions=members.flatMap(m=>m.questions.map(q=>({...q,label:m.name+' — '+q.label,sourceKey:m.key})));
  const rows=[...new Set(members.flatMap(m=>m.rows.map(r=>r.tg)))].map(tg=>{
   const parts=members.map(m=>({m,r:m.rows.find(r=>r.tg===tg)})).filter(x=>x.r);
   const sum=f=>parts.reduce((n,x)=>n+(x.r[f]||0),0);
   const expectedParts=parts.filter(x=>x.m.inBase&&x.m.passportFilled&&x.r.expected);
   const expected=expectedParts.length>0,buying=parts.some(x=>x.r.buying),lifetime=sum('lifetime');
   const significant=total>0&&sum('current')*100>=total*2;
   const gap=known&&expected&&!significant;
   const basis=expectedParts.flatMap(({m,r})=>r.basis.map(b=>({...b,question:m.name+' — '+b.question,sourceKey:m.key})));
   const last=parts.map(x=>x.r.last||'').sort().at(-1)||'';
   const buyers=parts.filter(x=>x.r.buying).map(x=>x.m.key);
   return {tg,current:sum('current'),prior:sum('prior'),currentIncome:sum('currentIncome'),priorIncome:sum('priorIncome'),
    decline:known?Math.max(0,sum('priorIncome')-sum('currentIncome')):null,turnoverDecline:known?sum('prior')-sum('current'):null,
    lifetime,buying,expected,gap,basis,last,status:!known?'unknown':significant?'buying':last&&!significant?'low_share':last?'earlier':'never',
    groupUnknown:!known,groupBuys:keys.length>1?buyers:[],buyerKeys:buyers,
    groupPurchase:{group:keys.length>1,known,total,turnover:sum('current'),buying,share:total>0?sum('current')*100/total:0,gap:known&&!significant},
    partner:null};
  });
  result.set(key,{...head,key,name:keys.length>1?'Группа: '+head.name:head.name,known,rows,questions,
   refs:union('refs'),farmers:union('farmers'),farmerIds:union('farmerIds'),segments:union('segments'),
   groupKeys:keys,memberKeys:keys,groupHeads:heads,isUnit:true,periodTotal:total,lifetimeTotal:members.reduce((n,m)=>n+m.lifetimeTotal,0)});
 }
 return [...result.values()];
}
export function validateDates(values,daily){
 if(values.some(v=>!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))throw Error('Заполните все четыре даты корректно.');
 for(const [a,b] of [[values[0],values[1]],[values[2],values[3]]]){
  if(a>b)throw Error('Начало каждого периода должно быть не позже окончания.');
  if(a<'2023-01-01'||b>'2026-09-30')throw Error('Доступны полные данные с 01.01.2023 по 30.09.2026. За пределами этого диапазона расчёт невозможен.');
  for(let m=a.slice(0,7);m<=b.slice(0,7);){const file=daily.files.find(x=>x[0]===m);if(!file||file[1]!==3||file[2]!==3)throw Error('Неполные исходные файлы за '+m);const [y,n]=m.split('-').map(Number);m=n===12?(y+1)+'-01':y+'-'+String(n+1).padStart(2,'0');}
 }
}
export function calculatePeriods(data,daily,values){
 validateDates(values,daily);const [a,b,p,q]=values,agg=new Map(),periodTotals=new Map();
 for(const [key,tg,date,amount,income,buying] of daily.rows){
  const k=key+'|'+tg;let r=agg.get(k);if(!r){r={current:0,prior:0,currentIncome:0,priorIncome:0,last:'',past:0,buying:0};agg.set(k,r);}
  if(date>=a&&date<=b){periodTotals.set(key,(periodTotals.get(key)||0)+amount);r.current+=amount;r.currentIncome+=income;r.buying ||= buying;}
  if(date>=p&&date<=q){r.prior+=amount;r.priorIncome+=income;}
  if(date<a&&buying)r.past=1;
  if(date<=b&&buying&&date>r.last)r.last=date;
 }
 for(const c of data.clients)c.periodTotal=periodTotals.get(c.key)||0;
 for(const c of data.clients)for(const r of c.rows){const x=agg.get(c.key+'|'+r.tg)||{current:0,prior:0,currentIncome:0,priorIncome:0,last:'',past:0,buying:0};Object.assign(r,x);r.decline=c.known?Math.max(0,r.priorIncome-r.currentIncome):null;r.turnoverDecline=c.known?r.prior-r.current:null;const significant=c.periodTotal>0&&r.current*100>=c.periodTotal*2;r.status=!c.known?'unknown':significant?'buying':r.last&&!significant?'low_share':r.last?'earlier':'never';r.gap=!!(c.known&&r.expected&&r.status!=='buying');}
 const byKey=new Map(data.clients.map(c=>[c.key,c]));for(const c of data.clients)for(const r of c.rows){r.groupBuys=[...new Set(c.groupKeys)].filter(k=>k!==c.key&&byKey.get(k)?.rows.some(x=>x.tg===r.tg&&x.buying));}
}

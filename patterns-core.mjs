import {defaults,calculatePeriods,economicUnits} from './interactive-periods.mjs';
import {mergeBoilers} from './report-boilers.mjs';
import {potential} from './potential-math.mjs';
// Input is restricted by the same OAuth loader as the interactive report.
export function calculatePatterns(data,reference,department=0){
 const {weights,margins}=structuredClone(reference);
 mergeBoilers(data,data.daily,weights,margins);
 calculatePeriods(data,data.daily,defaults);
 const departments=data.departments,ids=new Set([Number(department)]);
 if(department&&!departments.some(d=>Number(d.id)===Number(department)))throw Object.assign(Error('Неизвестный отдел'),{status:400});
 if(department)for(let changed=true;changed;){changed=false;for(const d of departments)if(ids.has(Number(d.parentId))&&!ids.has(Number(d.id))){ids.add(Number(d.id));changed=true;}}
 const farmers=new Set(data.users.filter(u=>!department||u.departments.some(id=>ids.has(Number(id)))).map(u=>Number(u.id)));
 const selected=data.clients.filter(c=>c.inBase&&c.passportFilled&&c.farmerIds.some(id=>farmers.has(Number(id))));
 const units=economicUnits(data,selected),byKey=new Map(data.clients.map(c=>[c.key,c]));
 const maps={earlier:new Map(),gaps:new Map()};
 const clients=units.map(u=>({key:u.key,name:u.name,farmer:u.farmers.join(', '),
  members:u.memberKeys.map(k=>byKey.get(k)).sort((a,b)=>Number(b.refs.some(r=>u.groupHeads.includes(r)))-Number(a.refs.some(r=>u.groupHeads.includes(r)))).flatMap(c=>c.cards.map(card=>({name:card.name||c.name,ref:card.ref,head:u.groupHeads.includes(card.ref)})))}));
 for(const u of units)for(const r of u.rows){
  for(const kind of ['earlier','gaps']){
   if(kind==='earlier'?!(r.decline>0):!r.gap)continue;
   const map=maps[kind];
   if(!map.has(r.tg))map.set(r.tg,{name:r.tg,keys:[],priorIncome:0,currentIncome:0,incomeDecline:0,potentialIncome:0,potentialTurnover:0,turnoverByKey:{}});
   const row=map.get(r.tg);row.keys.push(u.key);
   row.priorIncome+=r.priorIncome;row.currentIncome+=r.currentIncome;row.incomeDecline+=r.decline||0;
   row.turnoverByKey[u.key]={prior:r.prior,current:r.current,decline:r.prior-r.current};
   if(kind==='gaps'){const p=potential(u.periodTotal,r.current,weights[r.tg],margins[r.tg]);row.potentialIncome+=p.income||0;row.potentialTurnover+=p.extra||0;}
  }
 }
 const all=[...new Set(data.summary.map(r=>r.tg))].sort((a,b)=>a.localeCompare(b,'ru'));
 const output={};
 for(const kind of ['earlier','gaps']){
  const rows=[...maps[kind].values()],metric=kind==='earlier'?'incomeDecline':'potentialIncome';
  rows.sort((a,b)=>b[metric]-a[metric]||a.name.localeCompare(b.name,'ru'));
  output[kind]=[...rows,...all.filter(n=>!maps[kind].has(n)).map(name=>({name,keys:[],noPattern:true}))];
 }
 return {...output,clients,departments,department,clientCount:units.length,
  periodLabel:defaults[0]+' — '+defaults[1],priorPeriodLabel:defaults[2]+' — '+defaults[3],
  note:'Потенциальный дополнительный оборот и доход рассчитан на основании среднестатистической доли оборота и дохода ТГ в среднестатистических счетах. Является оценочной величиной.'};
}

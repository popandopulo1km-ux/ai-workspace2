export function mergeBoilers(data,daily,weights,margins){
 const canonical=tg=>tg==='Бойлеры бытовые'?'Бойлеры':tg;
 for(const row of daily.rows)row[1]=canonical(row[1]);
 for(const c of data.clients){
  const parts=c.rows.filter(r=>canonical(r.tg)==='Бойлеры');
  if(parts.length){
   const r={...parts[0],tg:'Бойлеры'};
   for(const f of ['current','prior','currentIncome','priorIncome','lifetime'])r[f]=parts.reduce((n,x)=>n+(x[f]||0),0);
   for(const f of ['expected','buying','past','groupUnknown'])r[f]=parts.some(x=>x[f]);
   r.negativeOnly=parts.every(x=>x.negativeOnly);
   r.basis=parts.flatMap(x=>x.basis||[]);
   r.groupBuys=[...new Set(parts.flatMap(x=>x.groupBuys||[]))];
   r.last=parts.map(x=>x.last||'').sort().at(-1);
   r.partner=null;
   c.rows=c.rows.filter(x=>canonical(x.tg)!=='Бойлеры');c.rows.push(r);
  }
  for(const q of c.questions)q.groups=[...new Set(q.groups.map(canonical))];
 }
 if(data.summary)data.summary=data.summary.filter(x=>x.tg!=='Бойлеры бытовые');
 if(Object.hasOwn(weights,'Бойлеры бытовые')){
  weights['Бойлеры']=(weights['Бойлеры']||0)+weights['Бойлеры бытовые'];
  delete weights['Бойлеры бытовые'];
 }
 if(margins['Бойлеры бытовые']){
  const a=margins['Бойлеры']||{},b=margins['Бойлеры бытовые'];
  margins['Бойлеры']={turnover:(a.turnover||0)+b.turnover,income:(a.income||0)+b.income};
  delete margins['Бойлеры бытовые'];
 }
}

// Only an unambiguous whole-answer denial suppresses a need. Do not infer a
// denial from arbitrary prose or cancel a separately selected positive brand.
export function isNegativePurchaseAnswer(a){
 if(a?.value===false)return true;
 if(a?.brands?.length||a?.value===true||!a?.other)return false;
 const text=String(a.text||'').normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[.!?;]+$/g,'').replace(/\s+/g,' ').trim();
 return /^(?:не использует|не используют|не применяет|не применяют|не покупает|не покупают)(?: в монтаже| в работе)?$/.test(text)
  || /^ne ispol['’]?zuet$/.test(text)
  || /^монтажник ремонтирует,? не покупает$/.test(text);
}
export function comparePurchases(snapshot,mapping,history,activeIds){
 const expected=new Map(),unresolved=[];
 if(snapshot.isInstaller===false)activeIds=[];
 const canonical=g=>g==='Бойлеры бытовые'?'Бойлеры':g;
 const grouped=new Map();
 for(const row of history.groups){
  const name=canonical(row.name),old=grouped.get(name);
  if(!old)grouped.set(name,{...row,name});
  else for(const key of ['sales','returns','income','pastSales','pastReturns','pastIncome','lifetimeTurnover'])old[key]=(old[key]||0)+(row[key]||0);
 }
 const periodTotal=history.periodTurnover;
 const purchaseRows=[...grouped.values()].map(r=>{
  if(!Number.isFinite(periodTotal))return r;
  const amount=Number(r.sales||0)+Number(r.returns||0),bought=periodTotal>0&&amount*100>=periodTotal*2;
  const status=!history.known?'unknown':bought?'buying':amount!==0?'low_share':r.pastSales>0?'earlier':r.hasMovement?'returns':'never';
  return {...r,status,turnoverShare:periodTotal>0?amount*100/periodTotal:null};
 });
 for(const r of mapping.rows){
  const a=snapshot.answers?.[r.id];if(!activeIds.includes(r.id)||!a?.enabled||r.status==='not-product')continue;
  if(!(a.brands?.length||(a.other&&String(a.text||'').trim())||typeof a.value==='boolean'))continue;
  if(isNegativePurchaseAnswer(a))continue;
  if(r.status!=='mapped'){unresolved.push({id:r.id,label:r.label,note:r.note});continue;}
  for(const raw of r.groups){const g=canonical(raw);if(mapping.summary.hidden.includes(g))continue;const row=expected.get(g)||{name:g,reasons:[]};row.reasons.push({question:r.label,answer:a.brands?.join(', ')||a.text||'Да'});expected.set(g,row);}
 }
 const rows=[...expected.values()].map(r=>({...r,...(purchaseRows.find(g=>g.name===r.name)||{status:'unknown'}),status:history.known?(purchaseRows.find(g=>g.name===r.name)?.status||'unknown'):'unknown'}));
 for(const r of rows.filter(r=>r.status==='unknown'))unresolved.push({id:r.name,label:r.name,note:'Нет подтверждённых данных истории по этой ТГ. Отсутствие покупок не утверждается.'});
 return {expected:rows,gaps:rows.filter(r=>['earlier','low_share','never','returns'].includes(r.status)),earlier:history.known?history.groups.filter(g=>(g.recommendationEarlier??(g.status==='earlier'))&&!mapping.summary.hidden.includes(g.name)):[],unresolved,known:history.known};
}

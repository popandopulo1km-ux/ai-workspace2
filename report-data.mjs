import {readFile} from 'node:fs/promises';
import {currentGroups} from './current-groups.mjs';
export async function allowedData(vibe,auth){
  // One atomic bundle keeps current passports and their deduplicated sales identities together.
  // Never cache this snapshot forever: daily publication must become visible without restart.
  const snapshot=JSON.parse(await readFile(new URL('./data/report-snapshot/current.json',import.meta.url),'utf8'));
  const original=snapshot.data,allowed=new Set(),heads=new Map();
  for(const [resource,type] of [['companies','CO'],['contacts','C']]){
   const ids=[...new Set(original.clients.flatMap(c=>c.refs).filter(r=>r.startsWith(type+'_')).map(r=>Number(r.split('_')[1])))];
   for(let i=0;i<ids.length;i+=400){const b=await vibe('/v1/'+resource+'/search',auth,{method:'POST',body:JSON.stringify({filter:{id:ids.slice(i,i+400)},select:['id','ufCrmWmPassportHead'],limit:5000,sort:'id'})});const rows=Array.isArray(b.data)?b.data:b.data?.items;if(!Array.isArray(rows)||b.meta?.hasMore||b.meta?.truncated)throw Error('Не удалось полностью проверить доступ к карточкам');rows.forEach(r=>{const ref=type+'_'+r.id;allowed.add(ref);heads.set(ref,String(r.ufCrmWmPassportHead||''));});}
  }
  currentGroups(original,heads);
  const clients=original.clients.filter(c=>c.refs.every(r=>allowed.has(r))),keys=new Set(clients.map(c=>c.key));
  for(const c of clients){const hiddenMember=c.groupKeys.some(k=>!keys.has(k));c.groupKeys=c.groupKeys.filter(k=>keys.has(k));for(const r of c.rows){const hidden=r.groupBuys.some(k=>!keys.has(k));r.groupBuys=r.groupBuys.filter(k=>keys.has(k));r.groupUnknown=r.groupUnknown||hidden||hiddenMember;}}
  const daily=snapshot.daily;
  return {clients,daily:{files:daily.files,rows:daily.rows.filter(r=>keys.has(r[0]))},summary:original.summary.map(s=>({tg:s.tg})),users:original.users.filter(u=>clients.some(c=>c.farmerIds.includes(u.id))),departments:original.departments,comments:Object.fromEntries(Object.entries(original.comments).filter(([ref])=>allowed.has(ref)))};
 }
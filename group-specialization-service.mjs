import {createHash,randomUUID} from 'node:crypto';
import {detailEnvelope,readExtended,serializeDetail,migrateObjects} from './extended-info-service.mjs';

export const specializationFields=Object.fromEntries(['objects','works','contours','systems','elements','elementTypes'].map(k=>[k,'ufCrmWmPassport'+k[0].toUpperCase()+k.slice(1)]));
const headField='ufCrmWmPassportHead';
const ref=(type,id)=>{if(!['company','contact'].includes(type)||!Number.isSafeInteger(Number(id))||Number(id)<=0)throw Error('Некорректный контрагент');return (type==='company'?'CO_':'C_')+Number(id);};
const fail=message=>Object.assign(Error(message),{status:409});
const list=x=>{if(Array.isArray(x))return x.filter(v=>typeof v==='string');try{const a=JSON.parse(x||'[]');return Array.isArray(a)?a.filter(v=>typeof v==='string'):[];}catch{return String(x||'').split('|').filter(Boolean);}};
const structure=card=>Object.fromEntries(Object.values(specializationFields).map(k=>[k,card[k]??'']));
const digest=card=>createHash('sha256').update(JSON.stringify({...structure(card),[headField]:card[headField]||''})).digest('hex');
const owner=auth=>createHash('sha256').update(String(auth)).digest('hex');
export function specializationFilled(card){
 const d=detailEnvelope(card[specializationFields.elementTypes]);
 return ['objects','works','contours','systems','elements'].some(k=>list(card[specializationFields[k]]).length)||['items','productGroups','finalItems'].some(k=>list(d[k]).length)||Object.values(d.extendedInfo?.answers||{}).some(a=>a?.enabled);
}
export function replacement(source){
 const d=detailEnvelope(source[specializationFields.elementTypes]),s=Object.fromEntries(['objects','works','contours','systems','elements'].map(k=>[k,list(source[specializationFields[k]])]));
 s.objects=migrateObjects(s.objects);s.elementTypes=list(d.items);s.productGroups=list(d.productGroups);s.finalItems=list(d.finalItems);
 const info=readExtended(source[specializationFields.elementTypes],s),active=new Set(info.activeQuestionIds);
 const answers=Object.fromEntries(Object.entries(info.answers).filter(([id])=>active.has(id)));
 // Construct a new structural envelope, never spread arbitrary source/target CRM fields.
 const detail=serializeDetail('',s,d.brandNotes||{},{answers,revision:readExtended('',s).revision});
 return {...Object.fromEntries(['objects','works','contours','systems','elements'].map(k=>[specializationFields[k],JSON.stringify(s[k])])),[specializationFields.elementTypes]:detail};
}

// Storage and authorization are injected. The browser never supplies field values or membership.
export function createGroupSpecializationService({read,relationship,write,audit,recordFill=async()=>{}}){
 const plans=new Map();let queue=Promise.resolve();
 async function preview(type,id,auth){
  for(const [token,p]of plans)if(p.expires<Date.now())plans.delete(token);
  const key=ref(type,id),relation=await relationship(type,id,auth),source=await read(type,id,auth);
  if(relation.role!=='head'||source[headField]!==key)throw fail('Перенос доступен только сохранённому головному контрагенту.');
  if(!specializationFilled(source))throw fail('Чтобы применить специализацию к участникам группы, заполните и сохраните паспорт головного контрагента.');
  const patch=replacement(source),members=[];
  for(const m of relation.members||[]){
   if(ref(m.type,m.id)===key||members.some(x=>x.reference===ref(m.type,m.id)))continue;
   const c=await read(m.type,m.id,auth);
   if(c[headField]!==key)throw fail('Состав группы изменился. Повторите операцию.');
   members.push({...m,reference:ref(m.type,m.id),filled:!!specializationFilled(c),revision:digest(c)});
  }
  if(!members.length)throw fail('У головного контрагента нет участников группы.');
  const token=randomUUID();plans.set(token,{owner:owner(auth),type,id,key,sourceRevision:digest(source),patch,members,expires:Date.now()+30*60*1000,done:new Map()});
  return {token,members:members.map(({revision,...m})=>m)};
 }
 async function apply(input,auth){
  const previous=queue;let release;queue=new Promise(r=>release=r);await previous;
  try{
   const p=plans.get(input.token);
   if(!p||p.owner!==owner(auth)||p.expires<Date.now())throw fail('Проверка устарела. Повторите перенос из головного паспорта.');
   const m=p.members.find(m=>m.reference===input.reference);if(!m)throw fail('Участник не входит в проверенную группу.');
   if(p.done.has(m.reference))return p.done.get(m.reference);
   if(m.filled&&input.replace!==true)throw fail('Замена заполненного паспорта не подтверждена.');
   const source=await read(p.type,p.id,auth);
   if(digest(source)!==p.sourceRevision||source[headField]!==p.key)throw fail('Головной паспорт изменился. Повторите перенос.');
   const before=await read(m.type,m.id,auth);
   if(before[headField]!==p.key)throw fail('Участник больше не относится к этой группе. Перенос отменён.');
   if(digest(before)!==m.revision)throw fail('Паспорт участника изменился. Повторите проверку перед заменой.');
   await audit({operation:input.token,source:p.key,target:m.reference,before:structure(before),after:p.patch});
   await write(m.type,m.id,p.patch,auth);
   const after=await read(m.type,m.id,auth);
   if(Object.entries(p.patch).some(([k,v])=>String(after[k]??'')!==v))throw fail('Не удалось подтвердить сохранение всех параметров. Обновите паспорт участника перед повторной попыткой.');
   const result={reference:m.reference,name:m.name,applied:true};p.done.set(m.reference,result);
   if(after[headField]!==p.key)result.warning='Специализация сохранена, но параллельно изменена связь группы. Проверьте карточку.';
   try{await recordFill(m.type,m.id,auth);}catch{result.warning='Специализация сохранена; статистика заполнений требует проверки.';}
   return result;
  }finally{release();}
 }
 return {preview,apply};
}

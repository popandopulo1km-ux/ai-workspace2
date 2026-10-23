export const headField = 'ufCrmWmPassportHead';
const resources={company:'companies',contact:'contacts'};
const fail=message=>Object.assign(new Error(message),{status:409,code:'HEAD_RELATION_INVALID'});
export function reference(type,id){if(!resources[type]||!Number.isSafeInteger(Number(id))||Number(id)<=0)throw fail('Не определён контрагент.');return `${type==='company'?'CO':'C'}_${Number(id)}`;}
export function parseReference(value){const m=String(value||'').match(/^(CO|C)_([1-9]\d*)$/);return m?{type:m[1]==='CO'?'company':'contact',id:Number(m[2])}:null;}
export function createParentService({vibe,portalBase}){
 const data=b=>b.data||b; const rows=b=>Array.isArray(b.data)?b.data:[];
 const names=type=>type==='company'?['title']:['name','lastName','secondName'];
 const select=type=>['id',...names(type),'phone',headField];
 const phones=c=>{const out=[];function visit(x){if(typeof x==='string'){if(x.replace(/\D/g,'').length>=3)out.push(x);}else if(Array.isArray(x))x.forEach(visit);else if(x&&typeof x==='object')Object.values(x).forEach(visit);}visit(c.phone);return [...new Set(out)];};
 const view=(type,c)=>({type,id:Number(c.id),name:type==='company'?c.title:[c.lastName,c.name,c.secondName].filter(Boolean).join(' '),phone:phones(c).join(', '),url:`${portalBase}/crm/${type}/details/${Number(c.id)}/`,reference:reference(type,c.id)});
 async function read(type,id,auth){reference(type,id);return data(await vibe(`/v1/${resources[type]}/${id}?select=${select(type).join(',')}`,auth));}
 async function members(type,id,auth){
  const key=reference(type,id); const out=[];
  for(const kind of ['company','contact']){
   let offset=0;
   while(true){const b=await vibe(`/v1/${resources[kind]}/search`,auth,{method:'POST',body:JSON.stringify({filter:{[headField]:key},select:select(kind),limit:100,offset,sort:'id',autoWindow:false})});
    const page=rows(b);out.push(...page.filter(c=>reference(kind,c.id)!==key).map(c=>view(kind,c)));
    if(page.length<100&& !b.meta?.hasMore)break;
    if(!page.length)throw fail('Не удалось полностью прочитать участников группы.');
    offset+=page.length;if(offset>10000)throw fail('Слишком большая группа: изменение связи остановлено.');
   }
  }return out;
 }
 async function load(type,id,auth){const c=await read(type,id,auth),self=view(type,c),raw=String(c[headField]||'');
  const ref=parseReference(raw);const role=!raw?null:raw===self.reference?'head':'member';
  let head=null,error=null;
  if(ref){try{head=view(ref.type,await read(ref.type,ref.id,auth));}catch{error='Головная карточка недоступна. Проверьте права или выберите другого головного.';}}
  else if(raw)error='Связь записана в неизвестном формате. Выберите головного заново.';
  return {role,head,self,original:raw,members:await members(type,id,auth),error};
 }
 async function search(type,id,q,auth){
  const query=String(q||'').trim().slice(0,100);if(!query)return [];
  await read(type,id,auth);
  const fold=s=>String(s).toLocaleLowerCase('ru').replaceAll('ё','е');const tokens=fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean);const probe=[...tokens].sort((a,b)=>b.length-a.length)[0]||query;
  const numberQuery=query.replace(/^инн\s*/i,'');const numeric=/^[#\d\s()+.\-]+$/.test(numberQuery),digits=numberQuery.replace(/\D/g,'');
  const compact=s=>fold(s).replace(/[^\p{L}\p{N}]/gu,'');const rank=x=>{const name=compact(x.name).replace(/^(ооо|ао|оао|ип)/,'');const at=name.indexOf(compact(query));return at<0?100:at;};const compare=(a,b)=>rank(a)-rank(b)||a.name.localeCompare(b.name,'ru');
  const phoneKey=s=>{const d=String(s).replace(/\D/g,'');return d.length===11&&/^[78]/.test(d)?d.slice(1):d;};
  const innOwners=new Map();
  let exactPhones={};
  if(numeric&&[10,11].includes(digits.length)){
   const local=phoneKey(digits),values=[...new Set([digits,...(local.length===10?['+7'+local,'7'+local,'8'+local]:[])])];
   const found=await vibe('/v1/duplicates/find',auth,{method:'POST',body:JSON.stringify({type:'phone',values})});exactPhones=Array.isArray(found.data)?{}:(found.data||{});
  }
  if(numeric&&digits){
   const req=await vibe('/v1/requisites/search',auth,{method:'POST',body:JSON.stringify({filter:{rqInn:{$contains:digits},active:true},select:['id','entityTypeId','entityId','rqInn'],limit:100,autoWindow:false})});
   for(const r of rows(req)){const kind=Number(r.entityTypeId)===4?'company':Number(r.entityTypeId)===3?'contact':null;if(kind)innOwners.set(reference(kind,r.entityId),String(r.rqInn||''));}
  }
  const batches=await Promise.all(['company','contact'].map(async kind=>{
   const tail=digits.slice(-4),variants=[...new Set([tail,...(tail.length===4?[tail.slice(0,2)+'-'+tail.slice(2),tail.slice(0,2)+' '+tail.slice(2)]:[])])];
   const filters=numeric?variants.filter(Boolean).map(p=>({phone:{$contains:p}})):names(kind).map(n=>({[n]:{$contains:probe}}));
   const ownerIds=[...innOwners.keys()].map(parseReference).filter(r=>r.type===kind).map(r=>r.id);
   ownerIds.push(...(exactPhones[kind]||[]).map(Number));
   if(ownerIds.length)filters.push({id:{$in:ownerIds}});
   if(numeric&&/^#?\d{1,9}$/.test(query))filters.push({id:Number(digits)});
   const answers=await Promise.all(filters.map(filter=>vibe(`/v1/${resources[kind]}/search`,auth,{method:'POST',body:JSON.stringify({filter,select:select(kind),sort:'id',limit:200,autoWindow:false})})));
   return [...new Map(answers.flatMap(rows).map(c=>[Number(c.id),c])).values()].map(c=>{
    const item=view(kind,c),raw=String(c[headField]||''),self=item.reference===reference(type,id),isMember=!!raw&&raw!==item.reference;
    return {...item,inn:innOwners.get(item.reference)||'',matchesPhone:phones(c).some(p=>{const raw=p.replace(/\D/g,''),local=phoneKey(p);return [raw,local,...(local.length===10?['7'+local,'8'+local]:[])].some(x=>x.includes(digits));}),role:raw===item.reference?'head':raw?'member':null,selectable:!self&&!isMember,reason:self?'Это текущая карточка. Её нельзя выбрать головной для самой себя в режиме участника.':isMember?'Участник другой группы. Цепочки не допускаются.':''};
   }).filter(c=>numeric?(c.inn||c.matchesPhone||(/^#?\d{1,9}$/.test(query)&&c.id===Number(digits))):tokens.every(t=>fold(c.name).includes(t))).sort(compare).slice(0,25);
  }));return batches.flat().sort(compare);
 }
 // Serialize relationship-bearing saves across both entity types to avoid A→B / B→A races.
 let pending=Promise.resolve();
 async function withSave(type,id,input,auth,write){
  let release;const previous=pending;pending=new Promise(r=>{release=r;});await previous;
  try{
   const c=await read(type,id,auth),self=reference(type,id),raw=String(c[headField]||'');
   if(!input||![null,'head','member'].includes(input.role))throw fail('Некорректная роль. Обновите паспорт.');
   if(typeof input.original!=='string'||input.original!==raw)throw fail('Связь изменена другим сотрудником. Обновите паспорт перед сохранением.');
   let next=input.role==='head'?self:'',initialized=null;
   if(input.role!=='head'&&(await members(type,id,auth)).length)throw fail('Сначала назначьте другого головного всем участникам этой карточки.');
   if(input.role==='member'){
    if(!input.head)throw fail('Выберите головного контрагента из поиска.');
    next=reference(input.head.type,input.head.id);
    if(next===self)throw fail('Участник не может ссылаться на себя.');
    const h=await read(input.head.type,input.head.id,auth);
    if(h[headField]&&String(h[headField])!==next)throw fail('Выбранная карточка уже является участником другой группы. Цепочки не допускаются.');
    if(!h[headField])initialized={type:input.head.type,id:Number(input.head.id),reference:next};
   }
   // Selecting a standalone card makes it the root on Save, not during search/selection.
   let result;
   try{
    if(initialized){await vibe(`/v1/${resources[initialized.type]}/${initialized.id}`,auth,{method:'PATCH',body:JSON.stringify({[headField]:initialized.reference})});if(String((await read(initialized.type,initialized.id,auth))[headField]||'')!==next)throw fail('Не удалось назначить выбранную карточку головной.');}
    result=await write({[headField]:next});
   }catch(error){
    // Do not leave an orphan root after a failed source save or undo an actual completed link.
    if(initialized){try{const target=await read(initialized.type,initialized.id,auth);if(String(target[headField]||'')===initialized.reference&&!(await members(initialized.type,initialized.id,auth)).length)await vibe(`/v1/${resources[initialized.type]}/${initialized.id}`,auth,{method:'PATCH',body:JSON.stringify({[headField]:''})});}catch{throw fail('Сохранение не завершено. Не удалось отменить назначение головной карточки — обновите обе карточки для проверки.');}}
    throw error;
   }
   const after=await read(type,id,auth);if(String(after[headField]||'')!==next)throw fail('Bitrix24 не подтвердил сохранение головной связи. Обновите данные для проверки.');
   return {...result,relationship:await load(type,id,auth)};
  }finally{release();}
 }
 return {load,search,withSave};
}

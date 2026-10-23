import {lastPassportEdit} from './passport-integrity.mjs';
import {hasClassificationPassport} from './passport-completion.mjs';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export function passportRevision(card,fields){return createHash('sha256').update(JSON.stringify(Object.values(fields).map(f=>card?.[f]??null))).digest('hex');}
export function assertPassportVersion(card,fields,input,update){
 if(input?.baseRevision!==passportRevision(card,fields))throw Object.assign(new Error('Паспорт изменён после открытия или открыта старая версия. Обновите карточку перед сохранением. Ваш черновик сохранён.'),{status:409,code:'PASSPORT_STALE'});
 if(hasClassificationPassport(card,fields)&&!hasClassificationPassport(update,fields)&&input?.confirmEmptyPassport!==true)throw Object.assign(new Error('Подтвердите ручное удаление всех выбранных пунктов паспорта. Предыдущая версия будет сохранена.'),{status:409,code:'PASSPORT_EMPTY_OVERWRITE'});
}
const passportWriteLocks=new Map();
export async function withPassportWriteLock(ref,write){
 const previous=passportWriteLocks.get(ref)||Promise.resolve();
 const current=previous.catch(()=>{}).then(write);passportWriteLocks.set(ref,current);
 try{return await current;}finally{if(passportWriteLocks.get(ref)===current)passportWriteLocks.delete(ref);}
}
export async function archivePassport(kind,card,fields){
 if(!['companies','contacts'].includes(kind)||!Number.isSafeInteger(Number(card?.id)))throw new Error('Invalid passport archive identity');
 const dir=join(process.env.PASSPORT_VERSIONS_DIR||'/opt/app/data/passport-versions',kind+'-'+Number(card.id));
 await mkdir(dir,{recursive:true,mode:0o700});
 const revision=passportRevision(card,fields),data=Object.fromEntries(Object.values(fields).map(f=>[f,card[f]??null]));
 const payload={kind,id:Number(card.id),revision,at:new Date().toISOString(),data};
 const exclusive=async(path,value)=>{try{await writeFile(path,JSON.stringify(value),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}};
 await exclusive(join(dir,revision+'.json'),payload);
 if(hasClassificationPassport(card,fields))await exclusive(join(dir,'filled-'+revision+'.json'),payload);
 else if(Object.values(data).every(v=>v===null)){
  // A normal app reset writes JSON arrays, not six null values. Preserve evidence, never silently restore.
  const {readdir}=await import('node:fs/promises');
  if((await readdir(dir)).some(n=>n.startsWith('filled-')))await exclusive(join(dir,'unexpected-empty-'+revision+'.json'),{...payload,event:'unexpected-null-specialization'});
 }
}
// Contact passports use the contact's own fields; linked company totals are never inherited.
import { headField } from './parent-service.mjs';
import { createCompanyLinks } from './company-links.mjs';
import { readExtended, serializeDetail, migrateObjects } from './extended-info-service.mjs';
export const contactMetadata = {
  segment: 'ufCrm_1785825452', path: 'ufCrm_1785825531',
  farmer: 'ufCrm_1782369591', coreTail: 'ufCrm_1782358765',
};
export function createContactService({ vibe, fields, roleField, featureField, parseStored, parseDetailState, cleanSelection, resolveSegment, normalizePhones, phoneStatus, displayName, realization, salesPotential, passportState, recordFill }) {
  const links = createCompanyLinks({vibe});
  const value = body => body.data || body;
  const list = body => Array.isArray(body.data) ? body.data : [];
  const error = (message, status = 409) => Object.assign(new Error(message), { status });
  const linkedIds = contact => [...new Set([...(Array.isArray(contact.companyIds) ? contact.companyIds : []), contact.companyId].map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
  // The contacts endpoint exposes all phone values through the multi-field
  // `phone`; aliases such as phoneMobile/phoneWork are not valid select fields.
  const contactFields = ['id','name','lastName','secondName','post','phone','companyId','companyIds',roleField,headField,...Object.values(fields),...Object.values(contactMetadata),'ufCrmWelcmDealssum','ufCrmWelcmDealscount'];
  async function readContact(id, authorization) {
    const card=value(await vibe(`/v1/contacts/${id}?select=${contactFields.join(',')}`, authorization));
    await archivePassport('contacts',card,fields);
    return card;
  }
  const companyView = c => ({ id: Number(c.id), title: c.title || `Компания #${c.id}`, phone: normalizePhones(c).map(p => phoneStatus(p) === 'dummy' ? 'номер-пустышка!!!' : p).join(', '), feature: String(c[featureField] || '') });
  async function companiesFor(contact, authorization) {
    const ids = linkedIds(contact);
    if (!ids.length) return [];
    const response = await vibe('/v1/companies/search', authorization, {method:'POST',body:JSON.stringify({filter:{id:{$in:ids}},select:['id','title','phone','phoneMobile','phoneWork','phoneMailing',featureField],limit:ids.length})});
    return list(response).map(companyView);
  }
  async function aggregate(path, filter, field, authorization) {
    const result = value(await vibe(path, authorization, {method:'POST',body:JSON.stringify({filter,aggregate:[{field:'*',function:'count'},{field,function:'sum'}]})}));
    if(result.meta?.truncated) throw error('Расчёт показателей вернул неполные данные.',502);
    return {count:Number(result.count)||0,sum:Number(result.aggregates?.[field]?.sum)||0};
  }
  async function commercial(c, authorization) {
    const filter = {contactId:Number(c.id)};
    const out = {successfulRealizationsCount:Number(c.ufCrmWelcmDealscount)||0,successfulRealizationsSum:Number(c.ufCrmWelcmDealssum)||0,coreTail:String(c[contactMetadata.coreTail]||''),farmer:'не распределен'};
    await Promise.all([
      (async()=>{
        const [wholesale,corporate]=await Promise.all([
          aggregate('/v1/deals/aggregate',{...filter,categoryId:salesPotential.wholesaleCategoryId,stageSemanticId:'P'},'amount',authorization),
          aggregate(`/v1/items/${salesPotential.corporateEntityTypeId}/aggregate`,{...filter,stageId:salesPotential.corporateInProgressStageIds},'opportunity',authorization),
        ]);
        out.salesPotentialSum=Math.round((wholesale.sum+corporate.sum)*100)/100;
      })().catch(()=>{out.salesPotentialUnavailable=true;}),
      (async()=>{
        const active=await aggregate(`/v1/items/${realization.entityTypeId}/aggregate`,{...filter,stageId:realization.inProgressStageIds},'opportunity',authorization);
        out.inProgressRealizationsCount=active.count;out.inProgressRealizationsSum=active.sum;
        if(!active.count){
          const last=await vibe(`/v1/items/${realization.entityTypeId}/search`,authorization,{method:'POST',body:JSON.stringify({filter:{...filter,stageId:realization.successStageId},select:['id','movedTime'],sort:'-movedTime',limit:1,autoWindow:false,withTotal:false})});
          out.lastSuccessfulRealizationDate=list(last)[0]?.movedTime || null;
        }
      })().catch(()=>{out.realizationSummaryUnavailable=true;}),
      (async()=>{const id=Number(c[contactMetadata.farmer]);if(id>0)out.farmer=displayName(value(await vibe(`/v1/users/${id}?select=id,name,lastName,secondName`,authorization)))||'не распределен';})(),
    ]);
    return out;
  }
  function state(c) {
    const detail=parseDetailState(c[fields.elementTypes]);
    const selections=Object.fromEntries(Object.entries(fields).map(([key,field])=>[key==='works'?'workTypes':key,key==='elementTypes'?detail.elementTypes:parseStored(c[field])]));
    selections.productGroups=detail.productGroups;selections.finalItems=detail.finalItems;
    selections.objects=migrateObjects(selections.objects);
    return {baseRevision:passportRevision(c,fields),selections,extendedInfo:readExtended(c[fields.elementTypes],selections),hasSavedPassport:hasClassificationPassport(c,fields),progress:passportState(c)};
  }
  async function load(id, authorization, {core=false} = {}) {
    const c=await readContact(id,authorization);
    const pendingMetrics=core?(async()=>{
      const farmerId=Number(c[contactMetadata.farmer]);
      const farmer=farmerId>0?displayName(value(await vibe(`/v1/users/${farmerId}?select=id,name,lastName,secondName`,authorization).catch(()=>({data:{}}))))||'Временно недоступен':'не распределен';
      return {loading:true,farmer,coreTail:String(c[contactMetadata.coreTail]||''),historyUnavailable:true,salesPotentialUnavailable:true,realizationSummaryUnavailable:true};
    })():commercial(c,authorization);
    const [companies,metrics]=await Promise.all([companiesFor(c,authorization),pendingMetrics]);
    return {lastEdit:await lastPassportEdit('contacts',id),contact:{id:Number(c.id),name:displayName(c)||`Контакт #${id}`,post:c.post||'',role:String(c[roleField]||''),phone:normalizePhones(c).map(p=>phoneStatus(p)==='dummy'?'номер-пустышка!!!':p).join(', ')},segment:{...resolveSegment(c[contactMetadata.path]),path:String(c[contactMetadata.path]||'')},commercial:metrics,companies,...state(c)};
  }
  async function search(id,q,authorization) {
    const c=await readContact(id,authorization);
    const query=String(q||'').trim().slice(0,100);if(!query)return [];
    const digits=query.replace(/\D/g,'');
    const filters=[{title:{$contains:query}}];
    if(/^\d+$/.test(query))filters.push({id:Number(query)});
    if(digits.length>=3) {
      filters.push({phone:{$contains:digits}});
      if(digits.length===11 && /^[78]/.test(digits))filters.push({phone:{$contains:digits.slice(1)}});
    }
    const results=await Promise.all(filters.map(filter=>vibe('/v1/companies/search',authorization,{method:'POST',body:JSON.stringify({filter,select:['id','title','phone',featureField],limit:20,sort:'id'})})));
    const linked=new Set(linkedIds(c));
    return [...new Map(results.flatMap(list).map(c=>[Number(c.id),{...companyView(c),linkedToCurrentContact:linked.has(Number(c.id))}])).values()].slice(0,30);
  }
  async function changeLink(id,companyId,remove,authorization) {
    const after=await links.change(id,companyId,remove,authorization);
    return {companies:await companiesFor(after,authorization)};
  }
  async function save(id,input,authorization,relationshipUpdate = {}) {
    const c=await readContact(id,authorization);
    if(input?.segmentKey!==resolveSegment(c[contactMetadata.path]).value)throw error('Сегмент КА изменился или открыта прежняя версия формы. Обновите паспорт перед сохранением. Ваши ответы сохранены.');
    const currentCompanies=await companiesFor(c,authorization);
    const requested=Array.isArray(input.companyFeatures)?input.companyFeatures:[];
    const changed=[];
    for(const f of requested){
      const existing=currentCompanies.find(x=>x.id===Number(f.id));
      if(!existing)throw error(`Компания #${f.id} больше не связана с контактом. Черновик сохранён.`);
      const text=String(f.feature??'').slice(0,3000);
      if(text===existing.feature)continue;
      if(typeof f.original==='string'&&f.original!==existing.feature)throw error(`Особенность компании «${existing.title}» изменена другим сотрудником. Обновите данные перед сохранением.`);
      changed.push({id:existing.id,text});
    }
    if(!resolveSegment(c[contactMetadata.path]).isInstaller){
      // Keep non-segment contact edits working; ignore hidden specialization payloads.
      const patch={...relationshipUpdate};
      if(Object.hasOwn(input,'role')&&String(input.role??'').slice(0,3000)!==String(c[roleField]??''))patch[roleField]=String(input.role??'').slice(0,3000);
      for(const f of changed)await vibe('/v1/companies/'+f.id,authorization,{method:'PATCH',body:JSON.stringify({[featureField]:f.text})});
      if(Object.keys(patch).length)await vibe('/v1/contacts/'+id,authorization,{method:'PATCH',body:JSON.stringify(patch)});
      const result=await load(id,authorization,{core:true});
      if(Object.hasOwn(patch,roleField)&&result.contact.role!==patch[roleField])throw error('Битрикс не подтвердил сохранение роли контакта.',502);
      for(const f of changed)if(result.companies.find(x=>x.id===f.id)?.feature!==f.text)throw error('Битрикс не подтвердил сохранение особенности компании.',502);
      return result;
    }
    const update={...relationshipUpdate};
    for(const [key,field] of Object.entries(fields))if(key!=='elementTypes')update[field]=JSON.stringify(cleanSelection(key,input.selections?.[key==='works'?'workTypes':key]));
    const previous=parseDetailState(c[fields.elementTypes]);
    const selections={...Object.fromEntries(Object.entries(fields).filter(([key])=>key!=='elementTypes').map(([key,field])=>[key,JSON.parse(update[field])])),elementTypes:cleanSelection('elementTypes',input.selections?.elementTypes),productGroups:previous.productGroups,finalItems:previous.finalItems};
    selections.objects=migrateObjects(selections.objects);
    update[fields.objects]=JSON.stringify(selections.objects);
    update[fields.elementTypes]=serializeDetail(c[fields.elementTypes],selections,previous.brandNotes,input.extendedInfo,{savedAt:new Date().toISOString()});
    update[roleField]=String(input.role??'').slice(0,3000);
    assertPassportVersion(c,fields,input,update);
    await archivePassport('contacts',c,fields);
    // All references/conflicts are checked before the first write. Retrying a partial save is idempotent.
    for(const f of changed)await vibe(`/v1/companies/${f.id}`,authorization,{method:'PATCH',body:JSON.stringify({[featureField]:f.text})});
    await vibe(`/v1/contacts/${id}`,authorization,{method:'PATCH',body:JSON.stringify(update)});
    const after=await readContact(id,authorization);
    for(const field of Object.keys(update))if(String(after[field]??'')!==String(update[field]??''))throw error('Bitrix24 не подтвердил сохранение всех полей. Черновик сохранён.',502);
    if(hasClassificationPassport(after,fields)||String(after[headField]||'').trim().length>0)await recordFill(id,authorization);
    return {
      lastEdit:await lastPassportEdit('contacts',id),
      contact:{id:Number(after.id),role:String(after[roleField]||'')},
      companies:currentCompanies.map(company=>{
        const change=changed.find(item=>item.id===company.id);
        return change?{...company,feature:change.text}:company;
      }),
      ...state(after),
    };
  }
  return {load,save,search,changeLink,readContact,companiesFor};
}

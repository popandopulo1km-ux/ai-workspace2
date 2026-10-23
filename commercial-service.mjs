// Read-only, common document calculation for company/contact cards and head groups.
const REF=(type,id)=>`${type==='company'?'CO':'C'}_${Number(id)}`;
const sources=[
 {kind:'wholesale',path:'/v1/deals/search',amount:'amount',currency:'currency',filter:{categoryId:5,stageSemanticId:{$in:['P','S']}},active:r=>r.stageSemanticId==='P',success:r=>r.stageSemanticId==='S',select:['categoryId','stageSemanticId']},
 {kind:'corporate',path:'/v1/items/1048/search',amount:'opportunity',currency:'currencyId',filter:{stageId:{$in:['DT1048_9:NEW','DT1048_9:PREPARATION','DT1048_9:CLIENT','DT1048_9:UC_11CCP6','DT1048_9:UC_EKDNQ6','DT1048_9:SUCCESS']}},active:r=>['DT1048_9:NEW','DT1048_9:PREPARATION','DT1048_9:CLIENT','DT1048_9:UC_11CCP6','DT1048_9:UC_EKDNQ6'].includes(r.stageId),success:r=>r.stageId==='DT1048_9:SUCCESS',select:[]},
 {kind:'realization',path:'/v1/items/1062/search',amount:'opportunity',currency:'currencyId',filter:{stageId:{$in:['DT1062_13:NEW','DT1062_13:PREPARATION','DT1062_13:CLIENT','DT1062_13:UC_LOFUNR','DT1062_13:SUCCESS']}},active:r=>['DT1062_13:NEW','DT1062_13:PREPARATION','DT1062_13:CLIENT','DT1062_13:UC_LOFUNR'].includes(r.stageId),success:r=>r.stageId==='DT1062_13:SUCCESS',select:['movedTime']},
];
const rows=b=>Array.isArray(b.data)?b.data:Array.isArray(b.data?.items)?b.data.items:[];
const meta=b=>b.meta||b.data?.meta||{};
const fail=msg=>Object.assign(new Error(msg),{code:'COMMERCIAL_INCOMPLETE'});
export function documentRefs(r){return [...new Set([Number(r.companyId)>0?'CO_'+Number(r.companyId):null,...[r.contactId,...(Array.isArray(r.contactIds)?r.contactIds:[])].filter(v=>Number(v)>0).map(v=>'C_'+Number(v))].filter(Boolean))];}
export function summarizeDocuments(documents,refs){
 const set=new Set(refs),used=new Set();
 const result={salesPotentialSum:0,salesPotentialCount:0,wholesaleCount:0,corporateCount:0,inProgressRealizationsSum:0,inProgressRealizationsCount:0,successfulRealizationsCount:0,successfulRealizationsSum:0,successfulRealizationDocumentsCount:0,lastSuccessfulRealizationDate:null,sharedDocumentCount:0};
 for(const doc of documents){
  if(!doc.refs.some(r=>set.has(r))||used.has(doc.key))continue;used.add(doc.key);
  if(doc.refs.filter(r=>set.has(r)).length>1)result.sharedDocumentCount++;
  if(doc.kind==='realization'){
   if(doc.active){result.inProgressRealizationsCount++;result.inProgressRealizationsSum+=doc.cents;}
   if(doc.success){result.successfulRealizationDocumentsCount++;result.successfulRealizationsSum+=doc.cents;if(doc.date&&(!result.lastSuccessfulRealizationDate||Date.parse(doc.date)>Date.parse(result.lastSuccessfulRealizationDate)))result.lastSuccessfulRealizationDate=doc.date;}
  }else{
   if(doc.active){result.salesPotentialCount++;result[doc.kind==='wholesale'?'wholesaleCount':'corporateCount']++;result.salesPotentialSum+=doc.cents;}
   if(doc.success)result.successfulRealizationsCount++;
  }
 }
 for(const key of ['salesPotentialSum','inProgressRealizationsSum','successfulRealizationsSum'])result[key]/=100;
 return result;
}
export function createCommercialService({vibe,portalBase}){
 async function all(path,filter,select,auth){
  const found=new Map();let offset=0;
  while(true){
   const b=await vibe(path,auth,{method:'POST',body:JSON.stringify({filter,select,sort:'id',limit:500,offset,autoWindow:false,withTotal:true})});
   if(meta(b).truncated)throw fail('Выборка документов обрезана.');
   const page=rows(b),old=found.size;
   for(const row of page){if(!Number.isSafeInteger(Number(row.id)))throw fail('Неизвестный ID документа.');found.set(Number(row.id),row);}
   offset+=page.length;
   const more=meta(b).hasMore===true||(Number.isFinite(Number(meta(b).total))&&Number(meta(b).total)>offset);
   if(!more&&(meta(b).hasMore===false||page.length<500))break;
   if(!page.length||found.size===old||offset>=100000)throw fail('Не удалось полностью прочитать документы.');
  }
  return [...found.values()];
 }
 async function documents(cards,auth){
  const unique=new Map();
  // Three independent types; within one type associations and pages are sequential.
  await Promise.all(sources.map(async source=>{
   for(const [type,field] of [['company','companyId'],['contact','contactIds']]){
    const ids=[...new Set(cards.filter(c=>c.type===type).map(c=>Number(c.id)))];
    for(let start=0;start<ids.length;start+=50){
     const select=['id','companyId','contactId','contactIds','stageId',source.amount,source.currency,...source.select];
     const list=await all(source.path,{...source.filter,[field]:{$in:ids.slice(start,start+50)}},select,auth);
     for(const r of list){
      if(!source.active(r)&&!source.success(r))throw fail('CRM вернула документ вне запрошенных стадий.');
      if(source.kind==='wholesale'&&Number(r.categoryId)!==5)throw fail('CRM вернула документ другой воронки.');
      if(r[source.currency]!=='RUB'||r[source.amount]==null||!Number.isFinite(Number(r[source.amount])))throw fail('Валюта или сумма документа требует проверки.');
      const doc={key:source.kind+':'+r.id,kind:source.kind,refs:documentRefs(r),active:source.active(r),success:source.success(r),cents:Math.round(Number(r[source.amount])*100),date:r.movedTime||null};
      if(!doc.refs.some(ref=>cards.some(c=>REF(c.type,c.id)===ref)))throw fail('CRM вернула документ другого контрагента.');
      const prior=unique.get(doc.key);
      if(prior&&(prior.cents!==doc.cents||prior.active!==doc.active||prior.success!==doc.success))throw fail('Документ изменился во время расчёта.');
      unique.set(doc.key,doc);
     }
    }
   }
  }));
  return [...unique.values()];
 }
 async function farmers(cards,auth){
  const result=[];
  for(const [type,resource,farmerField] of [['company','companies','ufCrm_1782369491'],['contact','contacts','ufCrm_1782369591']]){
   const ids=cards.filter(c=>c.type===type).map(c=>Number(c.id));
   for(let start=0;start<ids.length;start+=100){
    const batch=ids.slice(start,start+100),list=await all('/v1/'+resource+'/search',{id:{$in:batch}},['id',farmerField],auth);
    if(list.length!==batch.length)throw fail('Не все карточки группы доступны.');
    for(const r of list){const c=cards.find(c=>c.type===type&&Number(c.id)===Number(r.id));const id=Number(Array.isArray(r[farmerField])?r[farmerField][0]:r[farmerField]);result.push({...c,reference:REF(type,c.id),url:`${portalBase}/crm/${type}/details/${c.id}/`,farmer:id>0?{id,name:null}:null});}
   }
  }
  const ids=[...new Set(result.map(c=>c.farmer?.id).filter(Boolean))];
  for(const id of ids){const b=await vibe(`/v1/users/${id}?select=id,name,lastName,secondName`,auth),u=b.data||b,name=[u.lastName,u.name,u.secondName].filter(Boolean).join(' ');if(!name)throw fail('Не удалось определить фермера.');for(const c of result)if(c.farmer?.id===id)c.farmer.name=name;}
  return result;
 }
 async function decorate(type,id,auth,data){
  const relation=data.relationship,self=relation?.self||{type,id,name:data.company?.title||data.contact?.name};
  const group=relation?.role==='head';
  const cards=group?[self,...(relation.members||[])]:[self];
  let docs;
  try{docs=await documents(cards,auth);}
  catch(error){
   console.warn('Commercial calculation unavailable',error.code||'ERROR');
   return {...data,commercial:{...data.commercial,successfulRealizationsCount:null,successfulRealizationsSum:null,historyUnavailable:true},commercialGroup:group?{status:'unavailable'}:null};
  }
  const own=summarizeDocuments(docs,[REF(type,id)]);
  const commercial={...data.commercial,...own,historyUnavailable:false,salesPotentialUnavailable:false,realizationSummaryUnavailable:false};
  let commercialGroup=null;
  if(group){
   try{const named=await farmers(cards,auth);commercialGroup={status:'ready',head:self,includeHead:true,cards:named,metrics:summarizeDocuments(docs,cards.map(c=>REF(c.type,c.id))),farmerCount:new Set(named.map(c=>c.farmer?.id).filter(Boolean)).size};}
   catch(error){console.warn('Group farmers unavailable',error.code||'ERROR');commercialGroup={status:'unavailable'};}
  }
  return {...data,commercial,commercialGroup};
 }
 return {decorate,documents};
}

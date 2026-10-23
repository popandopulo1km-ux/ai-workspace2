import {segmentFromPath,paths} from './passport-segment.mjs';
import {readFile} from 'node:fs/promises';
import {comparePurchases} from './comparison.mjs';
import {readExtended} from './extended-info-service.mjs';
const parse=v=>{try{return typeof v==='string'?JSON.parse(v):v}catch{return null}};
export function selectionsFromCard(card){
 const selections=Object.fromEntries(['Objects','Works','Contours','Systems','Elements'].map(k=>[k.toLowerCase(),parse(card['ufCrmWmPassport'+k])||[]]));
 const detail=parse(card.ufCrmWmPassportElementTypes)||{};
 selections.elementTypes=Array.isArray(detail)?detail:detail.items||[];
 return selections;
}
export function activeQuestionIds(catalog,s){
 const objects=new Set((s.objects||[]).map(x=>x==='apartments'?'mkd':x));
 return [...new Set(catalog.triggers.filter(t=>(!t.objectId||objects.has(t.objectId))&&(!t.contourId||s.contours.includes(t.contourId))&&(!t.systemId||s.systems.includes(t.systemId))&&(!t.elementId||s.elements.includes(t.elementId))&&(!t.elementTypeId||s.elementTypes.includes(t.elementTypeId))&&(!t.parentElementTypeId||s.elementTypes.includes(t.parentElementTypeId))).map(t=>t.questionId))];
}
export async function createReportRecommendations({vibe,purchaseHistory}){
 const mapping=JSON.parse(await readFile(new URL('./purchase-mapping.json',import.meta.url),'utf8'));
 const catalog=JSON.parse((await readFile(new URL('./extended-catalog.js',import.meta.url),'utf8')).replace(/^\s*window\.PASSPORT_EXTENDED_CATALOG\s*=\s*/,'').replace(/;\s*$/,''));
 const fields=['id',...Object.values(paths),...['Objects','Works','Contours','Systems','Elements','ElementTypes'].map(k=>'ufCrmWmPassport'+k)];
 // Shared worker bound across all employees; do not cache access grants or results.
 let running=0,workers=0;const waiting=[];
 async function acquire(){if(workers<3){workers++;return;}await new Promise(resolve=>waiting.push(resolve));}
 function release(){const next=waiting.shift();if(next)next();else workers--;}
 return async function recommendations(refs,authorization){
  if(!authorization)throw Object.assign(Error('Откройте отчёт из Bitrix24.'),{status:401});
  if(!Array.isArray(refs)||refs.length<1||refs.length>8||refs.some(r=>! /^(CO|C)_[1-9][0-9]*$/.test(r)))throw Object.assign(Error('Некорректный пакет контрагентов.'),{status:400});
  if(running>=2)throw Object.assign(Error('Сервис занят. Повторите загрузку.'),{status:503});
  running++;
  try{
   const results={};
   await Promise.all([...new Set(refs)].map(async ref=>{
    await acquire();
    try{
    const [type,id]=ref.split('_');
    try{
     const card=(await vibe('/v1/'+(type==='CO'?'companies':'contacts')+'/'+id+'?select='+encodeURIComponent(fields.join(',')),authorization)).data;
     if(Number(card?.id)!==Number(id))throw Object.assign(Error('Нет доступа к контрагенту.'),{status:403});
     const selections=selectionsFromCard(card),segmentDefined=segmentFromPath(card[paths[type==='CO'?'companies':'contacts']]).isInstaller,saved=Object.values(selections).some(v=>Array.isArray(v)&&v.length);
     const active=segmentDefined&&saved?activeQuestionIds(catalog,selections):[];
     const {answers}=readExtended(card.ufCrmWmPassportElementTypes,selections);
     const params={ref,scope:'own',status:'all'};
     const partner=await purchaseHistory('summary',{...params,role:'partner'},authorization);
     const earlier=comparePurchases({selections,answers},mapping,partner,active);
     // Earlier purchases retain the approved partner scope; needs use the full group and current sales period.
     const history=earlier.expected.length?await purchaseHistory('summary',{...params,scope:'group',role:'counterparty'},authorization):{known:true,groups:[]};
     const result=comparePurchases({selections,answers},mapping,history,active);
     results[ref]={known:partner.known,gapsKnown:result.known,specializationSaved:saved,segmentDefined,earlier:partner.known?earlier.earlier.map(g=>g.name):null,missing:saved&&result.known?result.gaps.map(g=>g.name):null,expectedCount:result.expected.length,unresolved:result.unresolved.map(r=>r.label),period:partner.fromMonth.slice(5)+'.'+partner.fromMonth.slice(0,4)+'–'+partner.toMonth.slice(5)+'.'+partner.toMonth.slice(0,4),scope:'group',earlierScope:'own',earlierRole:'partner',gapsRole:'counterparty'};
    }catch(e){results[ref]={error:e.status===403?'Нет доступа к контрагенту.':'Рекомендации временно недоступны. Повторите загрузку.'};}
    }finally{release();}
   }));
   return results;
  }finally{running--;}
 };
}

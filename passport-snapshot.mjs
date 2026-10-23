import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readExtended,extendedCatalog} from './extended-info-service.mjs';
import {isNegativePurchaseAnswer} from './comparison.mjs';
import {currentGroups} from './current-groups.mjs';
import {evaluate} from './passport-sync-check.mjs';
import {hasClassificationPassport} from './passport-completion.mjs';
const root=process.env.PASSPORT_SNAPSHOT_DIR||'/opt/app/data/report-snapshot';
const base=fileURLToPath(new URL('.',import.meta.url));
const json=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const atomic=async(p,data)=>{await fs.writeFile(p+'.tmp',JSON.stringify(data),{mode:0o600});await fs.rename(p+'.tmp',p);};
export async function collect(request){
 const cards=new Map();
 const fields=['id','title','name','lastName','secondName','updatedTime','ufCrmWmPassportHead','ufCrmWmKaSegment',
 'ufCrm_1782369491','ufCrm_1782369591','ufCrm_1785825564','ufCrm_1785825531',
 ...['Objects','Works','Contours','Systems','Elements','ElementTypes'].map(k=>'ufCrmWmPassport'+k)];
 async function scan(kind,type,filter){
  let last=0;
  for(;;){
   const select=fields.filter(f=>kind==='companies'?!['name','lastName','secondName','ufCrm_1782369591','ufCrm_1785825531'].includes(f):!['title','ufCrm_1782369491','ufCrm_1785825564'].includes(f));
   const b=await request('/'+kind+'/search',{filter:{...filter,...(last?{id:{$gt:last}}:{})},select,sort:'id',limit:500,autoWindow:false,withTotal:false});
   if(!Array.isArray(b.data)||b.meta?.partial||b.meta?.truncated||b.meta?.pageErrorSample?.length||b.meta?.windowErrors?.length)throw Error('Incomplete passport scan '+kind);
   console.log(JSON.stringify({scan:kind,rows:b.data.length,hasMore:!!b.meta?.hasMore}));
   for(const c of b.data){if(type+'_'+c.id!=='CO_97')cards.set(type+'_'+c.id,{...c,ref:type+'_'+c.id});}
   if(!b.meta?.hasMore)break;
   const next=Math.max(...b.data.map(c=>Number(c.id)));if(!(next>last))throw Error('Pagination stalled');last=next;
  }
 }
 for(const[k,t,f]of [['companies','CO','ufCrm_1782369491'],['contacts','C','ufCrm_1782369591']])await scan(k,t,{[f]:{$gt:0}});
 const baseCount=cards.size;if(!baseCount)throw Error('Empty assigned base');
 // Resolve both outgoing heads and incoming members, including unassigned group participants.
 const scanned=new Set();
 for(let round=0;round<20;round++){
  const refs=[...new Set([...cards.keys(),...[...cards.values()].map(c=>c.ufCrmWmPassportHead).filter(Boolean)])].filter(r=>!scanned.has(r));
  if(!refs.length)return {cards:[...cards.values()],baseCount};
  for(let i=0;i<refs.length;i+=300){
   const part=refs.slice(i,i+300);
   for(const[k,t]of [['companies','CO'],['contacts','C']]){
    const ids=part.filter(r=>r.startsWith(t+'_')&&!cards.has(r)).map(r=>Number(r.split('_')[1]));
    if(ids.length)await scan(k,t,{id:ids});
    await scan(k,t,{ufCrmWmPassportHead:part});
   }
   part.forEach(r=>scanned.add(r));
  }
 }
 throw Error('Group closure did not converge');
}
export function build(profiles,hist,old,mapping){
 const byRef=new Map(profiles.map(c=>[c.ref,c])),users=new Map(old.users.map(u=>[Number(u.id),u]));
 const totals=new Map(),facts=new Map();
 for(const[k,tg,date,amount,income]of hist.daily.rows){
  totals.set(k,(totals.get(k)||0)+amount);
  const key=k+'|'+tg,f=facts.get(key)||{lifetime:0,last:''};f.lifetime+=amount;if(amount>0&&date>f.last)f.last=date;facts.set(key,f);
 }
 const clients=hist.clusters.map(c=>{
  const ps=c.cards.map(x=>byRef.get(x.ref)).filter(Boolean),questions=[],expected=new Map();
  for(const p of ps){
   // Undefined segment retains answers in CRM but does not activate segment-specific demand.
   if(p.ufCrmWmKaSegment!=='Монтажник')continue;
   const sel={};
   for(const k of ['objects','works','contours','systems','elements']){
    const v=p['ufCrmWmPassport'+k[0].toUpperCase()+k.slice(1)];
    try{sel[k]=JSON.parse(v||'[]');}catch{sel[k]=String(v||'').split('|').filter(Boolean);}
   }
   let detail={};try{detail=JSON.parse(p.ufCrmWmPassportElementTypes||'{}');}catch{}
   sel.elementTypes=detail.items||[];
   const info=readExtended(p.ufCrmWmPassportElementTypes,sel);
   for(const m of mapping.rows){
    const a=info.answers[m.id];
    if(m.status!=='mapped'||!info.activeQuestionIds.includes(m.id)||!a?.enabled||isNegativePurchaseAnswer(a)||!(a.brands?.length||(a.other&&a.text?.trim())||a.value===true))continue;
    const groups=m.groups.filter(g=>hist.groups.includes(g));
    for(const g of groups){if(!expected.has(g))expected.set(g,[]);expected.get(g).push({question:m.label,brands:a.brands||[],other:a.other?a.text:'',negative:false});}
    const paths=extendedCatalog.triggers.filter(t=>t.questionId===m.id&&(!t.parentElementTypeId||sel.elementTypes.includes(t.parentElementTypeId))&&(!t.contourId||sel.contours.includes(t.contourId))&&['object','system','element','elementType'].every((key,i)=>!t[key+'Id']||sel[['objects','systems','elements','elementTypes'][i]].includes(t[key+'Id']))).map(t=>t.context).filter(Boolean);
    questions.push({id:m.id,label:m.label,ref:p.ref,groups,answer:[...(a.brands||[]),a.other?a.text:'',a.value===true?'Да':''].filter(Boolean).join('; '),paths:[...new Set(paths)]});
   }
  }
  const farmerIds=[...new Set(ps.map(p=>Number(p.ufCrm_1782369491||p.ufCrm_1782369591)).filter(Boolean))];
  return {...c,refs:ps.map(p=>p.ref),name:ps.map(p=>p.title||[p.lastName,p.name,p.secondName].filter(Boolean).join(' ')).join(' / '),
   inBase:farmerIds.length>0,farmerIds,farmers:farmerIds.map(id=>users.get(id)?.name||String(id)),
   segments:[...new Set(ps.map(p=>p.ufCrmWmKaSegment||'Не определён'))],
   passportFilled:ps.some(p=>hasClassificationPassport(p,Object.fromEntries(['objects','works','contours','systems','elements','elementTypes'].map(k=>[k,'ufCrmWmPassport'+k[0].toUpperCase()+k.slice(1)])))),
   questions,expected:[...expected.keys()],lifetimeTotal:totals.get(c.key)||0,groupKeys:[c.key],groupHeads:[],
   rows:hist.groups.map(tg=>({tg,...(facts.get(c.key+'|'+tg)||{lifetime:0,last:''}),current:0,prior:0,currentIncome:0,priorIncome:0,past:0,buying:0,status:'unknown',expected:expected.has(tg),basis:expected.get(tg)||[],negativeOnly:false,gap:false,stopped:false,decline:0,turnoverDecline:0,groupBuys:[],groupUnknown:false,partner:null}))};
 });
 const data={...old,clients,summary:hist.groups.map(tg=>({tg})),capturedAt:new Date().toISOString()};
 currentGroups(data,new Map(profiles.map(p=>[p.ref,String(p.ufCrmWmPassportHead||'')])));
 return {data,daily:hist.daily,meta:{capturedAt:data.capturedAt,cards:profiles.length,clients:clients.length,salesThrough:hist.maxMonth}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 await fs.mkdir(root,{recursive:true,mode:0o700});
 if(process.argv.includes('--activate')&&!process.argv.includes('--force')){
  const previous=await json(root+'/status.json').catch(e=>{if(e.code==='ENOENT')return {};throw e;});
  if(evaluate(previous).ok){console.log('Already synchronized today');process.exit(0);}
 }
  try{const pid=Number(await fs.readFile(root+'/running.lock','utf8'));try{process.kill(pid,0);throw Error('Snapshot already running');}catch(e){if(e.code!=='ESRCH')throw e;}await fs.unlink(root+'/running.lock');}catch(e){if(e.code!=='ENOENT')throw e;}
  const lock=await fs.open(root+'/running.lock','wx',0o600);
 try{
  await lock.writeFile(String(process.pid));
  const cfg=await json('/opt/app/data/segment-sync-credentials.json');let last=0;
  const request=async(route,body)=>{
   await new Promise(r=>setTimeout(r,Math.max(0,600-(Date.now()-last))));last=Date.now();
   const r=await fetch(cfg.base+'/v1'+route,{method:'POST',headers:{'X-Api-Key':cfg.key,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
   const b=await r.json();if(!r.ok||b.success===false)throw Error('Passport read '+route+' '+r.status+' '+(b.error?.code||''));return b;
  };
  const captured=process.argv.includes('--resume-build')?{cards:await json(root+'/profiles.json')}:await collect(request);
  await atomic(root+'/profiles.json',captured.cards);
  await atomic(root+'/refs.json',captured.cards.map(p=>p.ref));
  const py=spawnSync('python3',[base+'snapshot-history.py',root+'/refs.json',root+'/history.json'],{cwd:base+'purchase-history',env:{...process.env,PYTHONPATH:base+'purchase-history',PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8',timeout:300000});
  if(py.status!==0)throw Error('History extraction failed '+py.stderr.slice(-1000));
  const bundle=build(captured.cards,await json(root+'/history.json'),await json(base+'interactive-data.json'),await json(base+'purchase-mapping.json'));
  if(bundle.data.clients.length<100)throw Error('Unexpected empty dataset');
  const oldBundle=await json(root+'/current.json').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(oldBundle&&bundle.meta.cards<oldBundle.meta.cards*.9)throw Error('More than 10% of cards disappeared; retain last verified snapshot');
  const keys=new Set(bundle.data.clients.map(c=>c.key)),refs=new Set(),sources=new Set();
  for(const c of bundle.data.clients){
   for(const ref of c.refs){if(refs.has(ref))throw Error('Duplicate CRM card');refs.add(ref);}
   if(c.known)for(const name of c.names){if(sources.has(name))throw Error('Duplicated sales source');sources.add(name);}
   if(c.groupKeys.some(k=>!keys.has(k)))throw Error('Missing group identity');
  }
  for(const [key,,date,amount,income]of bundle.daily.rows)if(!keys.has(key)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isSafeInteger(amount)||!Number.isSafeInteger(income))throw Error('Invalid sales row');
  await atomic(root+'/candidate.json',bundle);
  if(process.argv.includes('--activate')){
   await fs.copyFile(root+'/current.json',root+'/previous.json').catch(e=>{if(e.code!=='ENOENT')throw e;});
   await fs.rename(root+'/candidate.json',root+'/current.json');
   await atomic(root+'/status.json',{ok:true,...bundle.meta,finishedAt:new Date().toISOString()});
  }
  console.log(JSON.stringify({...bundle.meta,activated:process.argv.includes('--activate')}));
 }catch(e){await atomic(root+'/status.json',{ok:false,failedAt:new Date().toISOString(),error:e.message});throw e;}
 finally{await lock.close();await fs.unlink(root+'/running.lock');}
}

import fs from 'node:fs/promises';
import {segmentField,paths,folders,segmentFromPath} from './passport-segment.mjs';
const root=process.env.SEGMENT_SYNC_DIR||'/opt/app/data/segment-sync';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function synchronize(request,state={},record=async()=>{}){
 const started=new Date().toISOString();let examined=0,changed=0;const seen=new Set();
 for(const [kind,path]of Object.entries(paths)){
  const filters=state.since?[{updatedTime:{$gte:new Date(Date.parse(state.since)-120000).toISOString()}}]:folders.map(f=>({[path]:{$contains:f}}));
  for(const filter of filters){let last=0;
   for(;;){
    const result=await request('/'+kind+'/search','POST',{filter:{...filter,...(last?{id:{$gt:last}}:{})},select:['id',path,segmentField],sort:'id',limit:500,autoWindow:false,withTotal:false});
    const rows=result.data,meta=result.meta||{};
    if(!Array.isArray(rows)||meta.partial||meta.truncated||meta.pageErrorSample?.length||meta.windowErrors?.length)throw Error('Incomplete segment scan '+kind);
    let pending=[];
    const flush=async()=>{
     if(!pending.length)return;
     if(request.batch){const r=await request.batch(kind,pending);if(r.data?.summary?.succeeded!==pending.length||Object.keys(r.data?.errors||{}).length)throw Error('Incomplete segment batch');}
     else for(const p of pending)await request('/'+kind+'/'+p.id,'PATCH',{[segmentField]:p.next||null});
     for(const p of pending){await record({phase:'written',kind,id:p.id,next:p.next,at:new Date().toISOString()});changed++;}pending=[];
    };
    for(const card of rows){const key=kind+'/'+card.id;if(seen.has(key))continue;seen.add(key);examined++;
     const next=segmentFromPath(card[path]).storedValue,old=String(card[segmentField]??'');if(next===old)continue;
     await record({phase:'before',kind,id:card.id,path:card[path],old,next,at:new Date().toISOString()});
     // Only this derived field is writable. Never send the source path or passport answers.
     pending.push({id:card.id,next});if(pending.length===10)await flush();
    }
    await flush();
    if(!meta.hasMore)break;const next=Math.max(...rows.map(c=>Number(c.id)));if(!(next>last))throw Error('Pagination stalled');last=next;
   }
  }
 }
 return {since:started,finishedAt:new Date().toISOString(),examined,changed};
}
if(process.argv[1]?.endsWith('segment-sync.mjs')){
 await fs.mkdir(root,{recursive:true,mode:0o700});
 const lockPath=root+'/running.lock';
 try{const pid=Number(await fs.readFile(lockPath,'utf8'));if(pid>0){try{process.kill(pid,0);console.log('Already running');process.exit(0);}catch(e){if(e.code!=='ESRCH')throw e;}}await fs.unlink(lockPath);}catch(e){if(e.code!=='ENOENT')throw e;}
 const lock=await fs.open(lockPath,'wx',0o600);await lock.writeFile(String(process.pid));
 try{
  const config=JSON.parse(await fs.readFile(process.env.SEGMENT_SYNC_CONFIG||'/opt/app/data/segment-sync-credentials.json','utf8'));
  let lastRequest=0;
  const request=async(route,method,body)=>{
   if(method==='PATCH'&&(Object.keys(body).length!==1||!Object.hasOwn(body,segmentField)))throw Error('Unsafe sync write');
   await pause(Math.max(0,550-(Date.now()-lastRequest)));lastRequest=Date.now();
   const response=await fetch(config.base+'/v1'+route,{method,headers:{'X-Api-Key':config.key,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
   const result=await response.json();if(!response.ok||result.success===false)throw Error('Segment API '+response.status+' '+String(result.error?.code||''));return result;
  };
  const state=JSON.parse(await fs.readFile(root+'/state.json','utf8').catch(e=>{if(e.code==='ENOENT')return '{}';throw e;}));
  request.batch=async(kind,items)=>{
   await pause(6000);
   return request('/batch','POST',{calls:items.map(p=>({id:String(p.id),entity:kind,action:'update',entityId:p.id,params:{[segmentField]:p.next||null}}))});
  };
  const result=await synchronize(request,state,e=>fs.appendFile(root+'/changes.ndjson',JSON.stringify(e)+'\n',{mode:0o600}));
  await fs.writeFile(root+'/state.tmp',JSON.stringify(result),{mode:0o600});await fs.rename(root+'/state.tmp',root+'/state.json');console.log(JSON.stringify(result));
 }finally{await lock.close();await fs.unlink(root+'/running.lock');}
}

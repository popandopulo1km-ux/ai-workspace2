import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export const failureText='Синхронизация данных по полям паспорта не проведена. Запустите синхронизацию вручную.';
export const day=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tomsk',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
export function evaluate(state,now=new Date()){
 return {date:day(now),ok:state?.ok===true&&!!state.finishedAt&&day(state.finishedAt)===day(now),checkedAt:now.toISOString(),lastSuccess:state?.finishedAt||null};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const root='/opt/app/data/report-snapshot',read=async(p,fallback)=>JSON.parse(await fs.readFile(p,'utf8').catch(e=>{if(e.code==='ENOENT')return JSON.stringify(fallback);throw e;}));
 const s=evaluate(await read(root+'/status.json',{}));
 await fs.writeFile(root+'/checkup.json',JSON.stringify({...s,...(!s.ok?{message:failureText}:{})}),{mode:0o644});
 if(!s.ok){
  const receipt=root+'/alert-'+s.date+'.json',old=await read(receipt,null);
  if(old?.verified)process.exit(0);
  const cfg=await read('/opt/app/data/segment-sync-credentials.json',{});
  const call=async(method,path,body)=>{
   const r=await fetch(cfg.base+'/v1'+path,{method,headers:{'X-Api-Key':cfg.key,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
   const b=await r.json();if(!r.ok||b.success===false)throw Error('Checkup delivery '+r.status);return b.data;
  };
  const chat=await call('GET','/chats/sg47');
  if(Number(chat.id)!==77939||chat.entityType!=='SONET_GROUP'||String(chat.entityId)!=='47')throw Error('Checkup target mismatch');
  const message=failureText+'\nДата: '+s.date;
  const find=async()=>{const b=await call('GET','/chats/sg47/messages?limit=100');return (Array.isArray(b)?b:b.messages||[]).find(m=>(m.text||m.message)===message);};
  let found=await find();
  if(!found){
   if(old)throw Error('Previous send outcome unresolved; refusing duplicate');
   await fs.writeFile(receipt,JSON.stringify({verified:false,date:s.date}),{mode:0o600});
   const sent=await call('POST','/chats/sg47/messages?format=v2',{message,templateId:'passport-sync-'+s.date,urlPreview:'N'});
   await fs.writeFile(receipt,JSON.stringify({verified:false,date:s.date,response:sent}),{mode:0o600});
   found=await find();if(!found)throw Error('Checkup message not confirmed');
  }
  await fs.writeFile(receipt,JSON.stringify({verified:true,messageId:found.id,date:s.date}),{mode:0o600});
 }
 console.log(JSON.stringify(s));
}

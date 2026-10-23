import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID,sign} from 'node:crypto';
import {mkdir,open,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const resetUsers=new Set([3098,17,99,40,25,32,20]);
export const passportContext=new AsyncLocalStorage();
const root=process.env.PASSPORT_INTEGRITY_DIR||'/opt/app/data/passport-integrity';
const detail='ufCrmWmPassportElementTypes';
const protectedField=k=>/^ufCrmWmPassport[A-Z]/.test(k);
const sha=v=>createHash('sha256').update(JSON.stringify(v??null)).digest('hex');
const fail=(message,status=403)=>Object.assign(new Error(message),{status,code:'PASSPORT_PROTECTED'});
const safeKey=(kind,id)=>{if(!['companies','contacts'].includes(kind)||!Number.isSafeInteger(Number(id))||Number(id)<1)throw fail('Неверный паспорт');return kind+'-'+Number(id);};
const fullName=u=>[u.lastName,u.name,u.secondName].filter(Boolean).join(' ')||`Сотрудник #${u.id}`;
async function durable(path,data){const file=await open(path,'wx',0o600);try{await file.writeFile(JSON.stringify(data));await file.sync();}finally{await file.close();}}
export async function lastPassportEdit(kind,id){
 const key=safeKey(kind,id);
 try{return JSON.parse(await readFile(join(root,key,'last-edit.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 // Older app events are evidence of a manual fill, not the card's general updatedBy.
 try{const path=kind==='contacts'?'/opt/app/data/contact-passport-events.ndjson':'/opt/app/data/passport-events.ndjson';
 const rows=(await readFile(path,'utf8')).split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l)).filter(e=>Number(e.companyId)===Number(id)&&['fill','reset'].includes(e.type));
 const e=rows.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];return e?{at:e.at,userId:e.userId,userName:e.userName,operation:e.type,source:'app-history'}:null;
 }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export function createProtectedVibe(raw){
 const locks=new Map();
 return async function protectedVibe(path,authorization,options={}){
  const match=/^\/v1\/(companies|contacts)\/(\d+)$/.exec(path);
  if(!match||options.method!=='PATCH')return raw(path,authorization,options);
  const patch=JSON.parse(options.body||'{}');if(!Object.keys(patch).some(protectedField))return raw(path,authorization,options);
  // VibeCode/Bitrix normalizes empty single-value strings to NULL before CRM events.
  // Sign and verify the value actually stored, not its UI-only empty-string form.
  for(const k of Object.keys(patch))if(protectedField(k)&&patch[k]==='')patch[k]=null;
  const ctx=passportContext.getStore();
  const manual=ctx&&(ctx.method==='PATCH'&&/^\/api\/passport(?:\/contact)?$/.test(ctx.path)||ctx.method==='POST'&&['/api/admin/reset','/api/passport/group-specialization/apply'].includes(ctx.path));
  if(!manual)throw fail('Автоматическое изменение паспортных полей запрещено. Откройте паспорт и сохраните изменения вручную.');
  const kind=match[1],id=Number(match[2]),key=safeKey(kind,id);
  const previous=locks.get(key)||Promise.resolve();
  const promise=previous.catch(()=>{}).then(async()=>{
   const me=await raw('/v1/users/me?select=id,name,lastName,secondName',authorization);const user=me.data||me;
   if(!Number(user.id))throw fail('Не удалось установить сотрудника, сохраняющего паспорт.');
   const operation=ctx.path==='/api/admin/reset'?'reset':ctx.path.endsWith('/apply')?'manual-copy':'manual-edit';
   if(operation==='reset'&&!resetUsers.has(Number(user.id)))throw fail('Сброс паспорта разрешён только указанным руководителям.');
   const before=(await raw(path,authorization)).data;
   if(!before||Number(before.id)!==id)throw fail('Не удалось прочитать исходную версию паспорта.',502);
   const beforeData=Object.fromEntries(Object.entries(before).filter(([k])=>protectedField(k)));
   const updates=Object.fromEntries(Object.entries(patch).filter(([k])=>protectedField(k)));
   const at=new Date().toISOString(),nonce=randomUUID();
   const event={at,nonce,kind,id,userId:Number(user.id),userName:fullName(user),operation,before:beforeData,requested:updates};
   const dir=join(root,key);await mkdir(dir,{recursive:true,mode:0o700});
   // If history cannot be persisted, no write is sent to CRM.
   await durable(join(dir,at.replaceAll(':','-')+'-'+nonce+'-before.json'),event);
   const signed=process.env.PASSPORT_GUARD_SIGNING_KEY;
   let outbound=patch;
   if(signed){
    const value=Object.hasOwn(patch,detail)?patch[detail]:before[detail]??null;
    const payload={version:1,kind,id,actor:Number(user.id),actorName:fullName(user),operation,at,nonce,
     before:Object.fromEntries(Object.keys(updates).map(k=>[k,sha(before[k])])),changes:updates};
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64');
    const signature=sign('RSA-SHA256',Buffer.from(encoded),await readFile(signed)).toString('base64');
    outbound={...patch,[detail]:JSON.stringify({_wmPassportPermit:{payload:encoded,signature},value})};
   }
   let result;
   try{result=await raw(path,authorization,{...options,body:JSON.stringify(outbound)});}catch(error){await durable(join(dir,nonce+'-failed.json'),{at:new Date().toISOString(),nonce,status:error.status||500});throw error;}
   const after=(await raw(path,authorization)).data;
   const mismatch=Object.keys(updates).filter(k=>JSON.stringify(after?.[k]??null)!==JSON.stringify(updates[k]??null));
   await durable(join(dir,nonce+'-after.json'),{...event,at:new Date().toISOString(),after:Object.fromEntries(Object.entries(after||{}).filter(([k])=>protectedField(k))),verified:!mismatch.length,mismatch});
   if(mismatch.length)throw fail('Битрикс не подтвердил сохранение паспорта. Предыдущая версия и попытка изменения сохранены.',502);
   const meta={at,userId:Number(user.id),userName:fullName(user),operation};
   const tmp=join(dir,nonce+'-meta.json');await durable(tmp,meta);await rename(tmp,join(dir,'last-edit.json'));
   return result;
  });
  locks.set(key,promise);try{return await promise;}finally{if(locks.get(key)===promise)locks.delete(key);}
 };
}

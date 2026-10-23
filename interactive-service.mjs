import {allowedData} from './report-data.mjs';
import {createGroupComments} from './group-comments.mjs';
import {readFile} from 'node:fs/promises';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
const compress=promisify(gzip);
const prefix='/api/admin/interactive';
export function createInteractiveReport({vibe,authorize,sendJson}){
 const jobs=new Map();
 const groupComments=createGroupComments(vibe);
 const load=name=>readFile(new URL('./'+name,import.meta.url),'utf8');
 const cachedFiles=new Map();
 async function file(name){if(!cachedFiles.has(name))cachedFiles.set(name,await load(name));return cachedFiles.get(name);}

 return async(req,res,url,auth)=>{
  if(!auth)return sendJson(res,401,{error:'Откройте отчёт из панели управления паспортами Bitrix24.'});
  try{
   if(req.method!=='GET')return sendJson(res,405,{error:'Метод не поддерживается'});
   if(url.pathname===prefix+'/data'){
    for(const [k,j] of jobs)if(j.expires<Date.now())jobs.delete(k);
    let job=jobs.get(auth);
    if(!job){
     if([...jobs.values()].some(j=>j.pending))return sendJson(res,202,{pending:true},{'retry-after':'2'});
     job={pending:true,expires:Date.now()+60000};jobs.set(auth,job);
     (async()=>{try{const started=Date.now();await authorize(auth);const data=await allowedData(vibe,auth);job.bytes=await compress(JSON.stringify(data));console.info('Interactive report prepared',JSON.stringify({clients:data.clients.length,gzipBytes:job.bytes.length,ms:Date.now()-started}));}catch(e){job.error=String(e.message);job.status=e.status||502;console.warn('Interactive report preparation failed',job.status,job.error.slice(0,200));}finally{job.pending=false;job.expires=Date.now()+60000;}})();
    }
    if(job.pending)return sendJson(res,202,{pending:true},{'retry-after':'2','cache-control':'no-store'});
    if(job.error)return sendJson(res,job.status,{error:job.error});
    res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-encoding':'gzip','cache-control':'no-store','vary':'Accept-Encoding','x-content-type-options':'nosniff'});return res.end(job.bytes);
   }
   // Current user's OAuth rights; no service-key fallback.
   await authorize(auth);
   if(url.pathname===prefix+'/comments'){
    return sendJson(res,200,await groupComments(url.searchParams.get('ref'),auth),{'cache-control':'no-store'});
   }
   const name=url.pathname===prefix+'/view'?'interactive.html':url.pathname===prefix+'/app.js'?'interactive-app.js':url.pathname===prefix+'/periods.mjs'?'interactive-periods.mjs':url.pathname===prefix+'/export.mjs'?'interactive-export.mjs':null;
   if(!name)return sendJson(res,404,{error:'Не найдено'});
   res.writeHead(200,{'content-type':name.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self' https://vibecode.bitrix24.tech https://crm2.waterman-t.com; object-src 'none'; base-uri 'none'"});res.end(await file(name));
  }catch(e){console.warn('Interactive report failed',e.status||502,e.code||'',String(e.message).slice(0,250));return sendJson(res,e.status||502,{error:e.message},{'cache-control':'no-store'});}
 };
}

import {readFile} from 'node:fs/promises';
import {allowedData} from './report-data.mjs';
import {calculatePatterns} from './patterns-core.mjs';
const reference=JSON.parse(await readFile(new URL('./potential-reference.json',import.meta.url),'utf8'));
export function createPatternService(admin,vibe){
 const jobs=new Map();let busy=false;
 return async(auth,department=0)=>{
  if(!auth)throw Object.assign(Error('Откройте панель из Bitrix24'),{status:401});
  department=Number(department);
  if(!Number.isSafeInteger(department)||department<0)throw Object.assign(Error('Неизвестный отдел'),{status:400});
  for(const[k,j]of jobs)if(j.expires<Date.now()&&!j.pending)jobs.delete(k);
  const key=auth+'|'+department;let job=jobs.get(key);
  if(!job){
   if(busy)return null;
   job={pending:true,expires:Date.now()+60000};jobs.set(key,job);busy=true;
   (async()=>{try{job.data=calculatePatterns(await allowedData(vibe,auth),reference,department);}
    catch(e){job.error=e;}finally{job.pending=false;job.expires=Date.now()+60000;busy=false;}})();
  }
  if(job.pending)return null;
  if(job.error)throw job.error;
  return job.data;
 };
}

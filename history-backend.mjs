import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const fail=(message,status)=>Object.assign(new Error(message),{status});
export function createHistoryService({vibe,parentService,holdingService,run=query}){
 return async function history(operation,params,authorization){
  if(!authorization)throw fail('Сессия Bitrix24 истекла. Обновите паспорт.',401);
  if(!['summary','details','documents','buyers'].includes(operation))throw fail('Неизвестный запрос',400);
  const match=/^(CO|C)_([1-9]\d*)$/.exec(params.ref||'');
  if(!match||!Number.isSafeInteger(Number(match[2])))throw fail('Не определена карточка КА',400);
  if(JSON.stringify(params).length>8000)throw fail('Слишком большой запрос',400);
  // This is the current user's OAuth placement session, never a technical CRM key.
  // Do not cache grants: removal of access must take effect on the next request.
  const entity=match[1]==='CO'?'companies':'contacts';
  const result=await vibe(`/v1/${entity}/${match[2]}?select=id`,authorization);
  if(Number(result?.data?.id)!==Number(match[2]))throw fail('Нет доступа к карточке КА',403);
  const role=params.role||'counterparty';
  if(!['counterparty','partner'].includes(role))throw fail('Неизвестный разрез покупок',400);
  const scope=params.scope||'own';
  if(!['own','group','holding'].includes(scope))throw fail('Неизвестный охват истории',400);
  let refs=[params.ref];
  if(scope==='group'){
   const type=match[1]==='CO'?'company':'contact';
   let relation=await parentService.load(type,Number(match[2]),authorization);
   if(relation.error)throw fail(relation.error,409);
   if(relation.role==='member'){
    if(!relation.head)throw fail('Головной контрагент недоступен',403);
    relation=await parentService.load(relation.head.type,relation.head.id,authorization);
    if(relation.error||relation.role!=='head')throw fail('Проверьте связь с головным контрагентом',409);
   }
   refs=[...new Set([params.ref,relation.self.reference,...relation.members.map(m=>m.reference)])];
   if(refs.length>500)throw fail('Группа слишком большая для текущей версии истории',422);
   // Recheck every member with the employee's placement session, never with a service credential.
   for(let i=0;i<refs.length;i+=6)await Promise.all(refs.slice(i,i+6).filter(r=>r!==params.ref).map(async ref=>{
    const m=/^(CO|C)_([1-9]\d*)$/.exec(ref);if(!m)throw fail('Неверная связь группы',409);
    const b=await vibe('/v1/'+(m[1]==='CO'?'companies':'contacts')+'/'+m[2]+'?select=id',authorization);
    if(Number(b?.data?.id)!==Number(m[2]))throw fail('Нет доступа ко всем участникам группы',403);
   }));
  }
  if(scope==='holding')refs=await holdingService.refs(match[1]==='CO'?'company':'contact',Number(match[2]),authorization);
  // Do not allow callers to supply or override authorized group references.
  const safe=Object.fromEntries(['ref','role','from','to','channel','group','status','sort','q','product','page','sku','docPage','buyerPage'].filter(k=>params[k]!==undefined).map(k=>[k,params[k]]));
  safe.groupRefs=refs;
  const response=await run(operation,safe);
  if(!response.success)throw fail(response.error?.message||'История не загружена',422);
  return {...response.data,role,scope,groupSize:refs.length,scopeNote:scope==='holding'?'Покупки холдинга: '+refs.length+' КА, включая головного. Одинаковые строки учитываются один раз.':scope==='group'?(refs.length>1?'Покупки всей группы: '+refs.length+' КА, включая головного. Одинаковые строки истории учитываются один раз.':'Группа не задана или состоит из одной карточки — покупки этого КА.'):'Покупки только этой карточки.'};
 };
}
let running=0;
function query(operation,params){
 if(running>=4)return Promise.reject(fail('История сейчас загружается другими сотрудниками. Повторите через несколько секунд.',503));
 running++;
 return new Promise((resolve,reject)=>{
  const child=spawn(process.env.HISTORY_PYTHON||'python3',[fileURLToPath(new URL('./purchase-history/query.py',import.meta.url))],{stdio:['pipe','pipe','ignore'],env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'}});
  let output='',done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);running--;error?reject(error):resolve(value);};
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(fail('Загрузка истории превысила время ожидания. Повторите попытку.',504));},12000);
  child.on('error',()=>finish(fail('Сервис истории временно недоступен',503)));
  child.stdin.on('error',()=>{});
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;if(output.length>2*1024*1024){child.kill('SIGKILL');finish(fail('Слишком большой ответ истории',500));}});
  child.on('close',code=>{if(done)return;if(code!==0)return finish(fail('Ошибка чтения истории',500));try{finish(null,JSON.parse(output));}catch{finish(fail('Ошибка формата истории',500));}});
  child.stdin.end(JSON.stringify({operation,params}));
 });
}

// Read-only. Every request uses the caller's OAuth, never the infrastructure/API key.
const service=t=>/whats\s*app\s*24|wazzup\s*24|\bTPS\b/i.test(t||'');
const parse=ref=>{const m=/^(CO|C)_([1-9]\d*)$/.exec(ref||'');if(!m)throw Object.assign(Error('Выберите карточку контрагента'),{status:400});return {type:m[1]==='CO'?'company':'contact',resource:m[1]==='CO'?'companies':'contacts',id:Number(m[2])};};
const headField='ufCrmWmPassportHead';
export function createGroupComments(vibe){
 let active=0;
 return async(ref,auth)=>{
  if(!auth)throw Object.assign(Error('Сессия Битрикс истекла'),{status:401});
  if(active>=2)throw Object.assign(Error('Сервис комментариев занят. Повторите запрос через несколько секунд.'),{status:429});
  active++;
  try{
   const request=(path,body)=>vibe('/v1'+path,auth,body?{method:'POST',body:JSON.stringify(body)}:undefined);
   async function pages(path,filter,select,latest=false){
    const result=[];let offset=0;
    for(let i=0;i<100;i++){
     const b=await request(path,{filter,select,limit:100,offset,sort:latest?'-createdAt,-id':'id',autoWindow:false});
     if(!Array.isArray(b.data)||b.meta?.truncated||b.meta?.pageErrorSample)throw Error('Источник вернул неполные данные. Повторите проверку.');
     result.push(...b.data);
     if(latest&&result.some(x=>x.comment?.trim()&&!service(x.comment)))return result;
     if(b.meta?.hasMore===false||(!b.meta?.hasMore&&b.data.length<100))return result;
     if(!b.data.length)throw Error('Не удалось дочитать источник');
     offset+=b.data.length;
    }
    throw Error('История слишком большая для одного запроса; результат не выдан как полный.');
   }
   const card=(ref,x)=>({ref,name:ref.startsWith('CO_')?x.title:[x.lastName,x.name,x.secondName].filter(Boolean).join(' '),head:String(x[headField]||'')});
   async function read(ref){const p=parse(ref),names=p.type==='company'?'title':'name,lastName,secondName',b=await request('/'+p.resource+'/'+p.id+'?select=id,'+names+','+headField);if(!b.data?.id)throw Object.assign(Error('Карточка недоступна'),{status:403});return card(ref,b.data);}
   const self=await read(ref),head=self.head||ref,members=new Map([[ref,self]]);
   if(head!==ref)members.set(head,await read(head));
   // Include reverse links even when a head has an empty self-reference.
   for(const [resource,prefix] of [['companies','CO'],['contacts','C']]){
    for(const x of await pages('/'+resource+'/search',{[headField]:head},['id',...(prefix==='CO'?['title']:['name','lastName','secondName']),headField])){
     const r=prefix+'_'+x.id;members.set(r,card(r,x));
    }
   }
   const now=new Date(),cutoff=new Date(now);cutoff.setFullYear(cutoff.getFullYear()-1);
   const client=[],group=[],seen=new Set(),authors=new Map();
   for(const c of members.values()){
    const p=parse(c.ref),filter={entityType:p.type,entityId:p.id};
    if(c.ref!==ref)filter.createdAt={$gte:cutoff.toISOString()};
    const rows=await pages('/timelines/search',filter,undefined,c.ref===ref);
    for(const x of rows){
     if(!x.comment?.trim()||service(x.comment))continue;
     if(c.ref!==ref&&(Date.parse(x.createdAt)<+cutoff||Date.parse(x.createdAt)>+now))continue;
     const key=String(x.id);if(seen.has(key))continue;seen.add(key);
     const item={id:x.id,ref:c.ref,name:c.name,text:x.comment,date:x.createdAt,authorId:x.authorId,source:'Лента контрагента'};
     (c.ref===ref?client:group).push(item);
    }
   }
   const sort=(a,b)=>Date.parse(b.date)-Date.parse(a.date)||Number(b.id)-Number(a.id);
   client.sort(sort);group.sort(sort);
   const items=[...client.slice(0,1),...group];
   for(const id of new Set(items.map(x=>x.authorId).filter(Boolean))){
    try{const b=await request('/users/'+id),u=b.data;authors.set(id,[u.lastName,u.name,u.secondName].filter(Boolean).join(' ')||'Сотрудник №'+id);}
    catch{authors.set(id,'Сотрудник №'+id+' (имя недоступно)');}
   }
   items.forEach(x=>x.author=authors.get(x.authorId)||'Автор не указан');
   return {client:client.slice(0,1),group,items,selected:self,members:[...members.values()],from:cutoff.toISOString(),at:now.toISOString(),notice:'Показаны комментарии карточек, доступных вашей учётной записи.'};
  }finally{active--;}
 };
}

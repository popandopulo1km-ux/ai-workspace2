// heads contains only cards returned by the existing caller-authorized access checks.
export function currentGroups(original,heads){
 const byRef=new Map(original.clients.flatMap(c=>c.refs.map(r=>[r,c.key])));
 const parent=new Map(original.clients.map(c=>[c.key,c.key]));
 const find=k=>{while(parent.get(k)!==k)k=parent.get(k);return k;};
 const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent.set(b,a);};
 const missing=new Set();
 const byKey=new Map(original.clients.map(c=>[c.key,c]));
 // A hidden participant must not turn a partially visible group into a known standalone KA.
 for(const c of original.clients)if((c.groupKeys||[]).some(k=>!byKey.has(k)||byKey.get(k).refs.some(r=>!heads.has(r))))missing.add(c.key);
 for(const c of original.clients)for(const ref of c.refs){
  if(!heads.has(ref))continue;
  const head=heads.get(ref);
  if(!head)continue;
  const key=byRef.get(head);
  if(key)join(c.key,key);else missing.add(c.key);
 }
 const sets=new Map();
 for(const c of original.clients){const root=find(c.key);if(!sets.has(root))sets.set(root,[]);sets.get(root).push(c);}
 for(const members of sets.values()){
  const keys=members.map(c=>c.key).sort();
  const groupHeads=[...new Set(members.flatMap(c=>c.refs.map(r=>heads.get(r)).filter(Boolean)))];
  const uncertain=members.some(c=>missing.has(c.key)||c.refs.some(r=>!heads.has(r)));
  for(const c of members){
   c.groupKeys=[...keys];c.groupHeads=groupHeads;
   for(const r of c.rows)r.groupUnknown=uncertain;
  }
 }
 return original;
}

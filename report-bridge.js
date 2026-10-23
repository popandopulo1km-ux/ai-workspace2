/* Authenticated application frame. No tokens or cookies cross postMessage. */
window.wmReportBridgeReady = new Promise(resolve=>{
 const portal='https://crm2.waterman-t.com';let connected=false,owner=null,nonce='';
 const ancestors=[];let p=window;while(p!==p.parent){p=p.parent;ancestors.push(p);}
 const send=(target,data)=>target.postMessage({channel:'wm-passport-report-v1',...data},portal);
 const announce=()=>ancestors.forEach(p=>send(p,{kind:'ready'}));
 let timer=setInterval(announce,400);announce();
 const deadline=setTimeout(()=>{clearInterval(timer);if(!connected)resolve(false);},1600);
 window.addEventListener('message',async e=>{
  if(e.origin!==portal||!ancestors.includes(e.source)||e.data?.channel!=='wm-passport-report-v1')return;
  const m=e.data;
  if(m.kind==='connect'&&typeof m.nonce==='string'&&m.nonce.length>=16){
   if(connected&&owner!==e.source)return;
   connected=true;owner=e.source;nonce=m.nonce;clearInterval(timer);clearTimeout(deadline);resolve(true);
   document.querySelector('main').hidden=true;
   try{const r=await fetch('/api/admin/report-session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),b=await r.json();if(!r.ok||!b.success)throw Error(b.error?.message||'Не удалось открыть сессию паспорта.');send(owner,{kind:'connected',nonce});}catch(error){send(owner,{kind:'error',nonce,error:error.message});}
   return;
  }
  if(!connected||e.source!==owner||m.nonce!==nonce)return;
  if(m.kind==='recommendations'&&typeof m.id==='string'){
   try{const r=await fetch('/api/admin/recommendations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refs:m.refs}),signal:AbortSignal.timeout(65000)}),b=await r.json();if(!r.ok||!b.success)throw Error(b.error?.message||'Рекомендации недоступны.');send(owner,{kind:'result',nonce,id:m.id,data:b.data});}catch(error){send(owner,{kind:'result',nonce,id:m.id,error:error.message});}
  }
 });
});

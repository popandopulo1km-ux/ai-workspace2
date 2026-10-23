/* Shared relationship editor for company and contact passports. */
window.createPassportParent = function({changed=()=>{},resize=()=>{}}={}) {
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let current={role:null,head:null,original:'',members:[],self:null},editing=false,saving=false,expanded=false,query='',results=[],status='',timer,request=0,savedHead=false;
 const label=x=>x.type==='company'?'Компания':'Контакт';
 const selectedMembers=new Set();
 const memberKey=x=>x.reference||(x.type==='company'?'CO_':'C_')+Number(x.id);
 const memberEntity=x=>`<div class="wm-parent-entity" style="display:flex;align-items:center;gap:16px"><div style="flex:1;min-width:0"><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.name)}</a><small>${label(x)} · ID ${Number(x.id)}</small></div>${savedHead?`<input type="checkbox" data-wm-member="${esc(memberKey(x))}" aria-label="Выбрать ${esc(x.name)}" ${selectedMembers.has(memberKey(x))?'checked':''} ${editing||saving?'disabled':''} style="width:19px;height:19px;flex:none;margin:0 8px;accent-color:#1598c6;cursor:pointer">`:''}</div>`;
 const entity=x=>x?`<div class="wm-parent-entity"><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.name)}</a><small>${label(x)} · ID ${Number(x.id)}</small></div>`:'';
 const style=`<style>
 .wm-parent{margin-top:18px;padding-top:16px;border-top:1px solid #dce6eb}.wm-parent-title{display:block;font-size:13px;font-weight:700;margin-bottom:9px}.wm-parent-title b{color:#c45a4c}.wm-parent-roles{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 14px;padding:0;border:0}.wm-parent-choice{padding:11px 9px;border:1px solid #cedfe7;border-radius:9px;font-size:12px;display:flex;gap:7px;align-items:start;cursor:pointer}.wm-parent-choice:has(input:checked){background:#eaf8fd;border-color:#22a8d6}.wm-parent-choice:has(input:disabled){cursor:default}.wm-parent-choice input{accent-color:#1598c6}.wm-parent-choice strong{display:block}.wm-parent-choice small{display:block;color:#7b8d98;font-size:11px;margin-top:3px}.wm-parent-note{font-size:12px;color:#718592;line-height:1.5;margin:8px 0}.wm-parent-entity{background:#f4f9fc;border:1px solid #d9e5eb;padding:10px 12px;border-radius:8px;overflow-wrap:anywhere}.wm-parent-entity a{font-weight:700;color:#087ca7}.wm-parent-entity small{display:block;color:#7b8d98;font-size:11px}.wm-parent-search{width:100%;box-sizing:border-box;border:1px solid #bfd7e2;border-radius:8px;padding:10px 12px;margin-top:10px;background:white;color:#173e55}.wm-parent-results:not(:empty){border:1px solid #dbe6ec;border-radius:8px;margin-top:8px;max-height:280px;overflow:auto}.wm-parent-result{padding:10px;display:flex;gap:10px;align-items:center;border-bottom:1px solid #e8eef1;font-size:12px}.wm-parent-result:last-child{border:0}.wm-parent-result>div{flex:1}.wm-parent-result small{display:block;color:#788b98}.wm-parent-result button{font-size:12px;padding:7px 10px}.wm-parent-warning{font-size:12px;color:#95692c;background:#fff9ed;padding:9px;border-radius:7px}.wm-parent-members{margin-top:14px;font-size:12px}.wm-parent-members summary{cursor:pointer;font-weight:700}.wm-parent-members .wm-parent-entity{margin-top:7px}.wm-parent-current{font-weight:700;color:#167698;font-size:13px;margin-bottom:10px}@media(max-width:600px){.wm-parent-roles{grid-template-columns:1fr}}
 .wm-parent{grid-column:1/-1;min-width:0;margin:0;padding:0;border:1px solid #d8e5eb;border-radius:12px;background:#fff;box-shadow:0 3px 12px #17445b06}.wm-parent-summary{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:13px 16px;list-style:none;cursor:pointer;font-size:14px;line-height:1.5;color:#173e55}.wm-parent-summary::-webkit-details-marker{display:none}.wm-parent-summary::before{content:'';width:7px;height:7px;flex:none;border-right:2px solid #668796;border-bottom:2px solid #668796;transform:rotate(-45deg);margin-right:3px}.wm-parent-panel[open]>.wm-parent-summary::before{transform:rotate(45deg)}.wm-parent-summary:focus-visible{outline:2px solid #1598c6;outline-offset:3px;border-radius:9px}.wm-parent-summary-role{font-weight:700}.wm-parent-summary-head{display:inline-flex;align-items:baseline;gap:6px;flex-wrap:wrap;min-width:0;color:#718592}.wm-parent-summary-head a{color:#087ca7;text-decoration:underline;text-underline-offset:3px;font-weight:600;overflow-wrap:anywhere}.wm-parent-summary-head a:focus-visible{outline:2px solid #1598c6;outline-offset:3px}.wm-parent-summary-empty{color:#718592}.wm-parent-body{border-top:1px solid #e1e9ed;padding:16px}.wm-parent-body-inner{max-width:880px}.wm-parent-body .wm-parent-title{font-size:14px}.wm-parent-body .wm-parent-choice{font-size:14px}.wm-parent-body .wm-parent-choice small{font-size:12px}.wm-parent-body .wm-parent-members{margin-top:12px}.wm-parent-members-title{font-size:14px;margin:0 0 8px}.wm-parent-body .wm-parent-search{font-size:14px}@media(max-width:600px){.wm-parent-summary-head{flex-basis:100%;padding-left:22px}.wm-parent-body{padding:12px}}
 </style>`;
 function panel(){
  const role=current.role==='head'?'Головной контрагент':current.role==='member'?'Участник группы':'Вариант связи не выбран';
  const head=current.role==='member'?`<span class="wm-parent-summary-head">Головной: ${current.head?`<a href="${esc(current.head.url)}" target="_blank" rel="noopener noreferrer">${esc(current.head.name)}</a>`:'не выбран'}</span>`:'';
  return `<details id="wm-parent-panel" class="wm-parent-panel" ${expanded?'open':''}><summary class="wm-parent-summary"><span class="wm-parent-summary-role ${current.role?'':'wm-parent-summary-empty'}">${role}</span>${head}</summary><div class="wm-parent-body"><div class="wm-parent-body-inner">${inner()}</div></div></details>`;
 }
 function inner(){
  const blocked=(current.members||[]).length>0;
  let html='<span class="wm-parent-title">Роль в группе клиентов</span>';
  html+=editing?`<fieldset class="wm-parent-roles" aria-label="Роль в группе клиентов"><label class="wm-parent-choice"><input type="radio" name="wm-parent-role" value="head" ${current.role==='head'?'checked':''} ${saving?'disabled':''}><span><strong>Головной контрагент</strong><small>Основная карточка группы</small></span></label><label class="wm-parent-choice"><input type="radio" name="wm-parent-role" value="member" ${current.role==='member'?'checked':''} ${saving||blocked?'disabled':''}><span><strong>Участник группы</strong><small>Относится к другому контрагенту</small></span></label></fieldset>`:`<div class="wm-parent-current">${current.role==='head'?'Головной контрагент':current.role==='member'?'Участник группы':'Не указана'}</div>`;
  if(blocked&&editing)html+='<p class="wm-parent-warning">Чтобы снять роль или стать участником другой группы, сначала переназначьте всех участников этой карточки.</p>';
  if(current.role==='member'){
   html+='<span class="wm-parent-title" style="margin-top:14px">Головной контрагент</span>';
   html+=current.head?entity(current.head):'<p class="wm-parent-note">Головной контрагент не выбран.</p>';
   if(editing&&current.head)html+=`<button type="button" data-wm-parent-unselect ${saving?'disabled':''} style="margin-top:8px">Снять выбор контрагента</button>`;
   if(editing&&current.head&&current.head.role===null)html+='<p class="wm-parent-note">При сохранении выбранная карточка станет головной для этой группы.</p>';
   if(editing)html+=`<input class="wm-parent-search" id="wm-parent-search" aria-label="Поиск головного контрагента" type="search" maxlength="100" autocomplete="off" placeholder="Название, ФИО, телефон или ИНН" value="${esc(query)}" ${saving?'disabled':''}><p class="wm-parent-note">Начните вводить название, ФИО, телефон или ИНН — поиск сразу по компаниям и контактам всей CRM.</p><div class="wm-parent-results" id="wm-parent-results"></div>`;
  }else if(!current.role)html+='<p class="wm-parent-note">Необязательно. Оставьте без выбора, если контрагент не входит в группу.</p>';
  if(current.error)html+=`<p class="wm-parent-warning">${esc(current.error)}</p>`;
  if(current.role==='head')html+=blocked?`<section class="wm-parent-members"><h3 class="wm-parent-members-title">Участники группы (${current.members.length})</h3>${current.members.map(memberEntity).join('')}</section>`:'<p class="wm-parent-note">Участников группы пока нет.</p>';
  if(current.role==='head'&&savedHead)html+=`<div style="margin-top:12px"><button type="button" data-wm-copy-specialization ${editing||saving||!blocked||!selectedMembers.size?'disabled':''}>Применить специализацию к участникам группы</button>${editing?'<p class="wm-parent-note">Чтобы применить специализацию к участникам группы, заполните и сохраните паспорт головного контрагента.</p>':''}</div>`;
  return html;
 }
 function renderResults(){const el=document.getElementById('wm-parent-results');if(!el)return;
  el.innerHTML=!query.trim()?'':status?`<p class="wm-parent-note" role="status">${esc(status)}</p>`:results.map((r,i)=>`<div class="wm-parent-result"><div><strong>${esc(r.name)}</strong><small>${label(r)} · ID ${r.id}</small>${r.phone?`<small>${esc(r.phone)}</small>`:''}${r.inn?`<small>ИНН ${esc(r.inn)}</small>`:''}${r.reason?`<small>${esc(r.reason)}</small>`:''}</div>${r.selectable?`<button type="button" data-wm-parent-choose="${i}" ${saving?'disabled':''}>Выбрать</button>`:`<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Карточка</a>`}</div>`).join('');resize();
 }
 function redraw(){const el=document.getElementById('wm-parent');if(el){el.innerHTML=panel();renderResults();resize();}}
 document.addEventListener('toggle',e=>{if(e.target.id==='wm-parent-panel'&&e.target===document.getElementById('wm-parent-panel')){expanded=e.target.open;resize();}},true);
 function stop(){clearTimeout(timer);request++;query='';results=[];status='';}
 async function search(){const q=query.trim();if(!q||!editing||saving)return;const ticket=++request;status='Поиск…';renderResults();
  try{const r=await fetch(`/api/passport/parent/search?type=${current.self.type}&id=${current.self.id}&q=${encodeURIComponent(q)}`,{cache:'no-store'});const b=await r.json();if(ticket!==request)return;if(!r.ok||!b.success)throw Error(b.error?.message||'Не удалось выполнить поиск.');results=b.data;status=results.length?'':'Подходящие компании и контакты не найдены.';}
  catch(e){if(ticket!==request)return;results=[];status=e.message;}renderResults();
 }
 document.addEventListener('change',e=>{if(!editing||saving||e.target.name!=='wm-parent-role')return;current.role=e.target.value;current.head=current.role==='head'?current.self:null;current.error=null;stop();redraw();changed();});
 document.addEventListener('input',e=>{if(e.target.id!=='wm-parent-search'||!editing||saving)return;query=e.target.value;clearTimeout(timer);request++;results=[];status='';renderResults();if(query.trim())timer=setTimeout(search,450);});
 document.addEventListener('keydown',e=>{if(e.target.id==='wm-parent-search'&&e.key==='Enter'){e.preventDefault();clearTimeout(timer);search();}});
 document.addEventListener('click',e=>{if(!editing||saving)return;const choice=e.target.closest('.wm-parent-choice');if(choice){e.preventDefault();const input=choice.querySelector('input[name="wm-parent-role"]');if(!input||input.disabled||(current.members||[]).length)return;current.role=current.role===input.value?null:input.value;current.head=current.role==='head'?current.self:null;current.error=null;stop();redraw();document.querySelector(`input[name="wm-parent-role"][value="${input.value}"]`)?.focus();changed();return;}if(e.target.closest('[data-wm-parent-unselect]')){current.head=null;stop();redraw();changed();return;}const button=e.target.closest('[data-wm-parent-choose]');if(!button)return;const item=results[Number(button.dataset.wmParentChoose)];if(!item?.selectable)return;current.head=item;current.error=null;stop();redraw();changed();});
 document.addEventListener('change',e=>{
  const key=e.target.dataset.wmMember;if(!key||editing||saving||!savedHead)return;
  if(!(current.members||[]).some(m=>memberKey(m)===key))return;
  e.target.checked?selectedMembers.add(key):selectedMembers.delete(key);
  const button=document.querySelector('[data-wm-copy-specialization]');if(button)button.disabled=!selectedMembers.size;
 });
 document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-wm-copy-specialization]');if(!button||button.disabled||!savedHead||editing||saving)return;
  if(document.getElementById('wm-specialization-dialog')||!selectedMembers.size)return;
  const checked=new Set(selectedMembers);
  const dialog=document.createElement('dialog');dialog.id='wm-specialization-dialog';dialog.style.cssText='width:min(620px,90vw);border:1px solid #cadde7;border-radius:14px;padding:22px;color:#173e55;max-height:80vh;overflow:auto';document.body.append(dialog);
  let applying=false;dialog.addEventListener('cancel',e=>{if(applying)e.preventDefault();});dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
  const display=html=>dialog.innerHTML='<h3 style="margin-top:0">Специализация участников группы</h3>'+html;
  const api=async(path,data)=>{const r=await fetch('/api/passport/group-specialization/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}),b=await r.json();if(!r.ok||!b.success)throw Error(b.error?.message||'Не удалось выполнить перенос');return b.data;};
  const closeButton=()=>{const b=document.createElement('button');b.type='button';b.textContent='Закрыть';b.onclick=()=>dialog.close();dialog.append(b);};
  display('<p role="status">Проверяю паспорта участников…</p>');
  try{
   const plan=await api('preview',{type:current.self.type,id:current.self.id});
   if(!dialog.isConnected)return;
   const selected=plan.members.filter(m=>checked.has(m.reference));
   if(selected.length!==checked.size)throw Error('Состав группы изменился. Обновите паспорт и выберите участников заново.');
   const waitAction=(setup)=>new Promise(resolve=>{const closed=()=>finish(null);const finish=value=>{dialog.removeEventListener('close',closed);resolve(value);};dialog.addEventListener('close',closed,{once:true});setup(finish);});
   const filled=selected.filter(m=>m.filled);
   if(filled.length){
    display(`${filled.length===1?`<p>У контрагента «${esc(filled[0].name)}» уже заполнен паспорт. Продолжить?</p>`:`<p>У следующих контрагентов уже заполнены паспорта:</p><ul>${filled.map(m=>`<li>${esc(m.name)}</li>`).join('')}</ul><p>Продолжить?</p>`}<p style="font-size:13px">Специализация перечисленных КА будет заменена данными головного КА.</p><div style="display:flex;gap:12px"><button type="button" data-answer="yes">Да</button><button type="button" data-answer="no">Нет</button></div>`);
    const answer=await waitAction(finish=>{dialog.querySelector('[data-answer="yes"]').onclick=()=>finish(true);dialog.querySelector('[data-answer="no"]').onclick=()=>finish(false);});
    if(!answer||!dialog.isConnected){if(dialog.isConnected)dialog.close();return;}
   }
   const skipped=plan.members.filter(m=>!checked.has(m.reference));
   if(!dialog.isConnected)return;
   applying=true;const results=[];
   for(const m of selected){
    display(`<p role="status">Сохраняю ${results.length+1} из ${selected.length}: ${esc(m.name)}</p>`);
    try{const r=await api('apply',{token:plan.token,reference:m.reference,replace:m.filled});results.push({...m,ok:true,warning:r.warning});}
    catch(err){results.push({...m,ok:false,error:err.message});}
   }
   applying=false;
   display(`<p role="status">Применено: ${results.filter(r=>r.ok).length}. Пропущено: ${skipped.length}. Ошибок: ${results.filter(r=>!r.ok).length}.</p><ul>${[...results.map(r=>`<li>${esc(r.name)} — ${r.ok?'сохранено':esc(r.error)}${r.warning?' · '+esc(r.warning):''}</li>`),...skipped.map(m=>`<li>${esc(m.name)} — без изменений</li>`)].join('')}</ul>`);closeButton();
  }catch(err){applying=false;if(dialog.isConnected){display(`<p role="alert">${esc(err.message)}</p>`);closeButton();}}
 });
 return {
  load(value){stop();selectedMembers.clear();current=structuredClone(value||{role:null,head:null,original:'',members:[]});savedHead=current.role==='head';},
  restore(value){if(value){current.role=value.role;current.head=value.head;current.original=value.original;}},
  snapshot(){return {role:current.role,head:current.role==='head'?current.self:current.head,original:current.original};},
  validate(){if(current.role==='member'&&!current.head){expanded=true;redraw();return 'Выберите головного контрагента из поиска или снимите выбор роли.';}return '';},
  html(edit,busy){editing=edit;saving=busy;if(!edit||busy)stop();return style+`<section class="wm-parent" id="wm-parent">${panel()}</section>`;},
  mounted(){renderResults();}
 };
};

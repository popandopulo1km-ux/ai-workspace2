/* One answer per product-group question within one company/contact passport. */
window.passportQuestionContext = function(trigger){
 const parts=String(trigger.context||'').split('→').map(x=>x.trim()).filter(Boolean);
 const path=(window.PASSPORT_TAXONOMY?.paths||[]).find(p=>p.systemId===trigger.systemId&&(!trigger.contourId||p.contourId===trigger.contourId));
 const system=path?.systemLabel;
 if(system&&!parts.includes(system)){
  const objectLabel={izhs:'ИЖС',mkd:'МКД',apartments:'МКД'}[trigger.objectId];
  const prefix=objectLabel&&parts.includes(objectLabel)?parts.indexOf(objectLabel)+1:trigger.contourId&&parts.includes(path.contourLabel)?parts.indexOf(path.contourLabel)+1:0;
  parts.splice(prefix,0,system);
 }
 return parts.join(' → ');
};
window.passportActiveQuestions = function(catalog,selections){
 const selected=key=>new Set(selections[key]||[]),objects=new Set((selections.objects||[]).map(x=>x==='apartments'?'mkd':x)),systems=selected('systems'),elements=selected('elements'),types=selected('elementTypes');
 const contexts=new Map();
 for(const t of catalog.triggers){if((t.objectId&&!objects.has(t.objectId))||(t.contourId&&!(selections.contours||[]).includes(t.contourId))||(t.systemId&&!systems.has(t.systemId))||(t.elementId&&!elements.has(t.elementId))||(t.elementTypeId&&!types.has(t.elementTypeId))||(t.parentElementTypeId&&!types.has(t.parentElementTypeId)))continue;if(!contexts.has(t.questionId))contexts.set(t.questionId,new Set());contexts.get(t.questionId).add(window.passportQuestionContext(t));}
 return [...contexts].map(([id,paths])=>({...catalog.questions.find(q=>q.id===id),contexts:[...paths]}));
};
window.passportQuestionCompletion=function(selections,answers){
 const active=window.passportActiveQuestions(window.PASSPORT_EXTENDED_CATALOG,selections);
 const completed=active.filter(q=>{const a=answers?.[q.id];return !!a?.enabled&&(q.kind==='boolean'?typeof a.value==='boolean':!!(a.brands?.length||(a.other&&String(a.text||'').trim())));}).length;
 return {completed,total:active.length,percent:active.length?Math.round(completed*1000/active.length)/10:null};
};
window.createPassportExtendedInfo=function({changed=()=>{},resize=()=>{}}={}){
 const catalog=window.PASSPORT_EXTENDED_CATALOG;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const contextHtml=path=>{const text=String(path??''),at=text.lastIndexOf('→')+1;return esc(text.slice(0,at))+`<strong style="font-size:inherit;font-weight:700">${esc(text.slice(at))}</strong>`;};
 let answers={},active=[],editing=false,busy=false,expanded=false,revision=null;
 const complete=a=>!!a?.enabled&&(typeof a.value==='boolean'||a.brands?.length>0||(a.other&&String(a.text||'').trim()));
 const styles=`<style>.wm-extended{grid-column:1/-1;min-width:0;padding:0;border:1px solid #cbdfe7;border-radius:12px;background:#fff;overflow:hidden}.wm-extended>summary{display:flex;gap:12px;align-items:center;justify-content:space-between;cursor:pointer;list-style:none;padding:17px 18px;background:#f0f8fc;font-size:15px;font-weight:700;color:#173e55}.wm-extended>summary::-webkit-details-marker{display:none}.wm-extended-heading{display:flex;align-items:center;gap:12px}.wm-extended-arrow{width:8px;height:8px;flex:none;border-right:2px solid #71909e;border-bottom:2px solid #71909e;transform:rotate(-45deg)}.wm-extended[open] .wm-extended-arrow{transform:rotate(45deg)}.wm-extended-count{font-size:12px;font-weight:500;color:#647f8e;white-space:nowrap}.wm-extended-body{padding:16px 18px}.wm-extended-hint{font-size:13px;color:#70838d;margin:0 0 14px;line-height:1.5}.wm-extended-list{display:grid;gap:10px}.wm-extended-question{padding:13px 14px;border:1px solid #dce7ec;border-radius:9px;min-width:0}.wm-extended-question:has(.wm-extended-select:checked){border-color:#8ccbe0;background:#fbfeff}.wm-extended-label{display:flex;gap:10px;align-items:start;cursor:pointer;font-weight:700;font-size:14px;color:#173e55}.wm-extended-label input,.wm-extended-brand input{accent-color:#139cc6;margin-top:3px}.wm-extended-context{display:block;color:#748893;font-size:12px;font-weight:400;line-height:1.5;margin-top:4px}.wm-extended-options{display:flex;gap:8px;flex-wrap:wrap;margin:13px 0 0 24px}.wm-extended-brand{display:flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid #d1e0e6;border-radius:8px;cursor:pointer;font-size:14px;background:white}.wm-extended-brand:has(input:checked){background:#e9f8fd;border-color:#20a4cf}.wm-extended-other{margin:10px 0 0 24px;display:block;font-size:13px;color:#446472}.wm-extended-other textarea{display:block;box-sizing:border-box;width:100%;min-height:68px;margin-top:6px;padding:10px;border:1px solid #c7dce5;border-radius:8px;color:#173e55;background:#fff;resize:vertical;font-family:inherit;font-size:14px}.wm-extended-answer{margin:9px 0 0 24px;font-size:14px;color:#245b72;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.wm-other-filled{display:block;padding:9px 11px;border:1px solid #e7b4b5;border-radius:8px;background:#fff0f0;color:#9a3540}.wm-extended-other.wm-other-filled textarea{border-color:#dba0a6;background:#fffafa;color:#74303a}.wm-extended-answer .wm-other-filled{margin-top:6px}.wm-extended-missing{font-size:12px;color:#8b7044;margin:10px 0 0 24px}.wm-extended summary:focus-visible{outline:2px solid #1598c6;outline-offset:-3px}.wm-extended-question input:disabled{cursor:default}@media(max-width:600px){.wm-extended>summary{align-items:start;flex-direction:column}.wm-extended-count{padding-left:20px}.wm-extended-body{padding:12px}.wm-extended-options,.wm-extended-other{margin-left:0}}
 </style>`;
 function questionHtml(q){
  const a=answers[q.id]||{},disabled=!editing||busy;
  const filledOther=!!a.enabled&&!!a.other&&!!String(a.text||'').trim();
  const title=`<label class="wm-extended-label"><input class="wm-extended-select" type="checkbox" data-wm-question="${esc(q.id)}" aria-label="${esc(q.prompt)}" ${a.enabled?'checked':''} ${disabled?'disabled':''}><span>${esc(q.prompt)}<small class="wm-extended-context">${q.contexts.map(contextHtml).join(' · ')}</small></span></label>`;
  let body='';
  if(q.kind==='boolean'){
   if(a.enabled&&editing)body=`<div class="wm-extended-options">${[[true,'Да'],[false,'Нет']].map(([v,label])=>`<label class="wm-extended-brand"><input type="radio" name="wm-bool-${esc(q.id)}" data-wm-boolean="${esc(q.id)}" value="${v}" ${a.value===v?'checked':''} ${busy?'disabled':''}>${label}</label>`).join('')}</div>`;
   else if(!editing)body=`<div class="wm-extended-answer">${a.enabled&&typeof a.value==='boolean'?(a.value?'Да':'Нет'):'Не заполнено'}</div>`;
  }else if(a.enabled&&editing&&!q.brands.length){body=`<label class="wm-extended-other">Свободный ответ — ${esc(q.label)}<textarea data-wm-other-text="${esc(q.id)}" maxlength="3000" placeholder="Укажите бренды или товары, с которыми работает клиент" ${busy?'disabled':''}>${esc(a.text||'')}</textarea></label>`;}else if(a.enabled&&editing){body=`<div class="wm-extended-options">${q.brands.map(b=>`<label class="wm-extended-brand"><input type="checkbox" data-wm-brand="${esc(q.id)}" value="${esc(b)}" ${(a.brands||[]).includes(b)?'checked':''} ${busy?'disabled':''}>${esc(b)}</label>`).join('')}<label class="wm-extended-brand"><input type="checkbox" data-wm-other="${esc(q.id)}" ${a.other?'checked':''} ${busy?'disabled':''}>Другое</label></div>`;
   if(!q.brands.length)body+=`<p class="wm-extended-missing">${esc(q.emptyOptionsNote||'В исходной таблице бренды не указаны.')}</p>`;
   if(a.other)body+=`<label class="wm-extended-other">${q.kind==='products'?'Другие товары или оборудование':'Другие бренды'} — ${esc(q.label)}<textarea data-wm-other-text="${esc(q.id)}" maxlength="3000" placeholder="Укажите бренды или товары, с которыми работает клиент" ${busy?'disabled':''}>${esc(a.text||'')}</textarea></label>`;
  }else if(!editing){const brands=a.enabled?(a.brands||[]):[];body=`<div class="wm-extended-answer">${brands.length?esc(brands.join(', ')):''}${filledOther?`<span class="wm-other-filled">Другое: ${esc(a.text.trim())}</span>`:''}${!brands.length&&!filledOther?'Не заполнено':''}</div>`;}
  if(filledOther&&editing)body=body.replaceAll('class="wm-extended-other"','class="wm-extended-other wm-other-filled"');
  return `<section class="wm-extended-question" data-wm-question-card="${esc(q.id)}">${title}${body}</section>`;
 }
 function count(){return `Заполнено ${active.filter(q=>complete(answers[q.id])).length} из ${active.length}`;}
 function bodyHtml(){return `<summary><span class="wm-extended-heading"><i class="wm-extended-arrow" aria-hidden="true"></i>Расширенная информация по ТГ и брендам</span><span class="wm-extended-count">${count()}</span></summary><div class="wm-extended-body"><div class="wm-extended-list">${active.map(questionHtml).join('')}</div></div>`;}
 function redraw(){const el=document.getElementById('wm-extended');if(el){el.innerHTML=bodyHtml();resize();}}
 function answer(id){return answers[id]??=( {enabled:false,brands:[],other:false,text:''} );}
 document.addEventListener('toggle',e=>{if(e.target.id==='wm-extended'&&e.target===document.getElementById('wm-extended')){expanded=e.target.open;resize();}},true);
 document.addEventListener('change',e=>{
  if(!editing||busy)return;const el=e.target,id=el.dataset.wmQuestion||el.dataset.wmBrand||el.dataset.wmOther||el.dataset.wmBoolean;if(!id||!active.some(q=>q.id===id))return;
  const a=answer(id);
  if(el.dataset.wmQuestion){a.enabled=el.checked;const q=active.find(q=>q.id===id);if(q.kind!=='boolean'&&!q.brands.length)a.other=true;}
  else if(el.dataset.wmBoolean)a.value=el.value==='true';
  else if(el.dataset.wmOther)a.other=el.checked;
  else {const set=new Set(a.brands);el.checked?set.add(el.value):set.delete(el.value);a.brands=[...set];}
  const focusAttr=el.dataset.wmQuestion?'data-wm-question':el.dataset.wmOther?'data-wm-other':el.dataset.wmBoolean?'data-wm-boolean':'data-wm-brand',focusValue=el.value;
  redraw();const candidates=document.querySelectorAll(`[${focusAttr}]`);[...candidates].find(c=>c.getAttribute(focusAttr)===id&&(!['data-wm-brand','data-wm-boolean'].includes(focusAttr)||c.value===focusValue))?.focus();changed();
 });
 document.addEventListener('input',e=>{const id=e.target.dataset.wmOtherText;if(!id||!editing||busy||!active.some(q=>q.id===id))return;answer(id).text=e.target.value;e.target.closest('.wm-extended-other')?.classList.toggle('wm-other-filled',!!answer(id).enabled&&!!answer(id).other&&!!e.target.value.trim());const countEl=document.querySelector('.wm-extended-count');if(countEl)countEl.textContent=count();changed();});
 return {
  load(value){answers=structuredClone(value?.answers||{});revision=value?.revision??null;},
  snapshot(){return {version:1,answers:structuredClone(answers),activeQuestionIds:active.map(q=>q.id),revision};},
  html(selections,edit,saving){editing=edit;busy=saving;active=window.passportActiveQuestions(catalog,selections);for(const q of active)if(q.kind!=='boolean'&&!q.brands.length&&answers[q.id]?.enabled)answers[q.id].other=true;if(!active.length)return '';return styles+`<details id="wm-extended" class="wm-extended" ${expanded?'open':''}>${bodyHtml()}</details>`;},
  validate(){const missing=active.find(q=>{const a=answers[q.id];return a?.enabled&&(q.kind==='boolean'?typeof a.value!=='boolean':a.other&&!String(a.text||'').trim());});if(!missing)return '';expanded=true;const el=document.getElementById('wm-extended');if(el)el.open=true;return missing.kind==='boolean'?'Выберите «Да» или «Нет» для вопроса о тепловых узлах либо снимите отметку вопроса.':!missing.brands.length?`Заполните свободный ответ для «${missing.label}» или снимите отметку вопроса.`:`Заполните «Другое» для товарной группы «${missing.label}» или снимите этот вариант.`;}
 };
};

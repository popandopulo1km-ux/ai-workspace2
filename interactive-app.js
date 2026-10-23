// All money is in kopecks. Margins are ratios of original totals, not rounded display percentages.
function periodTotals(daily,from,to){
 const totals=new Map();
 for(const [key,,date,amount] of daily.rows)if(date>=from&&date<=to)totals.set(key,(totals.get(key)||0)+amount);
 return totals;
}
function unitTotal(unit,totals){return [...new Set(unit.memberKeys)].reduce((n,k)=>n+(totals.get(k)||0),0);}
function potential(total,current,weight,margin){
 if(!(total>0))return {income:null,reason:'Нет положительного оборота КА'};
 if(!(weight>0&&weight<1))return {income:null,reason:'Нет доли ТГ в выборке счетов'};
 if(!(margin?.turnover>0)||!Number.isFinite(margin.income))return {income:null,reason:'Нет доходности ТГ'};
 if(!Number.isFinite(current))return {income:null,reason:'Нет суммы продаж ТГ'};
 const extra=Math.max(0,weight*total-current);
 return {income:Math.round(extra*margin.income/margin.turnover),extra:Math.round(extra),weight,margin:margin.income/margin.turnover,reason:extra===0?'Средняя доля уже достигнута':''};
}

const potentialWeights={"Вентили":0.13209569240155145,"Черняшка":0.09414548507713608,"Полипропилен напорный":0.08737872886340069,"Фасонина":0.06454915609421813,"Радиаторы все":0.054643556495015184,"Aрматура трубопроводная":0.049180133415840814,"Наружние сети":0.048812644024201546,"Котельное оборудование":0.04808398839266242,"Насосы":0.042946924463177834,"Фитинги":0.03817093638257977,"Бойлеры бытовые":0.02860854980730453,"Гофра,сифоны,обвязки,шланги":0.026492054216275925,"Сшитый полиэтилен":0.02449219535952796,"Изоляция":0.0211915362600464,"Водосчетчики":0.021067819100164503,"Хомуты":0.020349592031482195,"Санфаянс":0.020294264999778978,"Подводка":0.017215298114253957,"Металлопластик":0.015516948831922448,"Смесители":0.014641929423928637,"Фильтры":0.013955494334972007,"Термометры и манометры":0.010927204390456578,"Медь":0.010605039110377665,"Нержавеющая сталь":0.008722071959140685,"Теплосчётчики":0.008664880789535975,"Вентиляция и Кондиционирование":0.00787534254414225,"Инструмент":0.007308543668269472,"Автоматизация тепловых пунктов":0.006681373293962602,"Герметики":0.006452267388172714,"Коллекторы":0.006439601382397263,"Полотенцесушители":0.0038606384668083255,"Водоподготовка":0.0037816956093031234,"Ванны и кабины":0.00277330411292761,"Трапы линейные":0.0008112072421796722,"Теплообменники":0.00033038097431028877,"ХОЗТОВАРЫ":0.000049260689226330325,"Пожарка":0.00002168408147177633,"Бойлеры":0,"Ванные принадлежности (Распродажа и Заказное)":0,"Кафельная плитка (Заказное)":0,"Мебель(Заказное)":0,"Пневматическое оборудование":0,"Прочие":0,"Услуги СЦ":0};
const potentialMargins={"Aрматура трубопроводная":{"turnover":6897640969,"income":2038382155},"Автоматизация тепловых пунктов":{"turnover":4940126270,"income":1003164149},"Бойлеры":{"turnover":484851884,"income":116103178},"Бойлеры бытовые":{"turnover":1127365773,"income":240209513},"Ванны и кабины":{"turnover":304247198,"income":74191370},"Ванные принадлежности (Распродажа и Заказное)":{"turnover":4141592,"income":1271494},"Вентили":{"turnover":9569047330,"income":2685670636},"Вентиляция и Кондиционирование":{"turnover":460347564,"income":128826451},"Водоподготовка":{"turnover":418923683,"income":135442500},"Водосчетчики":{"turnover":1311394013,"income":281697337},"Герметики":{"turnover":153205915,"income":43962613},"Гофра,сифоны,обвязки,шланги":{"turnover":547487796,"income":165104317},"Изоляция":{"turnover":1707699299,"income":540519716},"Инструмент":{"turnover":232472145,"income":76362860},"Кафельная плитка (Заказное)":{"turnover":0,"income":0},"Коллекторы":{"turnover":901311720,"income":291277316},"Котельное оборудование":{"turnover":4376959445,"income":1038085875},"Мебель(Заказное)":{"turnover":28735848,"income":6983554},"Медь":{"turnover":392086303,"income":136314072},"Металлопластик":{"turnover":498129799,"income":154321652},"Наружние сети":{"turnover":6603304477,"income":1806833442},"Насосы":{"turnover":5044562294,"income":1340340521},"Нержавеющая сталь":{"turnover":497673680,"income":140181626},"Пневматическое оборудование":{"turnover":70929469,"income":17575096},"Подводка":{"turnover":457444009,"income":162813674},"Пожарка":{"turnover":115394838,"income":36367014},"Полипропилен напорный":{"turnover":3984735250,"income":1586229366},"Полотенцесушители":{"turnover":378405529,"income":103469623},"Прочие":{"turnover":0,"income":0},"Радиаторы все":{"turnover":13550861823,"income":2934328202},"Санфаянс":{"turnover":2327875456,"income":587272836},"Смесители":{"turnover":1450269343,"income":513554529},"Сшитый полиэтилен":{"turnover":2343196772,"income":850246439},"Теплообменники":{"turnover":1136698909,"income":251578733},"Теплосчётчики":{"turnover":2534521257,"income":466181258},"Термометры и манометры":{"turnover":828796669,"income":238488595},"Трапы линейные":{"turnover":67484079,"income":19794898},"Услуги СЦ":{"turnover":0,"income":0},"Фасонина":{"turnover":3895469887,"income":1213163034},"Фильтры":{"turnover":453213573,"income":171306860},"Фитинги":{"turnover":1109580083,"income":318380056},"ХОЗТОВАРЫ":{"turnover":1899239,"income":273901},"Хомуты":{"turnover":959053549,"income":570646207},"Черняшка":{"turnover":6251422145,"income":1610815860}};
async function loadInteractiveData(){const box=document.querySelector('#app');for(let n=0;n<45;n++){box.textContent='Загрузка отчёта: проверяем доступ к карточкам…';const response=await fetch('/api/admin/interactive/data',{cache:'no-store'});const b=await response.json();if(response.status===202&&b.pending){await new Promise(resolve=>setTimeout(resolve,2000));continue;}if(!response.ok){const message=typeof b.error==='string'?b.error:b.error?.message||b.message||('Ошибка загрузки: '+response.status);box.textContent=message;throw Error(message);}return b;}box.textContent='Проверка доступа заняла слишком много времени. Закройте и повторно откройте отчёт.';throw Error('Report preparation timeout');}
import {defaults,calculatePeriods,economicUnits} from '/api/admin/interactive/periods.mjs';
import {reportSheets,downloadReport,recommendations} from '/api/admin/interactive/export.mjs';
let appliedDates=null;const loadedComments={};
const D=await loadInteractiveData(),daily=D.daily,byKey=new Map(D.clients.map(c=>[c.key,c])),app=document.querySelector('#app');
function mergeBoilers(data,daily,weights,margins){
 const canonical=tg=>tg==='Бойлеры бытовые'?'Бойлеры':tg;
 for(const row of daily.rows)row[1]=canonical(row[1]);
 for(const c of data.clients){
  const parts=c.rows.filter(r=>canonical(r.tg)==='Бойлеры');
  if(parts.length){
   const r={...parts[0],tg:'Бойлеры'};
   for(const f of ['current','prior','currentIncome','priorIncome','lifetime'])r[f]=parts.reduce((n,x)=>n+(x[f]||0),0);
   for(const f of ['expected','buying','past','groupUnknown'])r[f]=parts.some(x=>x[f]);
   r.negativeOnly=parts.every(x=>x.negativeOnly);
   r.basis=parts.flatMap(x=>x.basis||[]);
   r.groupBuys=[...new Set(parts.flatMap(x=>x.groupBuys||[]))];
   r.last=parts.map(x=>x.last||'').sort().at(-1);
   r.partner=null;
   c.rows=c.rows.filter(x=>canonical(x.tg)!=='Бойлеры');c.rows.push(r);
  }
  for(const q of c.questions)q.groups=[...new Set(q.groups.map(canonical))];
 }
 if(data.summary)data.summary=data.summary.filter(x=>x.tg!=='Бойлеры бытовые');
 if(Object.hasOwn(weights,'Бойлеры бытовые')){
  weights['Бойлеры']=(weights['Бойлеры']||0)+weights['Бойлеры бытовые'];
  delete weights['Бойлеры бытовые'];
 }
 if(margins['Бойлеры бытовые']){
  const a=margins['Бойлеры']||{},b=margins['Бойлеры бытовые'];
  margins['Бойлеры']={turnover:(a.turnover||0)+b.turnover,income:(a.income||0)+b.income};
  delete margins['Бойлеры бытовые'];
 }
}

mergeBoilers(D,daily,potentialWeights,potentialMargins);
calculatePeriods(D,daily,defaults);
// Aggregate identity clusters once, irrespective of selected farmer/department.
function groupPurchase(c,r){
 const keys=[...new Set([c.key,...c.groupKeys])],members=keys.map(k=>byKey.get(k));
 const known=!r.groupUnknown&&members.every(m=>m?.known&&Number.isSafeInteger(m.periodTotal));
 const total=members.reduce((n,m)=>n+(m?.periodTotal||0),0),turnover=members.reduce((n,m)=>n+(m?.rows.find(x=>x.tg===r.tg)?.current||0),0);
 const buying=members.some(m=>m?.rows.find(x=>x.tg===r.tg)?.buying);
 return {group:keys.length>1,known,total,turnover,buying,share:total>0?turnover*100/total:0,gap:known&&(total<=0||turnover*100<total*2)};
}
function refreshGroups(){for(const c of D.clients)for(const r of c.rows){r.personalGap=r.gap;r.groupPurchase=groupPurchase(c,r);r.gap=Boolean(r.expected&&r.groupPurchase.gap);}}
refreshGroups();
const dateIds=['period-from','period-to','compare-from','compare-to'];
document.querySelector('header').insertAdjacentHTML('beforeend',`<div class="filters" id="period-filters">${['Сравниваемый период от','Сравниваемый период до','Сравниваем с от','Сравниваем с до'].map((label,i)=>`<label>${label}<input type="date" id="${dateIds[i]}" min="2023-01-01" max="2026-09-30" value="${defaults[i]}" style="display:block"></label>`).join('')}<button id="apply-periods">Сравнить периоды</button></div><small>Доступные продажи: 01.01.2023–30.09.2026 включительно. Порог 2% — за выбранный период.</small>`);
function showPeriodTitle(v){document.querySelectorAll('header > small').forEach(el=>el.remove());}
showPeriodTitle(defaults);
document.querySelector('#apply-periods').insertAdjacentHTML('afterend','<button id="export-excel" hidden>Скачать Excel</button>');
const exportButton=document.querySelector('#export-excel');
for(const id of dateIds)document.querySelector('#'+id).addEventListener('input',()=>{exportButton.hidden=true;document.querySelector('#message').textContent='Даты изменены. Нажмите «Сравнить периоды», чтобы пересчитать отчёт.';});
document.querySelector('#apply-periods').addEventListener('click',()=>{exportButton.hidden=true;try{const dates=dateIds.map(id=>document.querySelector('#'+id).value);calculatePeriods(D,daily,dates);refreshGroups();showPeriodTitle(dates);document.querySelector('#message').textContent='';appliedDates=[...dates];render();exportButton.hidden=false;}catch(e){document.querySelector('#message').textContent=e.message;}});
exportButton.addEventListener('click',()=>{if(!appliedDates||exportButton.hidden)return;exportButton.disabled=true;try{const exportTotals=periodTotals(daily,appliedDates[0],appliedDates[1]);const filters=Object.fromEntries([['Отдел','department'],['Фермер','farmer'],['Сегмент','segment']].map(([label,id])=>[label,document.querySelector('#'+id).selectedOptions[0].textContent]));filters['Поиск клиента']=document.querySelector('#search').value;downloadReport(reportSheets(D,base(),appliedDates,filters,loadedComments,(c,r)=>potential(unitTotal(c,exportTotals),r.current,potentialWeights[r.tg],potentialMargins[r.tg])),appliedDates);}catch(e){document.querySelector('#message').textContent='Не удалось выгрузить Excel: '+e.message;}finally{exportButton.disabled=false;}});
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rub=n=>n==null?'Не подтверждено':(n/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
const cardNames=new Map(D.clients.flatMap(c=>c.cards.map(card=>[card.ref,card.name])));
const linkRef=(ref,title=cardNames.get(ref)||'Открыть карточку контрагента')=>`<a target="_blank" rel="noopener" href="https://crm2.waterman-t.com/crm/${ref.startsWith('CO_')?'company':'contact'}/details/${ref.replace(/^(CO|C)_/,'')}/">${esc(title)}</a>`;
const btn=(title,act,args={})=>`<button class="link" data-act="${act}" data-args="${esc(JSON.stringify(args))}">${esc(title)}</button>`;
const table=(heads,rows)=>`<div class="scroll"><table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')}</tbody></table></div>`;
const cname=c=>btn(c.name,'client',{key:c.key})+`<br><small>${esc(c.farmers.join('; '))}</small>`;
const cat=r=>r.groupBuys.length?'group':r.groupUnknown?'unknown':r.partner?.last?'partner':'need';
const labels={group:'Покупает участник группы',unknown:'История части группы не подтверждена',partner:'Есть продажи через партнёрство',need:'Использует по паспорту, но не покупает у нас'};
let state={view:'home'},history=[];
const visibleDepartments=new Set([22,21,1005,25,27,29,31,32,243,30,33,244,26,28,1044]);
function departmentIds(dep){const ids=new Set([dep]);if(dep)for(let added=true;added;){added=false;for(const d of D.departments)if(ids.has(d.parentId)&&!ids.has(d.id)){ids.add(d.id);added=true;}}return ids;}
function departmentFarmers(){const dep=Number(document.querySelector('#department').value),ids=departmentIds(dep);return D.users.filter(u=>(!dep||u.departments.some(x=>ids.has(Number(x))))&&D.clients.some(c=>c.inBase&&c.passportFilled&&c.farmerIds.includes(u.id)));}
function updateFarmers(){const el=document.querySelector('#farmer'),old=el.value,users=departmentFarmers();el.innerHTML='<option value="">Все фермеры</option>'+users.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('');el.value=users.some(u=>String(u.id)===old)?old:'';}
function selectedClients(){const farmer=Number(document.querySelector('#farmer').value),segment=document.querySelector('#segment').value,search=document.querySelector('#search').value.toLowerCase().trim(),ids=new Set(departmentFarmers().map(u=>u.id));return D.clients.filter(c=>c.inBase&&c.passportFilled&&(!segment||c.segments.includes(segment))&&c.farmerIds.some(id=>ids.has(id)&&(!farmer||id===farmer))&&(!search||(c.name+' '+c.refs.join(' ')).toLowerCase().includes(search)));}
let unitCache=null;
function base(){if(!unitCache)unitCache=economicUnits(D,selectedClients());return unitCache;}
function findUnit(key){return base().find(c=>c.key===key);}
function pairs(){return base().filter(c=>c.known).flatMap(c=>c.rows.map(r=>({c,r})));}
function goto(view,args={}){history.push(state);state={view,...args};render();window.scrollTo(0,0);}
function totals(c){return{fall:c.rows.reduce((n,r)=>n+(r.decline||0),0),net:c.rows.reduce((n,r)=>n+r.currentIncome-r.priorIncome,0)};}
function incompleteNotice(){const missing=base().filter(c=>!c.known);return missing.length?`<section><details><summary>У ${missing.length} групп / самостоятельных КА история не подтверждена полностью — суммы и отсутствие покупок не утверждаются</summary>${missing.map(c=>cname(c)).join('<br>')}</details></section>`:'';}
// Keep the suggested priorities aligned with the selected department/farmer.
const globalSummary=D.summary;
Object.defineProperty(D,'summary',{get(){const p=pairs();return globalSummary.map(s=>({...s,localFall:p.filter(x=>x.r.tg===s.tg).reduce((n,x)=>n+x.r.decline,0)})).sort((a,b)=>b.localFall-a.localFall);}});
function card(title,n,act,args,desc=''){return `<button data-act="${act}" data-args="${esc(JSON.stringify(args))}">${esc(title)}<strong>${n}</strong><small>${esc(desc)}</small></button>`;}
function topDecliningGroups(p){const sums=new Map();for(const {r} of p){if(Number.isFinite(r.decline)&&r.decline>0)sums.set(r.tg,(sums.get(r.tg)||0)+r.decline);}return [...sums].map(([tg,decline])=>({tg,decline})).sort((a,b)=>b.decline-a.decline||a.tg.localeCompare(b.tg,'ru')).slice(0,3);}
function home(){const p=pairs(),g=p.filter(x=>x.r.gap),fall=p.reduce((n,x)=>n+x.r.decline,0),net=p.reduce((n,x)=>n+x.r.currentIncome-x.r.priorIncome,0);return `<section><h2>Где теряем доход</h2><div class="stats"><div>Сумма снижений по группам / самостоятельным КА и ТГ<b>${rub(fall)}</b></div><div>Чистая динамика дохода<b>${rub(net)}</b></div></div><p>${topDecliningGroups(p).length?'Начать с '+topDecliningGroups(p).map(s=>btn(s.tg,'tg',{tg:s.tg,mode:'fall'})+' — '+rub(s.decline)).join('; ')+'.':'Снижения дохода по выбранным условиям нет.'}</p></section><section><h2>Что прорабатывать</h2><div class="cards">${card('По клиентам',new Set(g.map(x=>x.c.key)).size,'signals',{mode:'clients'},'Группа или самостоятельный КА → все товарные группы')}${card('По видам товаров',new Set(g.map(x=>x.r.tg)).size,'signals',{mode:'products'},'Товарная группа → группы и самостоятельные КА')}</div></section><section><h2>Крупнейшие снижения по группам и самостоятельным КА</h2>${fallTable(base().filter(c=>c.known).sort((a,b)=>totals(b).fall-totals(a).fall).slice(0,10))}${btn('Все группы и КА со снижением','fall')}</section>`;}
function shortComment(c){const items=c.refs.map(ref=>D.comments[ref]?.text).filter(t=>t&&!/wazzup24|whatsapp24|\bTPS\b/i.test(t));return items.length?esc(items.join('\n')):'В поле последнего комментария содержательного текста нет. Открыть клиента для проверки ленты.';}
function fallTable(cs){return table(['Группа / самостоятельный КА · фермеры','Сумма снижений дохода','Чистая динамика','Комментарий','За счёт каких ТГ'],cs.map(c=>[cname(c),rub(totals(c).fall),rub(totals(c).net),`<div class="answer">${shortComment(c)}</div>`,c.rows.filter(r=>r.decline>0).sort((a,b)=>b.decline-a.decline).slice(0,3).map(r=>btn(r.tg,'pair',{key:c.key,tg:r.tg})+': '+rub(r.decline)).join('<br>')+'<br>'+btn('Все падения и рост ТГ','client',{key:c.key})]));}
function purchaseSituation(r){
 if(r.groupPurchase?.group)return r.groupPurchase.buying?'Группа покупает ТГ менее чем на 2% оборота — считаем «не покупает»':'У всей группы нет покупок ТГ в текущем периоде';
 if(r.status==='low_share')return 'Доля ТГ ниже 2% — считаем «не покупает»'+(!r.buying?'; в текущем периоде покупок нет':'');
 if(r.status==='earlier')return 'Покупал раньше; в текущем периоде не покупает';
 if(r.status==='returns')return 'В истории есть движения, но покупки не подтверждены (например, возвраты)';
 return 'Покупок в доступной истории нет';
}

function unitLinks(c){const heads=new Set(c.groupHeads||[]);return [...c.refs].sort((a,b)=>Number(heads.has(b))-Number(heads.has(a))).map(ref=>heads.has(ref)?'<b>'+linkRef(ref)+'</b>':linkRef(ref)).join('<br>');}
function detailAction(c,tg,title='Покупки, паспорт и следующее действие'){return '<div style="border-top:1px solid #d9e5eb;margin-top:10px;padding-top:8px">'+btn(title,'pair',{key:c.key,tg}).replace('class="link"','class="link" style="color:#6b7280;text-decoration:underline;font-weight:400"')+'</div>';}

function signalTable(p){
 const grouped=new Map();
 for(const {c,r} of p){if(!grouped.has(c.key))grouped.set(c.key,{c,rows:[]});grouped.get(c.key).rows.push(r);}
 return table(['Группа / самостоятельный КА · фермеры','Товарные группы и ситуация'],[...grouped.values()].map(({c,rows})=>[
  unitLinks(c)+`<br><small>${esc(c.farmers.join('; '))}</small><p><b>${rows.length} ТГ</b></p>`,
  rows.map(r=>`<div class="signal-tg"><b>${btn(r.tg,'pair',{key:c.key,tg:r.tg})}</b><div>${esc(purchaseSituation(r))}</div>${groupPurchaseNote(c,r)}<details><summary>Основание в паспорте</summary>${r.basis.map(b=>`<div>${esc(b.question+': '+[...b.brands,b.other].filter(Boolean).join('; '))}</div>`).join('')}</details>${detailAction(c,r.tg)}</div>`).join('')
 ]));
}
function profiles(){return signalsView({mode:'products'});}
function groupPurchaseNote(c,r){
 if(r.groupPurchase.group){const s=r.groupPurchase;return s.known?`<div><b>По всей группе:</b> оборот ТГ за историю ${rub(s.turnover)} из ${rub(s.total)}; доля ${s.share.toLocaleString('ru-RU',{maximumFractionDigits:4})}%. ${s.buying?(s.share<2?'Покупки есть, но доля ниже 2%.':'Группа покупает ТГ.'):'В текущем периоде покупок ТГ нет.'}</div>`:'<div>История группы проверена не полностью — в список «не покупают» не включена.</div>';}
 const buyers=[...new Set(r.groupBuys)].map(k=>byKey.get(k)).filter(Boolean);
 let text=buyers.length?'<div><b>Покупают участники группы:</b> '+buyers.map(m=>{const f=m.rows.find(x=>x.tg===r.tg);return linkRef(m.refs[0],m.name)+' — оборот '+rub(m.known?f?.current:null);}).join('; ')+'</div>':'<div>У других участников группы покупки этой ТГ не выявлены.</div>';
 if(r.groupUnknown)text+='<div class="muted">Покупки не всех участников удалось проверить. Это не отменяет статус «не покупает» самого клиента.</div>';
 return text;
}
function signalsView(opts={}){
 const a=pairs().filter(x=>x.r.gap&&(!opts.category||cat(x.r)===opts.category)&&(!opts.tg||x.r.tg===opts.tg));
 const products=opts.mode==='products',args={...opts};
 const modes=['clients','products'].map((m,i)=>`<button data-act="signals" data-args="${esc(JSON.stringify({...args,mode:m}))}" ${(products?m==='products':m==='clients')?'class="active" aria-pressed="true"':'aria-pressed="false"'}>${i?'По видам товаров':'По клиентам'}</button>`).join('');
 let content;
 if(products){const groups=new Map();for(const x of a){if(!groups.has(x.r.tg))groups.set(x.r.tg,[]);groups.get(x.r.tg).push(x);}
 const totalsByKey=periodTotals(daily,appliedDates?.[0]||defaults[0],appliedDates?.[1]||defaults[1]);
 const rankedGroups=[...groups].map(([tg,rows])=>({tg,rows,income:rows.reduce((n,{c,r})=>n+(potential(unitTotal(c,totalsByKey),r.current,potentialWeights[tg],potentialMargins[tg]).income||0),0)})).sort((a,b)=>b.income-a.income||a.tg.localeCompare(b.tg,'ru'));
 let totalPotential=0,totalExtra=0,missingPotential=0;
 content=table(['Товарная группа','КА','Потенциальный дополнительный оборот','Потенциальный дополнительный доход'],rankedGroups.map(x=>[x.tg,x.rows]).map(([tg,rows])=>{
  const calculated=rows.map(({c,r})=>({c,r,total:unitTotal(c,totalsByKey),p:potential(unitTotal(c,totalsByKey),r.current,potentialWeights[tg],potentialMargins[tg])}));
  const known=calculated.filter(x=>x.p.income!==null),sum=known.reduce((n,x)=>n+x.p.income,0);totalPotential+=sum;totalExtra+=known.reduce((n,x)=>n+x.p.extra,0);missingPotential+=calculated.length-known.length;
  const detail=table(['Контрагенты','Оборот КА / ТГ','Доп. оборот','Доп. доход'],calculated.map(({c,r,total,p})=>[unitLinks(c)+detailAction(c,tg),rub(total)+'<br><small>По ТГ: '+rub(r.current)+'</small>',p.extra===undefined?'—':rub(p.extra),p.income===null?esc(p.reason):rub(p.income)+(p.reason?'<br><small>'+esc(p.reason)+'</small>':'')]));
  return ['<details class="product-group"><summary><b>'+esc(tg)+'</b></summary>'+detail+'</details>',rows.length,(known.length?rub(known.reduce((n,x)=>n+x.p.extra,0)):'Не рассчитан'),(known.length?rub(sum):'Не рассчитан')+(known.length<rows.length?'<br><small>Рассчитано '+known.length+' из '+rows.length+' КА</small>':'')];
 }));
 const footer='<tfoot id="potential-totals"><tr>'+[
  'Итого ТГ<br><b>'+groups.size+'</b>',
  'Итого КА<br><b>'+new Set(a.map(x=>x.c.key)).size+'</b>',
  'Итого дополнительный оборот<br><b>'+rub(totalExtra)+'</b>',
  'Итого дополнительный доход<br><b>'+rub(totalPotential)+'</b>'
 ].map(x=>'<td style="position:sticky;bottom:0;background:#eaf3f7;border-top:2px solid #bfd2dd;padding:12px;z-index:2">'+x+'</td>').join('')+'</tr></tfoot>';
 const footerAt=content.lastIndexOf('</table></div>');
 content=content.slice(0,footerAt)+footer+content.slice(footerAt);
 }
 else content=signalTable(a);
 return `<section><div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap"><div style="flex:1;min-width:300px"><h2>Использует по паспорту, но не покупает у нас</h2><div class="filters">${modes}</div><p>КА: ${new Set(a.map(x=>x.c.key)).size} · ТГ: ${new Set(a.map(x=>x.r.tg)).size}</p></div><p style="flex:1;min-width:280px;max-width:620px;font-size:12px;line-height:1.5;color:#637f91;margin-top:20px">Потенциальный дополнительный оборот и доход рассчитан на основании среднестатистической доли оборота и дохода ТГ в среднестатистических счетах. Является оценочной величиной.</p></div>${content}</section>`;
}
function groupTable(c,tg){const keys=new Set(c.memberKeys||[...c.groupKeys,c.key]),rows=[...keys].map(k=>byKey.get(k)).filter(Boolean);return table(['Участник','Роль','Личный оборот по ТГ','Личный доход по ТГ','Последняя покупка'],rows.map(m=>{const r=m.rows.find(x=>x.tg===tg);return[m.refs.map(ref=>linkRef(ref,m.name)).join('<br>'),m.refs.some(ref=>c.groupHeads.includes(ref))?'Головной КА':c.memberKeys?.length===1?'Самостоятельный КА':'Участник',rub(m.known?r?.current:null),rub(m.known?r?.currentIncome:null),m.known?esc(r?.last||'Покупок не было'):esc(m.cards.some(x=>x.status==='ambiguous')?'Несколько соответствий в истории продаж':'История не сопоставлена')]}));}
function pair(c,tg){const r=c.rows.find(r=>r.tg===tg),qs=c.questions.filter(q=>q.groups.includes(tg));return `<section><h2>${esc(c.name)} · ${esc(tg)}</h2>${c.refs.map(ref=>linkRef(ref)).join(' · ')}<p>Фермер: ${esc(c.farmers.join('; '))}</p><div class="stats"><div>Оборот ранее<b>${rub(c.known?r.prior:null)}</b></div><div>Оборот сейчас<b>${rub(c.known?r.current:null)}</b></div><div>Падение оборота<b>${rub(c.known?r.turnoverDecline:null)}</b></div><div>Доход ранее<b>${rub(c.known?r.priorIncome:null)}</b></div><div>Доход сейчас<b>${rub(c.known?r.currentIncome:null)}</b></div><div>Падение дохода<b>${rub(c.known?r.priorIncome-r.currentIncome:null)}</b></div></div>${r.gap?`<p><b>Группа / КА не покупает</b>${r.buying?' — покупки есть, но доля ТГ менее 2%':''}.</p>`:''}<h3>Основание в паспорте</h3>${qs.length?qs.map(q=>`<p><b>${esc(q.label)}</b>: ${esc(q.answer)}<br><small>${q.paths.map(esc).join('<br>')}</small></p>`).join(''):'Заполненного активного ответа по этой ТГ нет. Потребность по паспорту не утверждается.'}</section><section><h3>Группа: кто покупает эту ТГ</h3>${groupTable(c,tg)}${r.partner?.last?`<p>Справочно, за 01.10.2025–30.09.2026 (не выбранные периоды): через этого КА как партнёра прошло ${rub(r.partner.turnover)} по ТГ. Не прибавляется повторно к личным покупкам.</p>`:''}<h3>Следующее действие</h3><ol>${recommendations(r).map(item=>`<li>${esc(item)}</li>`).join('')}</ol></section>${commentBlock(c)}`;}
function client(c){return `<section><h2>${esc(c.name)}</h2>${c.refs.map(ref=>linkRef(ref)).join(' · ')}<p>Фермер: ${esc(c.farmers.join('; '))}</p>${c.known?`<div class="stats"><div>Сумма снижений<b>${rub(totals(c).fall)}</b></div><div>Компенсирующий рост<b>${rub(totals(c).fall+totals(c).net)}</b></div><div>Чистая динамика<b>${rub(totals(c).net)}</b></div></div>`:'История клиента не подтверждена; суммы и отсутствие покупок не утверждаются.'}</section>${commentBlock(c)}<section><h3>За счёт каких ТГ изменилась сумма</h3>${table(['ТГ','Доход ранее','Доход сейчас','Динамика дохода','Оборот ранее','Оборот сейчас'],c.rows.filter(r=>r.priorIncome||r.currentIncome||r.expected).sort((a,b)=>(a.currentIncome-a.priorIncome)-(b.currentIncome-b.priorIncome)).map(r=>[btn(r.tg,'pair',{key:c.key,tg:r.tg}),rub(c.known?r.priorIncome:null),rub(c.known?r.currentIncome:null),`<span class="${r.currentIncome-r.priorIncome<0?'neg':'pos'}">${rub(c.known?r.currentIncome-r.priorIncome:null)}</span>`,rub(c.known?r.prior:null),rub(c.known?r.current:null)]))}</section>`;}
function commentBlock(c){const refs=[...new Set(c.refs)],selected=c.groupHeads?.find(r=>refs.includes(r))||refs[0];return `<section><h3>Комментарии по клиенту</h3><label>Контрагент <select id="comment-client">${refs.map(ref=>`<option value="${esc(ref)}" ${ref===selected?'selected':''}>${esc(cardNames.get(ref)||ref)}</option>`).join('')}</select></label><button data-act="comments" data-args="${esc(JSON.stringify({key:c.key}))}">Проверить комментарии в ленте CRM</button><div id="comments-result">Нажмите проверку для загрузки актуальных комментариев.</div></section>`;}
function renderComments(b){const row=x=>`<div class="comment"><b>${linkRef(x.ref,x.name)}</b><p style="white-space:pre-wrap">${esc(x.text)}</p><small>${esc(x.author)} · ${esc(new Date(x.date).toLocaleString('ru-RU',{timeZone:'Asia/Tomsk'}))}</small></div>`;return `<h3>Последний комментарий контрагента</h3>${b.client.map(row).join('')||'Комментариев в ленте нет.'}<h3>Последний комментарий по группе</h3>${b.group.slice(0,1).map(row).join('')||'У других доступных участников группы комментариев за год нет.'}${b.group.length>1?`<details><summary>Развернуть остальные комментарии за год (${b.group.length-1})</summary>${b.group.slice(1).map(row).join('')}</details>`:''}<p><small>${esc(b.notice)}</small></p>`;}
document.addEventListener('change',e=>{if(e.target.id==='comment-client')document.querySelector('#comments-result').textContent='Выбран другой КА. Нажмите проверку комментариев.';});

function tgView(tg){const a=pairs().filter(x=>x.r.tg===tg),f=a.filter(x=>x.r.decline>0).sort((a,b)=>b.r.decline-a.r.decline),g=a.filter(x=>x.r.gap);const threshold=Number(document.querySelector('#threshold')?.value||0);return `<section><h2>${esc(tg)}</h2><p>Сумма снижений дохода ${rub(f.reduce((n,x)=>n+x.r.decline,0))}; чистая динамика ${rub(a.reduce((n,x)=>n+x.r.currentIncome-x.r.priorIncome,0))}.</p><h3>Доход снизился: ${f.length} групп / самостоятельных КА</h3><label>Падение не менее <select id="threshold"><option value="0">Любое</option>${[10,30,50,90].map(n=>`<option value="${n}" ${state.threshold===n?'selected':''}>${n}%</option>`).join('')}</select></label>${table(['Группа / самостоятельный КА','Доход ранее','Доход сейчас','Снижение дохода','Падение оборота','Разбор'],f.filter(x=>!state.threshold||x.r.priorIncome>0&&x.r.decline*100>=x.r.priorIncome*state.threshold).map(({c,r})=>[cname(c),rub(r.priorIncome),rub(r.currentIncome),rub(r.decline),rub(r.turnoverDecline),btn('Группа, паспорт, комментарии','pair',{key:c.key,tg})]))}</section><section><h3>Не покупают: ${g.length} групп / самостоятельных КА</h3>${signalTable(g)}</section>`;}
function render(){unitCache=null;document.querySelector('#nav').innerHTML=[['home','Обзор'],['groups','Все ТГ'],['signals','По клиентам'],['profiles','По видам товаров'],['fall','Группы и КА со снижением']].map(([v,t])=>`<button data-act="${v}" ${state.view===v?'class="active"':''}>${t}</button>`).join('');let h='';if(history.length)h='<div class="crumb"><button data-act="back">← Назад</button></div>';const p=pairs();if(state.view==='home')h+=home()+incompleteNotice();else if(state.view==='groups')h+='<section><h2>Все товарные группы</h2>'+table(['ТГ','Сумма снижений дохода','Не покупают'],D.summary.map(s=>{const a=p.filter(x=>x.r.tg===s.tg);return[btn(s.tg,'tg',{tg:s.tg}),rub(a.reduce((n,x)=>n+x.r.decline,0)),btn(a.filter(x=>x.r.gap).length,'signals',{tg:s.tg})]}))+'</section>';else if(state.view==='profiles')h+=profiles();else if(state.view==='profilesList'){const a=p.filter(x=>x.r.gap&&x.r.tg===state.tg&&x.c.questions.some(q=>q.id===state.id));h+=`<section><h2>${esc(state.label)} · ${esc(state.tg)}</h2><p>Не покупают: ${a.length} групп / самостоятельных КА. Нажмите ТГ в строке для полного пути вопроса и разбора.</p>${signalTable(a)}</section>`;}else if(state.view==='signals')h+=signalsView(state);else if(state.view==='fall')h+='<section><h2>Группы и КА со снижением</h2>'+fallTable(base().filter(c=>c.known&&totals(c).fall>0).sort((a,b)=>totals(b).fall-totals(a).fall))+'</section>';else if(state.view==='client')h+=client(findUnit(state.key));else if(state.view==='pair')h+=pair(findUnit(state.key),state.tg);else if(state.view==='tg')h+=tgView(state.tg);app.innerHTML=h;}
document.querySelector('#department').insertAdjacentHTML('beforeend',D.departments.filter(d=>visibleDepartments.has(d.id)).map(d=>`<option value="${d.id}">${[25,243,244].includes(d.parentId)?'↳ ':''}${esc(d.name)}</option>`).join(''));
document.querySelector('#search').parentElement.insertAdjacentHTML('beforebegin','<label>Сегмент клиента<select id="segment"><option value="">Все сегменты</option></select></label>');
document.querySelector('#segment').insertAdjacentHTML('beforeend',[...new Set(D.clients.filter(c=>c.inBase).flatMap(c=>c.segments))].sort((a,b)=>a.localeCompare(b,'ru')).map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join(''));updateFarmers();
document.addEventListener('click',async e=>{const el=e.target.closest('[data-act]');if(!el)return;const act=el.dataset.act,args=JSON.parse(el.dataset.args||'{}');if(act==='back'){state=history.pop()||{view:'home'};render();return}if(act==='comments'){el.disabled=true;const div=document.querySelector('#comments-result');div.textContent='Проверка ленты…';try{const ref=document.querySelector('#comment-client').value;const response=await fetch('/api/admin/interactive/comments?ref='+encodeURIComponent(ref),{cache:'no-store'});const b=await response.json().catch(()=>({error:'Сервис временно недоступен (HTTP '+response.status+')'}));if(!response.ok||b.error){const error=new Error(response.status===401?'Сессия Битрикс истекла. Обновите подключение к отчёту.':(typeof b.error==='string'?b.error:b.error?.message)||'Не удалось получить комментарии');error.status=response.status;throw error;}if(document.querySelector('#comment-client')?.value===ref){loadedComments[args.key]=b;div.innerHTML=renderComments(b);}}catch(error){div.textContent='Комментарии не получены: '+(error.message||'Нет ответа сервера. Повторите запрос.');if(error.status===401)div.insertAdjacentHTML('beforeend','<p><a target="_top" href="https://crm2.waterman-t.com/devops/placement/578/?interactive=1">Обновить подключение к Битрикс</a></p>');}el.disabled=false;return;}goto(act,args);});
document.addEventListener('change',e=>{if(e.target.id==='threshold'){state.threshold=Number(e.target.value);render();}else if(['farmer','department','segment'].includes(e.target.id)){if(e.target.id==='department')updateFarmers();if(!['home','groups','signals','profiles','fall'].includes(state.view)){state={view:'home'};history=[];}render();}});document.querySelector('#search').addEventListener('input',()=>{state={view:'home'};history=[];render();});render();

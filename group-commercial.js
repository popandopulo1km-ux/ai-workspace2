window.renderPassportCommercialGroup=function(group){
 if(!group||group.status==='member')return '';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(n);
 const num=n=>new Intl.NumberFormat('ru-RU').format(n);
 const style=`<style>
 .commercial-card .commercial-meta,.commercial .commercial-meta{flex:0}
 .wm-overview-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-column:1/-1;gap:12px;align-items:start}
 .wm-overview-stack{display:grid;gap:12px;min-width:0}
 .wm-overview-stack>.overview-card{height:auto}
 .wm-commerce-group{min-width:0;padding:0}
 .wm-commerce-group>summary{display:flex;align-items:center;gap:12px;cursor:pointer;list-style:none;padding:16px}
 .wm-commerce-group>summary::-webkit-details-marker{display:none}
 .wm-commerce-group>summary::before{content:'';width:7px;height:7px;flex:none;border-right:2px solid #668796;border-bottom:2px solid #668796;transform:rotate(-45deg)}
 .wm-commerce-group[open]>summary::before{transform:rotate(45deg)}
 .wm-commerce-group>summary:focus-visible{outline:2px solid #1598c6;outline-offset:-3px;border-radius:10px}
 .wm-commerce-group>summary h2{margin:0;line-height:1.4}
 .wm-commerce-group-body{padding:0 16px 16px}
 .wm-commerce-group p{margin:5px 0 13px;color:#70838e;font-size:13px;line-height:1.5}
 .wm-group-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border:1px solid #d6e7ef;border-radius:9px;overflow:hidden;background:#f3f9fc}
 .wm-group-metric{padding:12px 13px;min-width:0}
 .wm-group-metric:nth-child(even){border-left:1px solid #d6e7ef}
 .wm-group-metric:nth-child(n+3){border-top:1px solid #d6e7ef;background:#fff}
 .wm-group-metric span{display:block;font-size:14px;color:#566f7d;line-height:1.4}
 .wm-group-metric strong{display:block;margin-top:6px;font-size:22px;line-height:1.3;color:#123e5a;font-weight:800;overflow-wrap:anywhere}
 .wm-group-metric:nth-child(n+3) strong{font-size:18px}
 .wm-group-metric small{display:block;font-size:12px;margin-top:5px;color:#728591;line-height:1.4}
 .wm-group-farmers{margin-top:14px}
 .wm-group-farmers summary{display:flex;align-items:center;justify-content:space-between;gap:10px;list-style:none;cursor:pointer;font-size:14px;font-weight:600;color:#146681;padding:9px 0}
 .wm-group-farmers summary::after{content:'⌄';font-size:19px}.wm-group-farmers[open] summary::after{content:'⌃'}
 .wm-group-farmers summary::-webkit-details-marker{display:none}
 .wm-group-person{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:14px;padding:11px 0;border-top:1px solid #e2ebf0;font-size:14px;line-height:1.45}
 .wm-group-person a,.wm-group-link{color:#147b9e;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere}
 .wm-group-person small{display:block;font-size:12px;color:#7a8e99;margin-top:3px}
 .wm-group-person .wm-no-farmer{color:#8c6d3b}
 .wm-commerce-group .wm-group-note{font-size:12px;margin:10px 0 0;color:#768d98}
 .wm-group-unavailable{padding:12px;background:#fff7e8;border-radius:8px;color:#865d20;font-size:14px}
 @media(max-width:760px){.wm-overview-columns{grid-template-columns:1fr}}
 @media(max-width:500px){.wm-group-metric{padding:10px}.wm-group-metric strong{font-size:19px}.wm-group-person{grid-template-columns:1fr;gap:4px}}
 </style>`;
 const panel=body=>style+`<details class="card wm-commerce-group"><summary><h2>Коммерческие данные группы</h2></summary><div class="wm-commerce-group-body">${body}</div></details>`;
 if(group.status!=='ready')return panel('<p class="wm-group-unavailable">Не удалось получить все данные группы. Неполный итог не показывается.</p>');
 const m=group.metrics;
 const farmers=group.cards.map(c=>`<div class="wm-group-person"><div><a href="${esc(c.url)}">${esc(c.name)}</a><small>${c.type==='company'?'Компания':'Контакт'} · ${c.reference===group.head.reference?'Головной':'Участник'}</small></div><div class="${c.farmer?'':'wm-no-farmer'}">${esc(c.farmer?.name||'Фермер не назначен')}</div></div>`).join('');
 return panel(`<p>${group.includeHead?'Головной и все участники':'Все участники без головного'} · карточек: ${num(group.cards.length)}</p><div class="wm-group-metrics"><div class="wm-group-metric"><span>Сейчас в работе</span><strong>${money(m.salesPotentialSum)}</strong><small>Оптовые сделки: ${num(m.wholesaleCount)} · корпоративные продажи: ${num(m.corporateCount)}</small></div><div class="wm-group-metric"><span>В реализации</span><strong>${money(m.inProgressRealizationsSum)}</strong><small>Документов: ${num(m.inProgressRealizationsCount)}</small></div><div class="wm-group-metric"><span>Успешных счетов</span><strong>${num(m.successfulRealizationsCount)}</strong></div><div class="wm-group-metric"><span>Сумма успешных реализаций</span><strong>${money(m.successfulRealizationsSum)}</strong></div></div><details class="wm-group-farmers"><summary>Фермеры по контрагентам · ${num(group.farmerCount)}</summary>${farmers}</details><p class="wm-group-note">Общие документы компании и контакта учитываются один раз. Итог за всю доступную историю.</p>`);
};

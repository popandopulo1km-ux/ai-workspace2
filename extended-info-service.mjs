// Shared persistence for company/contact passports. No separate CRM fields are needed.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const readAssignment = (file, name) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8').replace(new RegExp('^\\s*window\\.' + name + '\\s*=\\s*'), '').replace(/;\s*$/, ''));
export const extendedCatalog = readAssignment('./extended-catalog.js', 'PASSPORT_EXTENDED_CATALOG');
const taxonomy = readAssignment('./taxonomy-data.js', 'PASSPORT_TAXONOMY');
export const legacyLabels = JSON.parse(readFileSync(new URL('./legacy-labels.json', import.meta.url), 'utf8'));
const known = Object.fromEntries(['elementId','elementTypeId','productGroupId','leafId'].map(key => [key, new Set(taxonomy.paths.map(p => p[key]).filter(Boolean))]));
const object = x => x && typeof x === 'object' && !Array.isArray(x);
export function detailEnvelope(value) {
  try { const x = JSON.parse(value || '{}'); return object(x) ? x : { items: Array.isArray(x) ? x : [] }; }
  catch { return { items: String(value || '').split('|').filter(Boolean) }; }
}
export const migrateObjects = values => [...new Set((values || []).map(x => x === 'apartments' ? 'mkd' : x))];
export function activeQuestions(selections) {
  const s = { ...selections, objects: migrateObjects(selections.objects) };
  const ids = new Set(extendedCatalog.triggers.filter(t => (!t.parentElementTypeId || (s.elementTypes || []).includes(t.parentElementTypeId)) && (!t.contourId || (s.contours || []).includes(t.contourId)) && ['object','system','element','elementType'].every((key, i) => !t[key+'Id'] || (s[['objects','systems','elements','elementTypes'][i]] || []).includes(t[key+'Id']))).map(t => t.questionId));
  return extendedCatalog.questions.filter(q => ids.has(q.id));
}
function cleanAnswers(raw) {
  const result = {};
  for (const q of extendedCatalog.questions) {
    const a = raw?.[q.id]; if (!object(a)) continue;
    result[q.id] = q.kind === 'boolean'
      ? { enabled: a.enabled === true, value: typeof a.value === 'boolean' ? a.value : null }
      : { enabled: a.enabled === true, brands: q.brands.filter(b => Array.isArray(a.brands) && a.brands.includes(b)), other: a.other === true || (!q.brands.length && a.enabled === true), text: typeof a.text === 'string' ? a.text.trim().slice(0,3000) : '' };
  }
  return result;
}
const revisionOf = answers => createHash('sha256').update(JSON.stringify(answers)).digest('hex');
export function readExtended(value, selections) {
  const answers = cleanAnswers(detailEnvelope(value).extendedInfo?.answers);
  return { version:1, answers, activeQuestionIds:activeQuestions(selections).map(q=>q.id), revision:revisionOf(answers) };
}
export function saveExtended(value, input, selections) {
  const current = readExtended(value, selections);
  // Old open tabs do not know this section; they must not clear it.
  if (input === undefined) return current;
  if (!object(input) || !object(input.answers)) throw Object.assign(new Error('Некорректные расширенные данные паспорта.'), {status:400,code:'INVALID_EXTENDED_INFO'});
  if (input.revision !== current.revision) throw Object.assign(new Error('Расширенные данные изменились или открыта старая версия паспорта. Обновите страницу; черновик сохранён.'), {status:409,code:'EXTENDED_INFO_CONFLICT'});
  const answers = cleanAnswers(input.answers);
  for (const q of activeQuestions(selections)) {
    const a = answers[q.id]; if (!a?.enabled) continue;
    if (q.kind === 'boolean' ? typeof a.value !== 'boolean' : a.other && !a.text) throw Object.assign(new Error(q.kind === 'boolean' ? 'Выберите «Да» или «Нет» для вопроса о тепловых узлах.' : `Заполните ${q.brands.length?'«Другое»':'свободный ответ'}: ${q.label}.`), {status:400,code:'EXTENDED_ANSWER_REQUIRED'});
  }
  // Keep hidden answers even when a client sends only the visible questions.
  const activeIds = new Set(current.activeQuestionIds);
  for (const [id, a] of Object.entries(current.answers)) if (!Object.hasOwn(answers,id) && !activeIds.has(id)) answers[id]=a;
  const normalized = cleanAnswers(answers);
  return {...current, answers:normalized, revision:revisionOf(normalized)};
}
export function preserveRetiredSelections(previousValue, selections) {
  const previous = detailEnvelope(previousValue);
  selections.objects = migrateObjects(selections.objects);
  for (const [selection,key,oldKey] of [['elementTypes','elementTypeId','items'],['productGroups','productGroupId','productGroups'],['finalItems','leafId','finalItems']]) {
    const retired = (Array.isArray(previous[oldKey]) ? previous[oldKey] : []).filter(id => typeof id === 'string' && !known[key].has(id));
    selections[selection] = [...new Set([...(selections[selection] || []), ...retired])];
  }
  return selections;
}
export function serializeDetail(previousValue, selections, brandNotes, input, extra={}) {
  const previous=detailEnvelope(previousValue);
  preserveRetiredSelections(previousValue,selections);
  const notes = {...(brandNotes === undefined ? previous.brandNotes : brandNotes)};
  for(const [id,note] of Object.entries(previous.brandNotes || {})) if(!known.leafId.has(id)) notes[id]=note;
  return JSON.stringify({...previous,...extra,version:6,items:selections.elementTypes,productGroups:selections.productGroups,finalItems:selections.finalItems,brandNotes:notes,extendedInfo:saveExtended(previousValue,input,selections)});
}
export function extendedExportCells(value,selections) {
  const info=readExtended(value,selections),active=new Set(info.activeQuestionIds);
  return extendedCatalog.questions.map(q=>{
    const a=info.answers[q.id]; if(!active.has(q.id)||!a?.enabled)return '';
    if(q.kind==='boolean')return typeof a.value==='boolean'?(a.value?'Да':'Нет'):'';
    return [...a.brands,...(a.other&&a.text?[`Другое: ${a.text}`]:[])].join('; ');
  });
}

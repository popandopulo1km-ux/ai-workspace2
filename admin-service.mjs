import { salesDepartmentIds } from './sales-departments.mjs';
import {resetUsers} from './passport-integrity.mjs';
import {hasClassificationPassport as hasStructuralAnswers} from './passport-completion.mjs';
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createXlsx } from "./excel-xlsx.mjs";
import { extendedCatalog, extendedExportCells, legacyLabels, migrateObjects, readExtended } from './extended-info-service.mjs';

const objectLabels = { izhs: "ИЖС", apartments: "МКД", mkd: "МКД" };
const workLabels = {
  installation: "Монтаж", commissioning: "Пусконаладка", repair: "Ремонт",
  putting_into_operation: "Ввод в эксплуатацию", technical_solutions: "Технические решения",
};
const contourLabels = { internal: "Внутренние системы", external: "Наружные сети" };
const systemLabels = {
  heating: "Отопление", water_supply: "Водоснабжение", sewerage: "Канализация",
  water_treatment: "Водоподготовка", climate: "Климатика",
  external_water_supply: "Водоснабжение", external_sewerage: "Канализация",
  external_stormwater: "Ливневая канализация", external_wastewater_treatment: "Очистка сточных вод",
  external_heating: "Теплоснабжение", external_gas: "Газоснабжение",
};
const headers = [
  "ID контрагента", "Контрагент", "Фермер", "Группа КА из 1С", "Путь КА из 1С",
  "Статус паспорта", "Последнее заполнение", "Заполненность паспорта, %", "Средняя заполненность выгрузки, %", "Объекты", "Виды работ", "Контуры",
  "Системы", "Элементы системы", "Виды элементов", "Товарные группы",
  "Бренды нашей матрицы", "Другие бренды и товары", "Особенность компании",
  "ФИО связанного контакта", "Телефон связанного контакта", "Роль связанного контакта",
  ...extendedCatalog.questions.map(q=>q.prompt),
];

const fullName = (person) => [person?.lastName, person?.name, person?.secondName].filter(Boolean).join(" ") || `Сотрудник #${person?.id || "?"}`;
const listFrom = (body) => Array.isArray(body?.data) ? body.data : Array.isArray(body?.data?.items) ? body.data.items : Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : [];
const metaFrom = (body) => body?.meta || body?.data?.meta || {};
const farmerIdOf = (value) => {
  const source = Array.isArray(value) ? value[0] : value;
  return Number(source?.id ?? source?.value ?? source) || 0;
};
const hasText = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== "string") return value != null;
  const text = value.trim();
  if (!text) return false;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.length > 0;
    if (parsed && typeof parsed === "object") {
      if (["items", "productGroups", "finalItems", "brandNotes"].some((key) => Object.hasOwn(parsed, key))) {
        return ["items", "productGroups", "finalItems"].some((key) => Array.isArray(parsed[key]) && parsed[key].length > 0)
          || (parsed.brandNotes && typeof parsed.brandNotes === "object" && Object.keys(parsed.brandNotes).length > 0);
      }
      return Object.values(parsed).some((item) => Array.isArray(item) ? item.length > 0 : item && typeof item === "object" ? Object.keys(item).length > 0 : Boolean(item));
    }
  } catch {}
  return true;
};
const parseStored = (value) => {
  if (!value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []; }
  catch { return String(value).split("|").map((item) => item.trim()).filter(Boolean); }
};
const parseDetail = (value) => {
  try {
    const parsed = JSON.parse(value || "{}");
    if (Array.isArray(parsed)) return { items: parsed, productGroups: [], finalItems: [], brandNotes: {} };
    return {
      items: Array.isArray(parsed?.items) ? parsed.items : [],
      productGroups: Array.isArray(parsed?.productGroups) ? parsed.productGroups : [],
      finalItems: Array.isArray(parsed?.finalItems) ? parsed.finalItems : [],
      brandNotes: parsed?.brandNotes && typeof parsed.brandNotes === "object" ? parsed.brandNotes : {},
    };
  } catch { return { items: parseStored(value), productGroups: [], finalItems: [], brandNotes: {} }; }
};
const uniqueJoined = (values) => [...new Set(values.filter(Boolean))].join("; ");

function hasBrandDetails(value) {
  try {
    const answers = JSON.parse(value || "{}")?.extendedInfo?.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) return false;
    return Object.values(answers).some((answer) => {
      if (!answer || typeof answer !== "object" || answer.enabled !== true) return false;
      if (typeof answer.value === "boolean") return true;
      if (Array.isArray(answer.brands) && answer.brands.length > 0) return true;
      return answer.other === true && typeof answer.text === "string" && answer.text.trim().length > 0;
    });
  } catch { return false; }
}

export function questionCompletion(company,fields){
  const selections=Object.fromEntries(['objects','works','contours','systems','elements'].map(key=>[key,parseStored(company?.[fields[key]])]));
  selections.elementTypes=parseDetail(company?.[fields.elementTypes]).items;
  const info=readExtended(company?.[fields.elementTypes],selections);
  const completed=info.activeQuestionIds.filter(id=>{const a=info.answers[id];return !!a?.enabled&&(typeof a.value==='boolean'||a.brands?.length>0||(a.other&&String(a.text||'').trim()));}).length;
  const total=info.activeQuestionIds.length;
  return {completed,total,percent:total?Math.round(completed*1000/total)/10:null};
}
export function hasCompetitorBrandInfo(company,fields){
  const selections=Object.fromEntries(['objects','works','contours','systems','elements'].map(key=>[key,parseStored(company?.[fields[key]])]));
  selections.elementTypes=parseDetail(company?.[fields.elementTypes]).items;
  const info=readExtended(company?.[fields.elementTypes],selections);
  return info.activeQuestionIds.some(id=>{const a=info.answers[id];return !!a?.enabled&&!!a.other&&!!String(a.text||'').trim();});
}
export function passportProgress(company, fields, affiliationField) {
  const blocks = {
    affiliation: typeof company?.[affiliationField] === "string" && company[affiliationField].trim().length > 0,
    specialization: hasClassificationPassport(company, fields),
    brands: questionCompletion(company, fields).completed > 0,
  };
  const status = blocks.specialization && blocks.brands ? "full"
    : blocks.affiliation && blocks.specialization ? "spec_aff"
      : blocks.specialization ? "specialization"
      : blocks.affiliation ? "affiliation"
        : "empty";
  return { blocks, status };
}

// A reset ends the previous passport's history for current-result statistics.
function currentFillEvents(events) {
  const byId = new Map();
  const now = Date.now();
  const ordered = events.filter(event => Number.isFinite(Date.parse(event.at)) && Date.parse(event.at) <= now)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const event of ordered) {
    const id = Number(event.companyId);
    if (event.type === 'reset') byId.delete(id);
    else if (event.type === 'fill') {
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(event);
    }
  }
  return [...byId.values()].flat();
}

export const hasClassificationPassport = hasStructuralAnswers;

export function completionPercent(company, fields, paths) {
  const detail = parseDetail(company?.[fields.elementTypes]);
  const values = {
    objects: parseStored(company?.[fields.objects]),
    works: parseStored(company?.[fields.works]),
    contours: parseStored(company?.[fields.contours]),
    systems: parseStored(company?.[fields.systems]),
    elements: parseStored(company?.[fields.elements]),
    elementTypes: detail.items,
    productGroups: detail.productGroups,
    finalItems: detail.finalItems,
  };
  const applicable = ["objects", "works", "contours"];
  if (values.contours.length) applicable.push("systems");
  if (values.systems.length) applicable.push("elements");
  const selectedSystems = new Set(values.systems);
  const selectedElements = new Set(values.elements);
  const selectedTypes = new Set(values.elementTypes);
  const relevant = paths.filter((path) => !selectedSystems.size || selectedSystems.has(path.systemId));
  if (relevant.some((path) => selectedElements.has(path.elementId) && path.elementTypeId)) applicable.push("elementTypes");
  if (relevant.some((path) => selectedTypes.has(path.elementTypeId) && path.productGroupId)) applicable.push("productGroups");
  if (relevant.some((path) => (selectedTypes.has(path.elementTypeId) || detail.productGroups.includes(path.productGroupId)) && path.leafId)) applicable.push("finalItems");
  const completed = applicable.filter((name) => values[name].length > 0).length;
  return applicable.length ? Math.round(completed * 1000 / applicable.length) / 10 : 0;
}

function phoneValues(contact) {
  const result = [];
  const collect = (value) => {
    if (Array.isArray(value)) return value.forEach(collect);
    if (value && typeof value === "object") return collect(value.value ?? value.VALUE);
    const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    if (text && !result.includes(text)) result.push(text);
  };
  [contact.phone, contact.phoneMobile, contact.phoneWork, contact.phoneMailing].forEach(collect);
  return result;
}

export async function createAdminService({ vibe, fields, segmentField, segmentPathField, companyFeatureField, contactRoleField, farmerField, affiliationField, portalBase, appPublicUrl, taxonomyText, resource = 'companies', relatedCompanies = null }) {
  const isContact = resource === 'contacts';
  const entityName = item => isContact ? fullName(item) : item.title;
  const taxonomy = JSON.parse(taxonomyText.replace(/^\s*window\.PASSPORT_TAXONOMY\s*=\s*/, "").replace(/;\s*$/, ""));
  const paths = Array.isArray(taxonomy.paths) ? taxonomy.paths : [];
  const labelMaps = { elements: new Map(), elementTypes: new Map(), productGroups: new Map(), finalItems: new Map() };
  for(const [name,key] of Object.entries({elements:'elementId',elementTypes:'elementTypeId',productGroups:'productGroupId',finalItems:'leafId'})) for(const [id,label] of Object.entries(legacyLabels[key]||{}))labelMaps[name].set(id,label);
  const finalPaths = new Map();
  for (const path of paths) {
    if (path.elementId) labelMaps.elements.set(path.elementId, path.elementLabel);
    if (path.elementTypeId) labelMaps.elementTypes.set(path.elementTypeId, path.elementTypeLabel);
    if (path.productGroupId) labelMaps.productGroups.set(path.productGroupId, path.productGroupLabel);
    if (path.leafId) {
      labelMaps.finalItems.set(path.leafId, path.finalLabel);
      finalPaths.set(path.leafId, path);
    }
  }
  const eventsPath = isContact ? (process.env.CONTACT_PASSPORT_EVENTS_PATH || '/opt/app/data/contact-passport-events.ndjson') : (process.env.PASSPORT_EVENTS_PATH || "/opt/app/data/passport-events.ndjson");
  async function listAll(path, authorization, limit = 500) {
    const rows = [];
    for (let offset = 0; offset < 10000;) {
      const separator = path.includes("?") ? "&" : "?";
      const body = await vibe(`${path}${separator}limit=${limit}&offset=${offset}`, authorization);
      const page = listFrom(body);
      rows.push(...page);
      const meta = metaFrom(body);
      if (page.length === 0 || meta.hasMore === false || (meta.hasMore == null && page.length < limit)) break;
      offset += page.length;
    }
    return rows;
  }

  async function currentAccess(authorization) {
    const meBody = await vibe("/v1/users/me?select=id,name,lastName,secondName,isAdmin,departmentId", authorization);
    const user = meBody.data || meBody;
    return { allowed: true, user, reason: "Авторизованный пользователь Bitrix24" };
  }

  async function requireAccess(authorization) {
    const access = await currentAccess(authorization);
    if (!access.allowed) throw Object.assign(new Error("Откройте панель из авторизованного Bitrix24."), { status: 403, code: "ADMIN_ACCESS_DENIED" });
    return access;
  }

  async function setupLeftMenu(authorization) {
    await requireAccess(authorization);
    const result = await vibe("/v1/placements/bind", authorization, {
      method: "POST",
      body: JSON.stringify({
        placement: "LEFT_MENU",
        handler: `${appPublicUrl}/admin.html`,
        title: "Управление паспортами",
        options: { iconName: "fa-id-card" },
      }),
    });
    return result.data || result;
  }

  async function readEvents() {
    try {
      return (await readFile(eventsPath, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter((event) => event && event.at);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async function appendEvent(event) {
    await mkdir(dirname(eventsPath), { recursive: true });
    await appendFile(eventsPath, `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`, "utf8");
  }

  async function recordFill(companyId, authorization) {
    const access = await currentAccess(authorization).catch(() => ({ user: {} }));
    await appendEvent({ type: "fill", entityType: isContact ? 'contact' : 'company', companyId: Number(companyId), userId: Number(access.user?.id) || 0, userName: fullName(access.user) });
  }

  async function loadCompanies(authorization, ids = null) {
    const select = ["id", "title", segmentField, segmentPathField, companyFeatureField, farmerField, affiliationField, ...Object.values(fields)];
    if(isContact) { select.splice(select.indexOf('title'),1,'name','lastName','secondName','companyId','companyIds'); }
    const filter = { [farmerField]: { $ne: null } };
    if (Array.isArray(ids) && ids.length > 0) filter.id = { $in: ids };
    const [companiesBody, users, events] = await Promise.all([
      (async()=>{
        const first = await vibe(`/v1/${resource}/search`, authorization, {
        method: "POST",
        body: JSON.stringify({
          filter,
          select,
          sort: "id",
          limit: Math.min(5000, Math.max(1, ids?.length || 5000)),
        }),
        });
        const all=listFrom(first);let more=metaFrom(first).hasMore;
        while(more){
          const page=await vibe(`/v1/${resource}/search`,authorization,{method:'POST',body:JSON.stringify({filter,select,sort:'id',limit:5000,offset:all.length})});
          const rows=listFrom(page);if(!rows.length)throw new Error('Неполная выборка контактов. Повторите загрузку панели.');
          all.push(...rows);more=metaFrom(page).hasMore;
          if(all.length>100000)throw new Error('Превышен размер выборки контактов.');
        }
        return {data:all};
      })(),
      listAll("/v1/users?select=id,name,lastName,secondName,active,departmentId", authorization),
      readEvents(),
    ]);
    const companies = listFrom(companiesBody);
    const departmentsByUser = new Map(users.map(user=>[Number(user.id),salesDepartmentIds(user)]));
    const usersById = new Map(users.map((user) => [Number(user.id), fullName(user)]));
    const lastFill = new Map(), fillDays = new Map();
    for (const event of currentFillEvents(events)) {
      const id = Number(event.companyId);
      lastFill.set(id, event.at);
      // Calendar boundaries in the company's time zone (Tomsk, UTC+7).
      const day = new Date(Date.parse(event.at) + 7 * 3600000).toISOString().slice(0, 10);
      if (!fillDays.has(id)) fillDays.set(id, new Set());
      fillDays.get(id).add(day);
    }
    return companies.map((company) => {
      const farmerId = farmerIdOf(company[farmerField]);
      const filled = hasClassificationPassport(company, fields);
      const progress = passportProgress(company, fields, affiliationField);
      return {
        id: Number(company.id), name: entityName(company) || `Контрагент #${company.id}`,
        segment: String(company[segmentField] || "Не определён"), segmentPath: String(company[segmentPathField] || ""),
        departmentIds: departmentsByUser.get(farmerId)||[],
        farmerId, farmer: usersById.get(farmerId) || (farmerId ? `Сотрудник #${farmerId}` : ""),
        status: progress.status, blocks: progress.blocks,
        fillDays: filled ? [...(fillDays.get(Number(company.id)) || [])] : [],
        updated: progress.status !== "empty" ? lastFill.get(Number(company.id)) || "" : "",
        hasCompetitorBrandInfo: hasCompetitorBrandInfo(company,fields), questions: questionCompletion(company,fields), completion: completionPercent(company, fields, paths), exportable: filled, resettable: filled, raw: company,
      };
    }).filter((company) => company.farmerId > 0);
  }

  function stats(companies, events) {
    const now = Date.now();
    const activeIds = new Set(companies.filter(company => company.exportable && company.farmerId > 0).map(company => company.id));
    const fills = currentFillEvents(events).filter(event => activeIds.has(Number(event.companyId)));
    const countSince = (days) => new Set(fills.filter((event) => now - Date.parse(event.at) <= days * 86400000).map((event) => Number(event.companyId))).size;
    const month = fills.filter((event) => now - Date.parse(event.at) <= 30 * 86400000);
    const companyById = new Map(companies.map((company) => [company.id, company]));
    const leaders = new Map();
    for (const companyId of new Set(month.map((event) => Number(event.companyId)))) {
      const company = companyById.get(companyId);
      if (!company?.farmerId) continue;
      const key = String(company.farmerId);
      leaders.set(key, { id: company.farmerId, name: company.farmer || `Сотрудник #${company.farmerId}`, count: (leaders.get(key)?.count || 0) + 1 });
    }
    return {
      distributed: companies.length, filled: companies.filter((item) => item.exportable).length,
      empty: companies.filter((item) => !item.exportable).length,
      day: countSince(1), week: countSince(7), month: new Set(month.map((event) => Number(event.companyId))).size,
      leaders: [...leaders.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru")).slice(0, 3),
      farmerTotals: [...leaders.values()],
    };
  }

  async function overview(authorization) {
    const access = await requireAccess(authorization);
    const [companies, events] = await Promise.all([loadCompanies(authorization), readEvents()]);
    return { access: { reason: access.reason, user: fullName(access.user), canReset:resetUsers.has(Number(access.user.id)) }, stats: stats(companies, events), companies: companies.map(({ raw, ...company }) => ({...company,resettable:company.resettable&&resetUsers.has(Number(access.user.id))})), trackingStarted: "2026-08-28" };
  }

  async function resetPassport(companyId, authorization) {
    const access = await requireAccess(authorization);
    if(!resetUsers.has(Number(access.user.id)))throw Object.assign(new Error("Сброс паспорта доступен только семи назначенным сотрудникам."),{status:403,code:"PASSPORT_RESET_DENIED"});
    const select = ["id", ...(isContact ? ['name','lastName','secondName'] : ['title']), companyFeatureField, ...Object.values(fields)].join(",");
    const beforeBody = await vibe(`/v1/${resource}/${companyId}?select=${encodeURIComponent(select)}`, authorization);
    const before = beforeBody.data || beforeBody;
    if (!hasClassificationPassport(before, fields)) throw Object.assign(new Error("Классификационная часть паспорта уже пуста."), { status: 409, code: "PASSPORT_ALREADY_EMPTY" });
    const update = Object.fromEntries(Object.entries(fields).filter(([name]) => name !== "elementTypes").map(([, field]) => [field, JSON.stringify([])]));
    update[fields.elementTypes] = JSON.stringify({ version: 5, items: [], productGroups: [], finalItems: [], brandNotes: {} });
    await vibe(`/v1/${resource}/${companyId}`, authorization, { method: "PATCH", body: JSON.stringify(update) });
    const afterBody = await vibe(`/v1/${resource}/${companyId}?select=${encodeURIComponent(select)}`, authorization);
    const after = afterBody.data || afterBody;
    if (after[companyFeatureField] !== before[companyFeatureField]) throw Object.assign(new Error("Защитная проверка обнаружила изменение поля «Особенность компании». Обратитесь к администратору."), { status: 500, code: "RESET_PRESERVATION_FAILED" });
    if (hasClassificationPassport(after, fields)) throw Object.assign(new Error("Не все классификационные поля удалось очистить."), { status: 500, code: "RESET_INCOMPLETE" });
    await appendEvent({ type: "reset", companyId: Number(companyId), companyName: before.title || "", userId: Number(access.user.id) || 0, userName: fullName(access.user), preservedCompanyFeature: true, contactRolesTouched: false });
    return { id: Number(companyId), status: "empty", preserved: { companyFeature: true, contactRoles: true } };
  }

  const labelsFor = (ids, map) => uniqueJoined(ids.map((id) => map.get(id) || id));
  async function contactsForCompanies(companyIds, authorization) {
    const result = new Map(companyIds.map((id) => [Number(id), []]));
    const select = ["id", "name", "lastName", "secondName", "phone", "companyId", contactRoleField];
    for (let index = 0; index < companyIds.length; index += 200) {
      const chunk = companyIds.slice(index, index + 200).map(Number);
      const body = await vibe("/v1/contacts/search", authorization, {
        method: "POST",
        body: JSON.stringify({ filter: { companyId: { $in: chunk } }, select, sort: "id", limit: 5000, offset: 0 }),
      });
      for (const contact of listFrom(body)) {
        const companyId = farmerIdOf(contact.companyId);
        if (!result.has(companyId)) continue;
        result.get(companyId).push({
          name: fullName(contact),
          phone: phoneValues(contact).join(", "),
          role: typeof contact[contactRoleField] === "string" ? contact[contactRoleField].trim() : "",
        });
      }
    }
    return result;
  }

  async function exportPassports(ids, authorization, { asRows = false } = {}) {
    await requireAccess(authorization);
    const requested = Array.isArray(ids) ? new Set(ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)) : null;
    const [companies, events] = await Promise.all([loadCompanies(authorization, requested ? [...requested] : null), readEvents()]);
    const selected = companies.filter((company) => company.exportable && (!requested || requested.has(company.id)));
    if (!selected.length && asRows) return { rows: [] };
    if (selected.length === 0) throw Object.assign(new Error("Нет заполненных паспортов для экспорта."), { status: 409, code: "NOTHING_TO_EXPORT" });
    const contacts = isContact ? new Map() : await contactsForCompanies(selected.map((company) => company.id), authorization);
    if(isContact)for(let i=0;i<selected.length;i+=4)await Promise.all(selected.slice(i,i+4).map(async item=>{contacts.set(item.id,(await relatedCompanies(item.raw,authorization)).map(c=>({name:c.title,phone:c.phone,role:c.feature})));}));
    const lastFill = new Map();
    for (const event of currentFillEvents(events)) lastFill.set(Number(event.companyId), event.at);
    const averageCompletion = Math.round(selected.reduce((sum, company) => sum + company.completion, 0) * 10 / selected.length) / 10;
    const rows = selected.map((company) => {
      const raw = company.raw;
      const detail = parseDetail(raw[fields.elementTypes]);
      const linkedContacts = contacts.get(company.id) || [];
      const notes = Object.entries(detail.brandNotes).map(([id, note]) => {
        const path = finalPaths.get(id);
        const label = [path?.systemLabel, path?.elementLabel, path?.elementTypeLabel, path?.productGroupLabel, path?.finalLabel].filter(Boolean).join(" → ") || labelMaps.finalItems.get(id) || id;
        return `${label}: ${String(note).trim()}`;
      }).filter((item) => !item.endsWith(":"));
      const matrixBrands = detail.finalItems.filter(id=>!finalPaths.get(id)?.isOtherBrand).map(id=>finalPaths.get(id)?.finalLabel||labelMaps.finalItems.get(id)||id);
      return [
        company.id, company.name, company.farmer, company.segment, company.segmentPath, "Паспорт заполнен", lastFill.get(company.id) || company.updated,
        company.completion, averageCompletion,
        labelsFor(migrateObjects(parseStored(raw[fields.objects])), new Map(Object.entries(objectLabels))), labelsFor(parseStored(raw[fields.works]), new Map(Object.entries(workLabels))),
        labelsFor(parseStored(raw[fields.contours]), new Map(Object.entries(contourLabels))), labelsFor(parseStored(raw[fields.systems]), new Map(Object.entries(systemLabels))),
        labelsFor(parseStored(raw[fields.elements]), labelMaps.elements), labelsFor(detail.items, labelMaps.elementTypes), labelsFor(detail.productGroups, labelMaps.productGroups),
        uniqueJoined(matrixBrands), uniqueJoined(notes), String(raw[companyFeatureField] || ""),
        uniqueJoined(linkedContacts.map((contact) => contact.name)),
        uniqueJoined(linkedContacts.map((contact) => contact.phone)),
        uniqueJoined(linkedContacts.map((contact) => contact.role)),
        ...extendedExportCells(raw[fields.elementTypes],{objects:parseStored(raw[fields.objects]),systems:parseStored(raw[fields.systems]),elements:parseStored(raw[fields.elements]),elementTypes:detail.items}),
      ];
    });
    const exportHeaders = isContact ? headers.map(label=>({'ID контрагента':'ID контакта','Контрагент':'ФИО контакта','Особенность компании':'Роль контакта','ФИО связанного контакта':'Название связанной компании','Телефон связанного контакта':'Телефон связанной компании','Роль связанного контакта':'Особенность связанной компании'}[label]||label)) : headers;
    if (asRows) return { rows, headers: exportHeaders };
    return { buffer: createXlsx(exportHeaders, rows), count: rows.length, filename: isContact ? 'Паспорта_контактов.xlsx' : requested ? "Паспорта_выбранных_КА.xlsx" : "Все_заполненные_паспорта.xlsx" };
  }

  async function patternInputs(authorization){
    await requireAccess(authorization);
    return (await loadCompanies(authorization)).map(item=>{
      const selections=Object.fromEntries(['objects','works','contours','systems','elements'].map(k=>[k,parseStored(item.raw[fields[k]])]));
      selections.elementTypes=parseDetail(item.raw[fields.elementTypes]).items;
      return {farmerId:item.farmerId,ref:(isContact?'C_':'CO_')+item.id,key:(isContact?'contact:':'company:')+item.id,selections,info:readExtended(item.raw[fields.elementTypes],selections)};
    });
  }
  return { currentAccess, overview, patternInputs, resetPassport, exportPassports, recordFill, setupLeftMenu };
}

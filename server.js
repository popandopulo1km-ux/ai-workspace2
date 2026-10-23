import {segmentFromPath} from './passport-segment.mjs';
import {createHoldingService} from './holding-service.mjs';
import {createProtectedVibe,passportContext,lastPassportEdit} from './passport-integrity.mjs';
import {createInteractiveReport} from './interactive-service.mjs';
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import {createGroupSpecializationService,specializationFields} from "./group-specialization-service.mjs";
import { randomBytes } from "node:crypto";
import { createAdminService, hasClassificationPassport, passportProgress, completionPercent } from "./admin-service.mjs";
import { createContactService, contactMetadata,passportRevision,assertPassportVersion,archivePassport,withPassportWriteLock } from './contact-service.mjs';
import { createUnifiedAdminService } from './unified-admin.mjs';
import { createParentService, headField } from './parent-service.mjs';
import { createCommercialService } from './commercial-service.mjs';
import {createReportRecommendations} from './report-recommendations.mjs';
import { createHistoryService } from './history-backend.mjs';
import {createPatternService} from './passport-patterns.mjs';
import { createCompanyLinks } from './company-links.mjs';
import { readExtended, serializeDetail, migrateObjects } from './extended-info-service.mjs';

const port = Number(process.env.PORT || 3000);
const apiBase = (process.env.VIBE_API_BASE || "https://vibecode.bitrix24.tech").replace(/\/$/, "");
const vibeAppKey = process.env.VIBE_APP_KEY || "";
const portalBase = (process.env.BITRIX_PORTAL_URL || "https://crm2.waterman-t.com").replace(/\/$/, "");
const appPublicUrl = (process.env.APP_PUBLIC_URL || "https://app-8e2a6836a058.vibecode.bitrix24.tech").replace(/\/$/, "");
const indexHtml = await readFile(new URL("./index.html", import.meta.url), "utf8");
const reportBridgeJs = await readFile(new URL('./report-bridge.js',import.meta.url),'utf8');
const adminHtml = await readFile(new URL("./admin.html", import.meta.url), "utf8");
const contactHtml = await readFile(new URL('./contact.html', import.meta.url), 'utf8');
const taxonomyData = await readFile(new URL("./taxonomy-data.js", import.meta.url), "utf8");
const holdingUi = await readFile(new URL('./holding-ui.js',import.meta.url),'utf8');
const parentUi = await readFile(new URL('./parent-ui.js', import.meta.url), 'utf8');
const historyAssets=Object.fromEntries(await Promise.all(['history.js','history.css','purchase-summary.mjs','purchase-summary.css','comparison.mjs','purchase-mapping.json'].map(async f=>['/'+f,await readFile(new URL('./'+f,import.meta.url),'utf8')])));
const extendedAssets = Object.fromEntries(await Promise.all(['extended-catalog.js','extended-info.js','group-commercial.js'].map(async file=>['/'+file,await readFile(new URL('./'+file,import.meta.url),'utf8')])));
const taxonomyPaths = (() => {
  try {
    const parsed = JSON.parse(taxonomyData.replace(/^\s*window\.PASSPORT_TAXONOMY\s*=\s*/, "").replace(/;\s*$/, ""));
    return Array.isArray(parsed.paths) ? parsed.paths : [];
  } catch { return []; }
})();

const fields = {
  objects: "ufCrmWmPassportObjects",
  works: "ufCrmWmPassportWorks",
  contours: "ufCrmWmPassportContours",
  systems: "ufCrmWmPassportSystems",
  elements: "ufCrmWmPassportElements",
  elementTypes: "ufCrmWmPassportElementTypes",
};

const segmentField = "ufCrm_1785825401";
const segmentPathField = "ufCrm_1785825564";
const companyFeatureField = "ufCrmWmPassportCompanyFeature";
const contactRoleField = "ufCrmWmPassportContactRole";
const commercialFields = {
  dealsSum: "ufCrmWelcmDealssum",
  dealsCount: "ufCrmWelcmDealscount",
  farmer: "ufCrm_1782369491",
  coreTail: "ufCrm_1782358926",
};
const passportState = (card) => ({
  ...passportProgress(card, fields, headField),
  completion: completionPercent(card, fields, taxonomyPaths),
});
const realization = {
  entityTypeId: 1062,
  successStageId: "DT1062_13:SUCCESS",
  inProgressStageIds: [
    "DT1062_13:NEW",
    "DT1062_13:PREPARATION",
    "DT1062_13:CLIENT",
    "DT1062_13:UC_LOFUNR",
  ],
};
const salesPotential = {
  wholesaleCategoryId: 5,
  corporateEntityTypeId: 1048,
  corporateInProgressStageIds: [
    "DT1048_9:NEW",
    "DT1048_9:PREPARATION",
    "DT1048_9:CLIENT",
    "DT1048_9:UC_11CCP6",
    "DT1048_9:UC_EKDNQ6",
  ],
};
const companyPhoneFields = ["phone", "phoneMobile", "phoneWork", "phoneMailing"];
const installerSegment = "САНТЕХМОНТАЖНИКИ";
const supportedSegments = new Set([
  "-Поставщики",
  installerSegment,
  "ОРГ-ЦИИ, ОБСЛУЖИВАЮЩИЕ ЖИЛЬЕ",
  "ПЕРЕПРОДАВЦЫ",
  "СТРОИТЕЛИ",
  "Физ. лица со скидками",
  "Физические лица",
  "Юр. лица (конечные потребители)",
]);
const excludedSegments = new Set([
  "БУХГАЛТЕРИЯ",
  "ДИЗАЙНЕР ПРОЕКТИРОВЩИКИ",
  "ДИЗАЙНЕРЫ ПРОЕКТИРОВЩИКИ",
  "КЛИЕНТЫ РЕОН",
  "УДАЛЕННЫЕ",
  "WEB",
  "ЯПОТЕРЯННЫЕ",
]);

const allowed = {
  objects: new Set(["izhs", "apartments", "mkd"]),
  works: new Set([
    "installation",
    "commissioning",
    "repair",
    "putting_into_operation",
    "technical_solutions",
  ]),
  contours: new Set(["internal", "external"]),
  systems: new Set([
    "heating",
    "water_supply",
    "sewerage",
    "climate",
    "water_treatment",
    "external_water_supply",
    "external_sewerage",
    "external_stormwater",
    "external_wastewater_treatment",
    "external_heating",
    "external_gas",
  ]),
};

const dynamicValuePatterns = {
  elements: /^(?:e_[a-f0-9]{12}|[a-z0-9_]+:[a-z0-9_]+)$/,
  elementTypes: /^(?:t_[a-f0-9]{12}|[a-z0-9_]+:[a-z0-9_]+:[a-z0-9_]+)$/,
  productGroups: /^g_[a-f0-9]{12}$/,
  finalItems: /^l_[a-f0-9]{12}$/,
};

function sendJson(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function parseStored(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return String(value)
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function parseDetailState(value) {
  if (!value) return { elementTypes: [], productGroups: [], finalItems: [], brandNotes: {} };
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return { elementTypes: parsed.filter((item) => typeof item === "string"), productGroups: [], finalItems: [], brandNotes: {} };
    }
    if (parsed && typeof parsed === "object") {
      return {
        elementTypes: Array.isArray(parsed.items) ? parsed.items.filter((item) => typeof item === "string") : [],
        productGroups: Array.isArray(parsed.productGroups) ? parsed.productGroups.filter((item) => typeof item === "string") : [],
        finalItems: Array.isArray(parsed.finalItems) ? parsed.finalItems.filter((item) => typeof item === "string") : [],
        brandNotes: parsed.brandNotes && typeof parsed.brandNotes === "object" && !Array.isArray(parsed.brandNotes)
          ? parsed.brandNotes
          : {},
      };
    }
  } catch {}
  return { elementTypes: parseStored(value), productGroups: [], finalItems: [], brandNotes: {} };
}

function cleanBrandNotes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, note] of Object.entries(value).slice(0, 100)) {
    if (!/^l_[a-f0-9]{12}$/.test(key) || typeof note !== "string") continue;
    const cleaned = note.trim().slice(0, 300);
    if (!cleaned) continue;
    const candidate = { ...result, [key]: cleaned };
    if (JSON.stringify(candidate).length > 3500) break;
    result[key] = cleaned;
  }
  return result;
}


// Current taxonomy identifiers are authoritative; legacy identifiers remain readable.
// Do not silently discard approved IDs merely because their format evolved.
const taxonomySelectionIds = Object.fromEntries(
  Object.entries({elements:'elementId',elementTypes:'elementTypeId',productGroups:'productGroupId',finalItems:'leafId'})
    .map(([key,field])=>[key,new Set(taxonomyPaths.map(row=>row[field]).filter(value=>typeof value==='string'&&value))])
);

function cleanSelection(name, value) {
  if (!Array.isArray(value)) return [];
  if (dynamicValuePatterns[name]) {
    return [...new Set(value.filter((item) =>
      typeof item === "string"
      && (taxonomySelectionIds[name]?.has(item) || dynamicValuePatterns[name].test(item))
    ))].slice(0, 300);
  }
  return [...new Set(value.filter((item) => typeof item === "string" && allowed[name].has(item)))];
}

function resolveSegment(path) { return segmentFromPath(path); }

function authHeader(request) {
  const forwarded = request.headers["x-vibe-authorization"];
  return typeof forwarded === "string" && forwarded.startsWith("Bearer ") ? forwarded : null;
}

const adminSessions = new Map();
const adminSessionTtlMs = 20 * 60_000;
const passportSessions = new Map();
const passportSessionTtlMs = 2 * 60 * 60_000;

function cookieValue(request, name) {
  const source = typeof request.headers.cookie === "string" ? request.headers.cookie : "";
  for (const part of source.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function createAdminSession(authorization) {
  const now = Date.now();
  for (const [token, session] of adminSessions) {
    if (session.expiresAt <= now) adminSessions.delete(token);
  }
  const token = randomBytes(24).toString("base64url");
  adminSessions.set(token, { authorization, expiresAt: now + adminSessionTtlMs });
  return token;
}

function adminAuthorization(request) {
  const direct = authHeader(request);
  if (direct) return direct;
  const token = cookieValue(request, "wm_passport_admin");
  const session = token ? adminSessions.get(token) : null;
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + adminSessionTtlMs;
  return session.authorization;
}

function createPassportSession(authorization) {
  const now = Date.now();
  for (const [token, session] of passportSessions) {
    if (session.expiresAt <= now) passportSessions.delete(token);
  }
  const token = randomBytes(24).toString("base64url");
  passportSessions.set(token, { authorization, expiresAt: now + passportSessionTtlMs });
  return token;
}

function passportAuthorization(request) {
  const direct = authHeader(request);
  if (direct) return direct;
  const token = cookieValue(request, "wm_passport_session");
  const session = token ? passportSessions.get(token) : null;
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    passportSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + passportSessionTtlMs;
  return session.authorization;
}

function normalizePhones(contact) {
  const values = [];
  const collect = (input) => {
    if (Array.isArray(input)) {
      input.forEach(collect);
      return;
    }
    if (input && typeof input === "object") {
      collect(input.value ?? input.VALUE ?? input.phone ?? input.PHONE);
      return;
    }
    if (typeof input === "string" && input.trim()) values.push(input.trim());
  };
  [contact.phone, contact.phoneMobile, contact.phoneWork, contact.phoneMailing, contact.fm].forEach(collect);
  return [...new Set(values)];
}

function isDummyPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 6) return false;
  const local = digits.length > 7 && /^[78]/.test(digits) ? digits.slice(1) : digits;
  if (/^(\d)\1{5,}$/.test(local)) return true;
  if (local.length < 7) return false;
  const ascending = [...local].every((digit, index) => index === 0 || Number(digit) === (Number(local[index - 1]) + 1) % 10);
  const descending = [...local].every((digit, index) => index === 0 || Number(digit) === (Number(local[index - 1]) + 9) % 10);
  return ascending || descending;
}

function phoneStatus(value) {
  if (isDummyPhone(value)) return "dummy";
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 0 && digits.length < 10 ? "invalid" : "valid";
}

function displayName(person) {
  return [person?.lastName, person?.name, person?.secondName].filter(Boolean).join(" ");
}

const vibe=createProtectedVibe(rawVibe);
async function rawVibe(path, authorization, options = {}) {
  if (!vibeAppKey) {
    throw Object.assign(new Error("Не настроен ключ OAuth-приложения."), {
      status: 500,
      code: "APP_KEY_NOT_CONFIGURED",
    });
  }
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(30000),
    headers: {
      "x-api-key": vibeAppKey,
      authorization,
      "content-type": "application/json; charset=utf-8",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  if (!response.ok || body?.success === false) {
    const error = new Error(body?.error?.message || body?.message || `WebCode API: ${response.status}`);
    error.status = response.status;
    error.code = body?.error?.code;
    throw error;
  }
  return body;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256 * 1024) throw Object.assign(new Error("Слишком большой запрос"), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const adminService = await createAdminService({
  vibe,
  fields,
  segmentField,
  segmentPathField,
  companyFeatureField,
  contactRoleField,
  affiliationField: headField,
  farmerField: commercialFields.farmer,
  portalBase,
  appPublicUrl,
  taxonomyText: taxonomyData,
});

const companyLinks = createCompanyLinks({vibe});
async function getLinkedContacts(companyId, authorization) {
  const raw = await companyLinks.contacts(companyId,['name','lastName','secondName','post','phone',contactRoleField],authorization);
  return raw.map(contact=>{
    const post=typeof contact.post==='string'?contact.post.trim():'';
    const phones=normalizePhones(contact), statuses=phones.map(phoneStatus);
    return {id:contact.id,name:displayName(contact)||`Контакт #${contact.id}`,post:post||'Должность не указана',postMissing:!post,
      role:typeof contact[contactRoleField]==='string'?contact[contactRoleField]:'',
      phone:phones.map((phone,i)=>statuses[i]==='dummy'?'номер-пустышка!!!':statuses[i]==='invalid'?'Обнаружены некорректно внесенные номера телефона!':phone),
      hasDummyPhone:statuses.includes('dummy'),hasInvalidPhone:statuses.includes('invalid'),url:`${portalBase}/crm/contact/details/${contact.id}/`};
  });
}
async function getPassport(companyId, authorization, {core=false} = {}) {
  const select = [
    "id",
    "title",
    segmentField,
    segmentPathField,
    companyFeatureField,
    headField,
    ...Object.values(fields),
    ...Object.values(commercialFields),
    ...companyPhoneFields,
  ].join(",");
  const companyResponse = await vibe(`/v1/companies/${companyId}?select=${encodeURIComponent(select)}`, authorization);
  const company = companyResponse.data || companyResponse;

  let contacts = [];
  const contactsPromise = (async () => {
    const contactResponse = {data: await companyLinks.contacts(companyId,['name','lastName','secondName','post','phone',contactRoleField],authorization)};
    return (contactResponse.data || []).map((contact) => {
      const post = typeof contact.post === "string" ? contact.post.trim() : "";
      const phones = normalizePhones(contact);
      const statuses = phones.map(phoneStatus);
      return {
        id: contact.id,
        name: displayName(contact) || `Контакт #${contact.id}`,
        post: post || "Должность не указана",
        postMissing: !post,
        role: typeof contact[contactRoleField] === "string" ? contact[contactRoleField] : "",
        phone: phones.map((phone, index) => statuses[index] === "dummy"
          ? "номер-пустышка!!!"
          : statuses[index] === "invalid"
            ? "Обнаружены некорректно внесенные номера телефона!"
            : phone),
        hasDummyPhone: statuses.includes("dummy"),
        hasInvalidPhone: statuses.includes("invalid"),
        url: `${portalBase}/crm/contact/details/${contact.id}/`,
      };
    });
  })().catch((error) => {
    console.warn("Unable to load company contacts", error.code || error.message);
    return [];
  });

  const requisitesPromise = vibe(
    `/v1/requisites?filter%5BentityTypeId%5D=4&filter%5BentityId%5D=${companyId}&select=id,name,active,sort,rqName,rqCompanyFullName&limit=50`,
    authorization,
  ).then((response) => {
    const requisites = Array.isArray(response.data) ? response.data : [];
    const ordered = [...requisites].sort((a, b) => Number(b.active) - Number(a.active) || Number(a.sort || 500) - Number(b.sort || 500));
    return ordered.map((item) => item.rqCompanyFullName || item.rqName).find((value) => typeof value === "string" && value.trim())?.trim() || null;
  }).catch((error) => {
    console.warn("Unable to load company requisites", error.code || error.message);
    return null;
  });

  const farmerId = Number(company[commercialFields.farmer]);
  const farmerPromise = Number.isSafeInteger(farmerId) && farmerId > 0
    ? vibe(`/v1/users/${farmerId}?select=id,name,lastName,secondName`, authorization)
      .then((response) => displayName(response.data || response) || null)
      .catch((error) => {
        console.warn("Unable to load company farmer", error.code || error.message);
        return null;
      })
    : Promise.resolve(null);

  const realizationSummaryPromise = core ? Promise.resolve({inProgressCount:0,inProgressSum:0,lastSuccessfulDate:null,unavailable:true}) : (async () => {
    const aggregate = [
      { field: "*", function: "count" },
      { field: "opportunity", function: "sum" },
    ];
    const inProgressResponse = await vibe(`/v1/items/${realization.entityTypeId}/aggregate`, authorization, {
      method: "POST",
      body: JSON.stringify({
        aggregate,
        filter: { companyId: Number(companyId), stageId: realization.inProgressStageIds },
      }),
    });
    const inProgressAggregate = inProgressResponse.data || {};
    if (inProgressAggregate.meta?.truncated) {
      throw Object.assign(new Error("Realization aggregate is truncated"), { code: "AGGREGATE_TRUNCATED" });
    }
    const inProgressCount = Number(inProgressAggregate.count) || 0;
    const inProgressSum = Number(inProgressAggregate.aggregates?.opportunity?.sum) || 0;
    if (inProgressCount > 0) {
      return {
        inProgressCount,
        inProgressSum,
        lastSuccessfulDate: null,
        unavailable: false,
      };
    }

    const latestResponse = await vibe(`/v1/items/${realization.entityTypeId}/search`, authorization, {
      method: "POST",
      body: JSON.stringify({
        filter: {
          companyId: Number(companyId),
          stageId: realization.successStageId,
        },
        select: ["id", "movedTime"],
        sort: "-movedTime",
        limit: 1,
        autoWindow: false,
        withTotal: false,
      }),
    });
    const latestItem = Array.isArray(latestResponse.data) ? latestResponse.data[0] : null;
    return {
      inProgressCount: 0,
      inProgressSum: 0,
      lastSuccessfulDate: typeof latestItem?.movedTime === "string" && latestItem.movedTime ? latestItem.movedTime : null,
      unavailable: false,
    };
  })().catch((error) => {
    console.warn("Unable to load realization summary", error.code || error.message);
    return {
      inProgressCount: 0,
      inProgressSum: 0,
      lastSuccessfulDate: null,
      unavailable: true,
    };
  });

  const salesPotentialPromise = core ? Promise.resolve({sum:0,unavailable:true}) : (async () => {
    const [wholesaleResponse, corporateResponse] = await Promise.all([
      vibe("/v1/deals/aggregate", authorization, {
        method: "POST",
        body: JSON.stringify({
          aggregate: [
            { field: "*", function: "count" },
            { field: "amount", function: "sum" },
          ],
          filter: {
            companyId: Number(companyId),
            categoryId: salesPotential.wholesaleCategoryId,
            stageSemanticId: "P",
          },
        }),
      }),
      vibe(`/v1/items/${salesPotential.corporateEntityTypeId}/aggregate`, authorization, {
        method: "POST",
        body: JSON.stringify({
          aggregate: [
            { field: "*", function: "count" },
            { field: "opportunity", function: "sum" },
          ],
          filter: {
            companyId: Number(companyId),
            stageId: salesPotential.corporateInProgressStageIds,
          },
        }),
      }),
    ]);
    const wholesale = wholesaleResponse.data || {};
    const corporate = corporateResponse.data || {};
    if (wholesale.meta?.truncated || corporate.meta?.truncated) {
      throw Object.assign(new Error("Sales potential aggregate is truncated"), { code: "AGGREGATE_TRUNCATED" });
    }
    return {
      sum: Math.round(((Number(wholesale.aggregates?.amount?.sum) || 0)
        + (Number(corporate.aggregates?.opportunity?.sum) || 0)) * 100) / 100,
      unavailable: false,
    };
  })().catch((error) => {
    console.warn("Unable to load sales potential", error.code || error.message);
    return { sum: 0, unavailable: true };
  });

  const [loadedContacts, fullName, farmer, realizationSummary, loadedSalesPotential] = await Promise.all([
    contactsPromise,
    requisitesPromise,
    farmerPromise,
    realizationSummaryPromise,
    salesPotentialPromise,
  ]);
  contacts = loadedContacts;
  const companyPhones = normalizePhones(company);
  const companyPhoneStatuses = companyPhones.map(phoneStatus);

  const detailState = parseDetailState(company[fields.elementTypes]);
  const selections = Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [
      name,
      name === "elementTypes" ? detailState.elementTypes : parseStored(company[field]),
    ]),
  );
  selections.productGroups = detailState.productGroups;
  selections.finalItems = detailState.finalItems;
  selections.objects = migrateObjects(selections.objects);
  const hasSavedPassport = hasClassificationPassport(company, fields);
  await archivePassport('companies',company,fields);
  return {
    lastEdit:await lastPassportEdit("companies",companyId),
    baseRevision:passportRevision(company,fields),
    company: {
      id: company.id,
      title: company.title,
      fullName,
      isTechnicalContact: typeof company.title === "string" && company.title.toLocaleLowerCase("ru-RU").includes("частное лицо"),
      hasDummyPhone: companyPhoneStatuses.includes("dummy"),
      hasInvalidPhone: companyPhoneStatuses.includes("invalid"),
      invalidPhones: companyPhones.filter((phone,index)=>companyPhoneStatuses[index] === "invalid"),
    },
    segment: {
      ...resolveSegment(company[segmentPathField]),
      path: typeof company[segmentPathField] === "string" ? company[segmentPathField].trim() : "",
    },
    companyFeature: typeof company[companyFeatureField] === "string" ? company[companyFeatureField] : "",
    commercial: {
      loading: core,
      dealsSum: Number(company[commercialFields.dealsSum]) || 0,
      dealsCount: Number(company[commercialFields.dealsCount]) || 0,
      successfulRealizationsSum: Number(company[commercialFields.dealsSum]) || 0,
      successfulRealizationsCount: Number(company[commercialFields.dealsCount]) || 0,
      farmer: farmer || "не распределен",
      coreTail: typeof company[commercialFields.coreTail] === "string" ? company[commercialFields.coreTail].trim() : "",
      inProgressRealizationsCount: realizationSummary.inProgressCount,
      inProgressRealizationsSum: realizationSummary.inProgressSum,
      lastSuccessfulRealizationDate: realizationSummary.lastSuccessfulDate,
      realizationSummaryUnavailable: realizationSummary.unavailable,
      salesPotentialSum: loadedSalesPotential.sum,
      salesPotentialUnavailable: loadedSalesPotential.unavailable,
    },
    selections,
    hasSavedPassport,
    progress: passportState(company),
    brandNotes: cleanBrandNotes(detailState.brandNotes),
    extendedInfo: readExtended(company[fields.elementTypes],selections),
    contacts,
  };
}

async function searchContacts(companyId, query, authorization) {
  const text = typeof query === "string" ? query.trim().slice(0, 100) : "";
  if (text.length < 2) return [];
  const tokens = text.toLocaleLowerCase("ru-RU").split(/\s+/).filter(Boolean);
  const digits = text.replace(/\D/g, "");
  const isPhoneQuery = digits.length >= 6;
  const phoneProbe = digits.length === 11 && /^[78]/.test(digits) ? digits.slice(1) : digits;
  const numericId = /^#?\d{1,9}$/.test(text) ? Number(text.replace(/^#/, "")) : 0;
  const select = ["id", "name", "lastName", "secondName", "post", "phone", "companyId", "companyIds"];
  const probe = [...tokens].sort((left, right) => right.length - left.length)[0] || "";
  const filters = isPhoneQuery
    ? [{ phone: { $contains: phoneProbe } }]
    : [
        { lastName: { $contains: probe } },
        { name: { $contains: probe } },
        { secondName: { $contains: probe } },
      ];
  const linkedPromise = companyLinks.contacts(companyId,[],authorization).then(data=>({data}));
  const filteredPromises = filters.map((filter) => vibe("/v1/contacts/search", authorization, {
    method: "POST",
    body: JSON.stringify({ filter, select, sort: "id", limit: 100, offset: 0 }),
  }));
  const exactPhoneValues = new Set();
  if (digits.length === 10) {
    exactPhoneValues.add(`+7${digits}`);
    exactPhoneValues.add(`8${digits}`);
  } else if (digits.length === 11) {
    exactPhoneValues.add(digits);
    exactPhoneValues.add(`+7${digits.slice(1)}`);
    exactPhoneValues.add(`8${digits.slice(1)}`);
  }
  const duplicatesPromise = exactPhoneValues.size
    ? vibe("/v1/duplicates/find", authorization, {
        method: "POST",
        body: JSON.stringify({ type: "phone", values: [...exactPhoneValues], entityType: "contact" }),
      })
    : Promise.resolve({ data: [] });
  const directIdPromise = numericId
    ? vibe(`/v1/contacts/${numericId}?select=${encodeURIComponent(select.join(","))}`, authorization).catch((error) => {
        if (error.status === 404 || error.code === "ENTITY_NOT_FOUND") return null;
        throw error;
      })
    : Promise.resolve(null);
  const [linkedResponse, filteredSettled, duplicateResponse, directIdResponse] = await Promise.all([
    linkedPromise,
    Promise.allSettled(filteredPromises),
    duplicatesPromise,
    directIdPromise,
  ]);
  const successfulFiltered = filteredSettled.filter((item) => item.status === "fulfilled").map((item) => item.value);
  if (filteredPromises.length && !successfulFiltered.length && !directIdResponse) {
    throw filteredSettled.find((item) => item.status === "rejected")?.reason || new Error("Не удалось выполнить поиск контактов.");
  }
  const linkedIds = new Set((Array.isArray(linkedResponse.data) ? linkedResponse.data : []).map((contact) => Number(contact.id)));
  const candidates = new Map();
  for (const response of successfulFiltered) {
    for (const contact of Array.isArray(response.data) ? response.data : []) candidates.set(Number(contact.id), contact);
  }
  const duplicateIds = Array.isArray(duplicateResponse?.data) ? [] : (duplicateResponse?.data?.contact || []);
  const duplicateContacts = await Promise.all(duplicateIds.slice(0, 25).map((id) =>
    vibe(`/v1/contacts/${Number(id)}?select=${encodeURIComponent(select.join(","))}`, authorization)
      .then((response) => response.data || response)
      .catch(() => null)));
  for (const contact of duplicateContacts) if (contact?.id) candidates.set(Number(contact.id), contact);
  const directContact = directIdResponse?.data || directIdResponse;
  if (directContact?.id) candidates.set(Number(directContact.id), directContact);
  return [...candidates.values()].filter((contact) => {
    if (numericId && Number(contact.id) === numericId) return true;
    if (isPhoneQuery) {
      return normalizePhones(contact).some((phone) => {
        const phoneDigits = String(phone || "").replace(/\D/g, "");
        const comparable = phoneDigits.length === 11 && /^[78]/.test(phoneDigits) ? phoneDigits.slice(1) : phoneDigits;
        return comparable.includes(phoneProbe);
      });
    }
    const haystack = `${displayName(contact)} ${normalizePhones(contact).join(" ")}`.toLocaleLowerCase("ru-RU");
    return tokens.every((token) => haystack.includes(token));
  }).slice(0, 25).map((contact) => ({
    id: Number(contact.id),
    name: displayName(contact) || `Контакт #${contact.id}`,
    post: typeof contact.post === "string" && contact.post.trim() ? contact.post.trim() : "Должность не указана",
    phone: normalizePhones(contact),
    linkedToCurrentCompany: linkedIds.has(Number(contact.id)) || Number(contact.companyId) === Number(companyId),
    url: `${portalBase}/crm/contact/details/${contact.id}/`,
  }));
}

async function savePassport(companyId, input, authorization, relationshipUpdate = {}) {
  const companyResponse = await vibe(`/v1/companies/${companyId}?select=${encodeURIComponent(["id", segmentField, segmentPathField, headField, ...Object.values(fields)].join(","))}`, authorization);
  const company = companyResponse.data || companyResponse;
  if(input?.segmentKey!==resolveSegment(company[segmentPathField]).value)throw Object.assign(new Error('Сегмент КА изменился или открыта прежняя версия формы. Обновите паспорт перед сохранением. Ваши ответы сохранены.'),{status:409,code:'SEGMENT_CHANGED'});
  if (!resolveSegment(company[segmentPathField]).isInstaller) {
    // Other segments may manage the head relationship without changing classification or contact roles.
    if(Object.keys(relationshipUpdate).length) await vibe(`/v1/companies/${companyId}`, authorization, {method:'PATCH',body:JSON.stringify(relationshipUpdate)});
    return getPassport(companyId,authorization);
  }
  const selections = Object.fromEntries(
    Object.keys(fields).map((name) => [name, cleanSelection(name, input?.selections?.[name])]),
  );
  selections.productGroups = cleanSelection("productGroups", input?.selections?.productGroups);
  selections.finalItems = cleanSelection("finalItems", input?.selections?.finalItems);
  const brandNotes = cleanBrandNotes(input?.brandNotes);
  const companyFeature = typeof input?.companyFeature === "string"
    ? input.companyFeature.trim().slice(0, 3000)
    : "";
  const requestedContactRoles = Array.isArray(input?.contactRoles)
    ? input.contactRoles.slice(0, 100).map((item) => ({
      id: Number(item?.id),
      role: typeof item?.role === "string" ? item.role.trim().slice(0, 3000) : "",
    })).filter((item) => Number.isSafeInteger(item.id) && item.id > 0)
    : [];

  const contactResponse = {data:await companyLinks.contacts(companyId,[contactRoleField],authorization)};
  const linkedContacts = new Map((contactResponse.data || []).map((contact) => [Number(contact.id), contact]));
  const contactRoles = [];
  for (const item of requestedContactRoles) {
    const contact = linkedContacts.get(item.id);
    if (!contact) {
      throw Object.assign(new Error(`Контакт #${item.id} не связан с этой компанией.`), {
        status: 409,
        code: "CONTACT_NOT_LINKED",
      });
    }
    contactRoles.push(item);
  }
  const update = Object.fromEntries(
    Object.entries(fields)
      .filter(([name]) => name !== "elementTypes")
      .map(([name, field]) => [field, JSON.stringify(selections[name])]),
  );
  update[fields.elementTypes] = serializeDetail(company[fields.elementTypes], selections, brandNotes, input?.extendedInfo);
  update[fields.objects] = JSON.stringify(selections.objects);
  update[companyFeatureField] = companyFeature;
  Object.assign(update, relationshipUpdate);
  assertPassportVersion(company,fields,input,update);
  await archivePassport('companies',company,fields);
  const writes = [vibe(`/v1/companies/${companyId}`, authorization, {
    method: "PATCH",
    body: JSON.stringify(update),
  })];
  for (const item of contactRoles) {
    const currentRole = linkedContacts.get(item.id)?.[contactRoleField];
    if ((typeof currentRole === "string" ? currentRole.trim() : "") === item.role) continue;
    writes.push(vibe(`/v1/contacts/${item.id}`, authorization, {
      method: "PATCH",
      body: JSON.stringify({ [contactRoleField]: item.role }),
    }));
  }
  await Promise.all(writes);
  const confirmedBody = await vibe(`/v1/companies/${companyId}?select=${encodeURIComponent('id,'+fields.elementTypes)}`,authorization);
  if ((confirmedBody.data || confirmedBody)[fields.elementTypes] !== update[fields.elementTypes]) throw Object.assign(new Error('Bitrix24 не подтвердил сохранение расширенных данных. Черновик сохранён.'),{status:502,code:'PASSPORT_WRITE_UNCONFIRMED'});
  const isFilled = hasClassificationPassport(update, fields);
  const hasAffiliation = String(update[headField] ?? company[headField] ?? '').trim().length > 0;
  if (isFilled || hasAffiliation) await adminService.recordFill(companyId, authorization).catch((error) => console.warn("Unable to record passport save", error.code || error.message));
  const savedCard = { ...company, ...update };
  await archivePassport('companies',savedCard,fields);
  return { lastEdit:await lastPassportEdit("companies",companyId),baseRevision:passportRevision(savedCard,fields),selections, brandNotes: JSON.parse(update[fields.elementTypes]).brandNotes, extendedInfo:readExtended(update[fields.elementTypes],selections), companyFeature, contactRoles, hasSavedPassport: isFilled, progress: passportState(savedCard) };
}

const contactService = createContactService({ vibe, fields, roleField: contactRoleField, featureField: companyFeatureField, parseStored, parseDetailState, cleanSelection, resolveSegment, normalizePhones, phoneStatus, displayName, realization, salesPotential, passportState, recordFill: (id,auth) => contactAdminService.recordFill(id,auth) });
const contactAdminService = await createAdminService({vibe,fields,segmentField:contactMetadata.segment,segmentPathField:contactMetadata.path,companyFeatureField:contactRoleField,contactRoleField,farmerField:contactMetadata.farmer,affiliationField:headField,portalBase,appPublicUrl,taxonomyText:taxonomyData,resource:'contacts',relatedCompanies:contactService.companiesFor});

const unifiedAdminService = createUnifiedAdminService(adminService, contactAdminService);
const interactiveReport=createInteractiveReport({vibe,authorize:auth=>adminService.currentAccess(auth),sendJson});
const passportPatterns = createPatternService(unifiedAdminService,vibe);
const parentService = createParentService({vibe,portalBase});
const commercialService = createCommercialService({vibe,portalBase});
const holdingService=createHoldingService({vibe,portalBase,parentService});
const purchaseHistory = createHistoryService({vibe,parentService,holdingService});
const groupSpecialization=createGroupSpecializationService({
 read:async(type,id,auth)=>{const b=await vibe('/v1/'+(type==='company'?'companies':'contacts')+'/'+id+'?select='+['id','ufCrmWmPassportHead',...Object.values(specializationFields)].join(','),auth);return b.data||b;},
 relationship:(type,id,auth)=>parentService.load(type,id,auth),
 write:(type,id,patch,auth)=>vibe('/v1/'+(type==='company'?'companies':'contacts')+'/'+id,auth,{method:'PATCH',body:JSON.stringify(patch)}),
 audit:async event=>{const dir=new URL('./data/group-specialization-backups/',import.meta.url);await mkdir(dir,{recursive:true,mode:0o700});await writeFile(new URL(event.operation+'-'+event.target+'.json',dir),JSON.stringify({...event,at:new Date().toISOString()}),{flag:'wx',mode:0o600});},
 recordFill:(type,id,auth)=>(type==='company'?adminService:contactAdminService).recordFill(id,auth)
});
const reportRecommendations=await createReportRecommendations({vibe,purchaseHistory});
async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if(['/api/passport/group-specialization/preview','/api/passport/group-specialization/apply'].includes(url.pathname)){
    const authorization=passportAuthorization(request);
    if(!authorization)return sendJson(response,401,{success:false,error:{message:'Сессия Bitrix24 истекла. Обновите паспорт.'}});
    if(request.method!=='POST')return sendJson(response,405,{success:false});
    if(!String(request.headers['content-type']||'').startsWith('application/json'))return sendJson(response,415,{success:false});
    try{const body=await readBody(request);const data=url.pathname.endsWith('/preview')?await groupSpecialization.preview(body.type,body.id,authorization):await groupSpecialization.apply(body,authorization);return sendJson(response,200,{success:true,data});}
    catch(error){return sendJson(response,error.status||500,{success:false,error:{message:error.message}});}
  }
  if(url.pathname==='/report-bridge.js') { response.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});return response.end(reportBridgeJs); }
  if(['/api/admin/report-session','/api/admin/recommendations'].includes(url.pathname)){
    const authorization=adminAuthorization(request);
    if(!authorization)return sendJson(response,401,{success:false,error:{message:'Сессия Bitrix24 истекла. Обновите отчёт.'}});
    if(request.method!=='POST')return sendJson(response,405,{success:false});
    if(!String(request.headers['content-type']||'').startsWith('application/json'))return sendJson(response,415,{success:false});
    try{
      if(url.pathname.endsWith('/report-session')){
        await vibe('/v1/me',authorization);
        return sendJson(response,200,{success:true},{'set-cookie':'wm_passport_admin='+encodeURIComponent(createAdminSession(authorization))+'; Max-Age=1200; Path=/api/admin; HttpOnly; Secure; SameSite=None; Partitioned'});
      }
      const body=await readBody(request);
      return sendJson(response,200,{success:true,data:await reportRecommendations(body.refs,authorization)});
    }catch(e){return sendJson(response,e.status||500,{success:false,error:{message:e.message}});}
  }
  if (url.pathname === "/health") return sendJson(response, 200, { ok: true });
  if(Object.hasOwn(historyAssets,url.pathname)){
    response.writeHead(200,{'content-type':url.pathname.endsWith('.css')?'text/css; charset=utf-8':url.pathname.endsWith('.json')?'application/json; charset=utf-8':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
    return response.end(historyAssets[url.pathname]);
  }
  if(['/api/passport/history','/api/passport/history/details','/api/passport/history/documents','/api/passport/history/buyers'].includes(url.pathname)){
    if(request.method!=='GET')return sendJson(response,405,{success:false});
    try{
      const operation=url.pathname==='/api/passport/history'?'summary':url.pathname.split('/').at(-1);
      const data=await purchaseHistory(operation,Object.fromEntries(url.searchParams),passportAuthorization(request));
      return sendJson(response,200,{success:true,data});
    }catch(error){return sendJson(response,error.status>=400?error.status:500,{success:false,error:{message:error.message}});}
  }
  if (Object.hasOwn(extendedAssets,url.pathname)) {
    response.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
    return response.end(extendedAssets[url.pathname]);
  }
  if(url.pathname==='/holding-ui.js'){response.writeHead(200,{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store'});return response.end(holdingUi);}
  if(url.pathname==='/api/passport/holding/search'){
    const authorization=passportAuthorization(request);if(!authorization)return sendJson(response,401,{success:false,error:{message:'Сессия истекла'}});
    if(request.method!=='GET')return sendJson(response,405,{success:false});
    try{return sendJson(response,200,{success:true,data:await holdingService.search(url.searchParams.get('type'),Number(url.searchParams.get('id')),url.searchParams.get('q'),authorization)});}catch(e){return sendJson(response,e.status||500,{success:false,error:{message:e.message}});}
  }
  if (url.pathname === '/parent-ui.js') {
    response.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
    return response.end(parentUi);
  }
  if (url.pathname === '/api/passport/parent/search') {
    const authorization=passportAuthorization(request);
    if(!authorization)return sendJson(response,401,{success:false,error:{message:'Сессия Bitrix24 истекла. Обновите паспорт.'}});
    if(request.method!=='GET')return sendJson(response,405,{success:false});
    try{return sendJson(response,200,{success:true,data:await parentService.search(url.searchParams.get('type'),Number(url.searchParams.get('id')),url.searchParams.get('q'),authorization)});}
    catch(error){return sendJson(response,error.status||500,{success:false,error:{message:error.message}});}
  }

  if (url.pathname === "/taxonomy-data.js") {
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    return response.end(taxonomyData);
  }

  if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/admin.html" || url.pathname === '/contact.html') {
    const placement = url.searchParams.get("placement") || url.searchParams.get("PLACEMENT") || "";
    const isAdminView = url.pathname === "/admin.html" || placement === "LEFT_MENU";
    const isContactView = url.pathname === '/contact.html' || placement.startsWith('CRM_CONTACT_') || url.searchParams.has('contactId');
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://api.bitrix24.com; img-src 'self' data:; connect-src 'self'; frame-ancestors https://vibecode.bitrix24.tech https://*.bitrix24.ru https://*.bitrix24.com https://crm2.waterman-t.com; base-uri 'none'; object-src 'none'",
    });
    return response.end(isAdminView ? adminHtml : isContactView ? contactHtml : indexHtml);
  }

  if(url.pathname.startsWith('/api/admin/interactive/'))return interactiveReport(request,response,url,adminAuthorization(request));

  if (url.pathname === "/api/admin/patterns" || url.pathname === "/api/admin" || url.pathname === "/api/admin/reset" || url.pathname === "/api/admin/export" || url.pathname === "/api/admin/setup" || url.pathname === "/api/admin/setup-contact" || url.pathname === "/api/admin/open") {
    const selectedAdmin = url.searchParams.get('entity') === 'contact' ? contactAdminService : adminService;
    const directAuthorization = authHeader(request);
    const authorization = adminAuthorization(request);
    if (!authorization) return sendJson(response, 401, { success: false, error: { code: "PLACEMENT_AUTH_REQUIRED", message: "Откройте панель через левое меню Bitrix24." } });
    try {
      if (url.pathname === "/api/admin/patterns" && request.method === "GET") {
        const data=await passportPatterns(authorization,url.searchParams.get("department")||0);
        return data===null?sendJson(response,202,{success:true,pending:true},{'retry-after':'3','cache-control':'no-store'}):sendJson(response,200,{success:true,data},{'cache-control':'no-store'});
      }
      if (url.pathname === "/api/admin" && request.method === "GET") {
        const data = await unifiedAdminService.overview(authorization);
        const headers = directAuthorization ? {
          "set-cookie": `wm_passport_admin=${encodeURIComponent(createAdminSession(directAuthorization))}; Max-Age=1200; Path=/api/admin; HttpOnly; Secure; SameSite=None; Partitioned`,
        } : {};
        return sendJson(response, 200, { success: true, data }, headers);
      }
      if (url.pathname === "/api/admin/reset" && request.method === "POST") {
        const body = await readBody(request);
        return sendJson(response, 200, { success: true, data: await unifiedAdminService.resetPassport(body.key, authorization) });
      }
      if (url.pathname === "/api/admin/export" && request.method === "POST") {
        const body = await readBody(request);
        const file = await unifiedAdminService.exportPassports(body.keys, authorization);
        response.writeHead(200, {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="passports.xlsx"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
          "content-length": file.buffer.length,
          "cache-control": "no-store",
          "x-passport-count": String(file.count),
          "x-content-type-options": "nosniff",
        });
        return response.end(file.buffer);
      }
      if (url.pathname === "/api/admin/setup" && request.method === "POST") {
        return sendJson(response, 200, { success: true, data: await adminService.setupLeftMenu(authorization) });
      }
      if (url.pathname === '/api/admin/setup-contact' && request.method === 'POST') {
        const placements = [
          { placement: 'CRM_COMPANY_DETAIL_TAB', handler: `${appPublicUrl}/`, title: 'Паспорт' },
          { placement: 'CRM_COMPANY_DETAIL_ACTIVITY', handler: `${appPublicUrl}/`, title: 'Паспорт' },
          { placement: 'CRM_CONTACT_DETAIL_TAB', handler: `${appPublicUrl}/contact.html`, title: 'Паспорт' },
          { placement: 'CRM_CONTACT_DETAIL_ACTIVITY', handler: `${appPublicUrl}/contact.html`, title: 'Паспорт' },
        ];
        const results = [];
        for (const item of placements) {
          const result = await vibe('/v1/placements/bind', authorization, {
            method: 'POST',
            body: JSON.stringify(item),
          });
          results.push({ placement: item.placement, result: result.data || result });
        }
        return sendJson(response,200,{success:true,data:{placements:results}});
      }
      if (url.pathname === "/api/admin/open" && request.method === "GET") {
        const companyId = Number(url.searchParams.get("companyId"));
        if (!Number.isSafeInteger(companyId) || companyId <= 0) return sendJson(response, 400, { success: false, error: { message: "Не определён контрагент." } });
        const session = createPassportSession(authorization);
        response.writeHead(302, {
          location: selectedAdmin === contactAdminService ? `/contact.html?contactId=${companyId}` : `/?companyId=${companyId}`,
          "set-cookie": `wm_passport_session=${encodeURIComponent(session)}; Max-Age=7200; Path=/api/passport; HttpOnly; Secure; SameSite=None; Partitioned`,
          "cache-control": "no-store",
        });
        return response.end();
      }
      return sendJson(response, 405, { success: false, error: { message: "Метод не поддерживается." } });
    } catch (error) {
      console.error(error);
      return sendJson(response, error.status || 500, { success: false, error: { code: error.code || "ADMIN_ERROR", message: error.message || "Не удалось выполнить запрос." } });
    }
  }

  if (url.pathname === '/api/passport/contact' || url.pathname.startsWith('/api/passport/contact/')) {
    const authorization = passportAuthorization(request);
    if (!authorization) return sendJson(response,401,{success:false,error:{message:'Сессия Bitrix24 истекла. Черновик сохранён: обновите вкладку.'}});
    const id=Number(url.searchParams.get('contactId'));
    if(!Number.isSafeInteger(id)||id<=0)return sendJson(response,400,{success:false,error:{message:'Не определён контакт. Откройте паспорт из его карточки.'}});
    try {
      let data;
      if(url.pathname === '/api/passport/contact' && request.method === 'GET') {
        const core=url.searchParams.get('core')==='1'||url.searchParams.get('commercial')==='1';
        const [base,relationship]=await Promise.all([contactService.load(id,authorization,{core}),parentService.load('contact',id,authorization)]);
        data={...base,relationship,holding:await holdingService.load('contact',id,authorization)};
      }
      else if(url.pathname === '/api/passport/contact' && request.method === 'PATCH') {const body=await readBody(request);data=await withPassportWriteLock('contact:'+id,()=>parentService.withSave('contact',id,body.relationship,authorization,update=>holdingService.withSave('contact',id,body.holding,authorization,h=>contactService.save(id,body,authorization,{...update,...h}))));}
      else if(url.pathname === '/api/passport/contact/companies/search' && request.method === 'GET') data=await contactService.search(id,url.searchParams.get('q'),authorization);
      else if(['/api/passport/contact/companies/link','/api/passport/contact/companies/unlink'].includes(url.pathname) && request.method==='POST') data=await contactService.changeLink(id,Number((await readBody(request)).companyId),url.pathname.endsWith('/unlink'),authorization);
      else return sendJson(response,405,{success:false,error:{message:'Метод не поддерживается.'}});
      if(url.pathname==='/api/passport/contact' && request.method==='GET' && url.searchParams.get('core')!=='1') {
        data=await commercialService.decorate('contact',id,authorization,data);
        data.commercial.loading=false;
      }
      const headers=authHeader(request)?{'set-cookie':`wm_passport_session=${encodeURIComponent(createPassportSession(authorization))}; Max-Age=7200; Path=/api/passport; HttpOnly; Secure; SameSite=None; Partitioned`}:{};
      return sendJson(response,200,{success:true,data},headers);
    } catch(error) { return sendJson(response,error.status||500,{success:false,error:{message:error.message||'Не удалось выполнить запрос. Черновик сохранён.'}}); }
  }

  if (["/api/passport","/api/passport/contacts","/api/passport/contacts/search","/api/passport/contacts/link","/api/passport/contacts/unlink"].includes(url.pathname)) {
    const directAuthorization = authHeader(request);
    const authorization = passportAuthorization(request);
    if (!authorization) {
      return sendJson(response, 401, {
        success: false,
        error: { code: "PLACEMENT_AUTH_REQUIRED", message: "Сессия Bitrix24 истекла. Обновите вкладку — несохранённый черновик будет восстановлен." },
      });
    }
    const companyId = Number(url.searchParams.get("companyId"));
    if (!Number.isSafeInteger(companyId) || companyId <= 0) {
      return sendJson(response, 400, { success: false, error: { message: "Не определена компания." } });
    }
    try {
      if (["/api/passport/contacts/link","/api/passport/contacts/unlink"].includes(url.pathname)) {
        if(request.method!=="POST")return sendJson(response,405,{success:false,error:{message:'Метод не поддерживается.'}});
        const input=await readBody(request);
        await contactService.changeLink(Number(input.contactId),companyId,url.pathname.endsWith('/unlink'),authorization);
        return sendJson(response,200,{success:true,data:{contacts:await getLinkedContacts(companyId,authorization)}});
      }
      if(url.pathname==='/api/passport/contacts'&&request.method==='GET')return sendJson(response,200,{success:true,data:{contacts:await getLinkedContacts(companyId,authorization)}});
      if (url.pathname === "/api/passport/contacts/search" && request.method === "GET") {
        return sendJson(response, 200, { success: true, data: await searchContacts(companyId, url.searchParams.get("q") || "", authorization) });
      }
      if (request.method === "GET") {
        const core=url.searchParams.get('core')==='1'||url.searchParams.get('commercial')==='1';
        const [base,relationship]=await Promise.all([getPassport(companyId,authorization,{core}),parentService.load('company',companyId,authorization)]);
        let data={...base,relationship,holding:await holdingService.load('company',companyId,authorization)};
        if(url.searchParams.get('core')!=='1'){
          data=await commercialService.decorate('company',companyId,authorization,data);
          data.commercial.loading=false;
        }
        const headers = directAuthorization ? {
          "set-cookie": `wm_passport_session=${encodeURIComponent(createPassportSession(directAuthorization))}; Max-Age=7200; Path=/api/passport; HttpOnly; Secure; SameSite=None; Partitioned`,
        } : {};
        return sendJson(response, 200, { success: true, data }, headers);
      }
      if (request.method === "PATCH") {
        const body = await readBody(request);
        const saved = await withPassportWriteLock('company:'+companyId,()=>parentService.withSave('company',companyId,body.relationship,authorization,update=>holdingService.withSave('company',companyId,body.holding,authorization,h=>savePassport(companyId,body,authorization,{...update,...h}))));
        return sendJson(response, 200, { success: true, data: saved });
      }
      return sendJson(response, 405, { success: false, error: { message: "Метод не поддерживается." } });
    } catch (error) {
      console.error(error);
      return sendJson(response, error.status || 500, {
        success: false,
        error: { code: error.code || "APP_ERROR", message: error.message || "Не удалось выполнить запрос." },
      });
    }
  }

  sendJson(response, 404, { success: false, error: { message: "Not found" } });
}
const server=createServer((request,response)=>passportContext.run({method:request.method,path:new URL(request.url,"http://localhost").pathname},()=>handleRequest(request,response)));

server.listen(port, "0.0.0.0", () => console.log(`Installer Passport listening on ${port}`));

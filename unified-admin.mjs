import { salesDepartments } from './sales-departments.mjs';
import { createXlsx } from './excel-xlsx.mjs';

const invalid = message => Object.assign(new Error(message), { status: 400, code: 'INVALID_ENTITY' });
export function parseEntityKey(key) {
  const match = /^(company|contact):([1-9]\d*)$/.exec(String(key));
  if (!match || !Number.isSafeInteger(Number(match[2]))) throw invalid('Не определён тип или ID карточки. Обновите панель.');
  return { type: match[1], id: Number(match[2]), key: match[0] };
}

export function createUnifiedAdminService(companyService, contactService) {
  const services = { company: companyService, contact: contactService };
  async function overview(authorization) {
    const parts = await Promise.all(Object.entries(services).map(async ([type, service]) => ({ type, data: await service.overview(authorization) })));
    const companies = parts.flatMap(({ type, data }) => data.companies.map(item => ({ ...item, entityType: type, key: `${type}:${item.id}` })));
    companies.sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.key.localeCompare(b.key));
    const stats = {};
    for (const name of ['distributed', 'filled', 'empty', 'day', 'week', 'month']) stats[name] = parts.reduce((sum, part) => sum + Number(part.data.stats[name] || 0), 0);
    stats.companyCount = parts[0].data.companies.length;
    stats.contactCount = parts[1].data.companies.length;
    const farmers = new Map();
    for (const { data } of parts) for (const farmer of data.stats.farmerTotals || []) {
      const key = String(farmer.id);
      farmers.set(key, { ...farmer, count: Number(farmer.count) + (farmers.get(key)?.count || 0) });
    }
    stats.leaders = [...farmers.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru')).slice(0, 3);
    return { departments: salesDepartments, access: parts[0].data.access, companies, stats, trackingStarted: '2026-08-28' };
  }

  async function resetPassport(key, authorization) {
    const entity = parseEntityKey(key);
    return services[entity.type].resetPassport(entity.id, authorization);
  }

  async function exportPassports(keys, authorization) {
    if (keys !== null && keys !== undefined && !Array.isArray(keys)) throw invalid('Некорректный список карточек.');
    const selection = keys == null ? null : [...new Set(keys)].map(parseEntityKey);
    if (selection && !selection.length) throw invalid('Не выбраны паспорта для экспорта.');
    const parts = await Promise.all(Object.entries(services).map(async ([type, service]) => {
      const ids = selection?.filter(item => item.type === type).map(item => item.id) ?? null;
      if (ids && !ids.length) return { type, rows: [] };
      return { type, ...await service.exportPassports(ids, authorization, { asRows: true }) };
    }));
    const rows = parts.flatMap(({ type, rows }) => rows.map(row => [type === 'contact' ? 'Контакт' : 'Компания', ...row]));
    if (!rows.length) throw Object.assign(new Error('Нет заполненных паспортов для экспорта.'), { status: 409, code: 'NOTHING_TO_EXPORT' });
    const baseHeaders = parts.find(part => part.headers)?.headers;
    const headers = ['Тип карточки', ...baseHeaders];
    headers[1] = 'ID карточки'; headers[2] = 'Компания / ФИО контакта';
    headers[19] = 'Особенность компании / роль контакта';
    headers[20] = 'Связанные контакты / компании';
    headers[21] = 'Телефоны связанных карточек';
    headers[22] = 'Роли контактов / особенности компаний';
    const average = Math.round(rows.reduce((sum, row) => sum + Number(row[8] || 0), 0) * 10 / rows.length) / 10;
    for (const row of rows) row[9] = average;
    return { buffer: createXlsx(headers, rows), count: rows.length, filename: selection ? 'Паспорта_выбранных_карточек.xlsx' : 'Паспорта_компаний_и_контактов.xlsx' };
  }
  async function patternInputs(authorization){return (await Promise.all(Object.values(services).map(s=>s.patternInputs(authorization)))).flat();}
  return { overview, patternInputs, resetPassport, exportPassports };
}

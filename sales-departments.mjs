// Approved sales structure: user, «Отчет по ОП», 2026-10-15.
export const salesDepartments = [
  {id:20,name:'Отдел продаж — Сергей Фёдоров',parentId:0},
  {id:21,name:'Промышленное оборудование',parentId:20},
  {id:22,name:'Наружные сети',parentId:20},
  {id:1005,name:'Отдел опта (общий)',parentId:20},
  {id:1044,name:'Реанимация',parentId:0},
  {id:25,name:'Розничные продажи — Владимир Годымчук',parentId:0},
  {id:27,name:'Елизаровых',parentId:25},
  {id:29,name:'Киевская',parentId:25},
  {id:31,name:'Мира',parentId:25},
  {id:32,name:'Нечевский',parentId:25},
  {id:1064,name:'Розничные продажи — Владимир Гуров',parentId:0},
  {id:30,name:'Комсомольский',parentId:1064},
  {id:33,name:'Северск',parentId:1064},
  {id:1066,name:'Розничные продажи — Николай Потапов',parentId:0},
  {id:26,name:'Б8',parentId:1066},
  {id:28,name:'Иркутский',parentId:1066},
  {id:19,name:'ОКЦ',parentId:0},
  {id:168,name:'Прочие сотрудники розницы',parentId:0},
];
const parents = new Map(salesDepartments.map(d=>[d.id,d.parentId]));
const heads = new Map([[17,20],[40,21],[42,22],[99,1005],[3498,1044],[20,25],[32,1064],[25,26]]);
export function salesDepartmentIds(user) {
  if (!user || [90,3611].includes(Number(user.id))) return [];
  const raw = Array.isArray(user.departmentId) ? user.departmentId : [user.departmentId];
  const ids = heads.has(Number(user.id)) ? [heads.get(Number(user.id))] : raw.map(Number).filter(id=>parents.has(id));
  const result = new Set();
  for (let id of ids) while(id && !result.has(id)) { result.add(id); id=parents.get(id); }
  return [...result];
}

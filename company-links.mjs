const fail = (message, status = 409) => Object.assign(new Error(message), {status});
const valid = id => Number.isSafeInteger(Number(id)) && Number(id) > 0;
export const companyIds = c => [...new Set([c.companyId, ...(Array.isArray(c.companyIds) ? c.companyIds : [])].map(Number).filter(valid))];
export function createCompanyLinks({vibe}) {
  const locks = new Map();
  async function change(contactId, companyId, remove, auth) {
    if (!valid(contactId) || !valid(companyId)) throw fail('Не определены контакт и компания.',400);
    contactId=Number(contactId); companyId=Number(companyId);
    const previous=locks.get(contactId)||Promise.resolve(); let release;
    const pending=new Promise(resolve=>{release=resolve;}); locks.set(contactId,pending);
    await previous;
    try {
      const read=async()=>{const b=await vibe(`/v1/contacts/${contactId}?select=id,companyId,companyIds`,auth);return b.data||b;};
      const before=await read();
      await vibe(`/v1/companies/${companyId}?select=id`,auth);
      const ids=companyIds(before);
      const next=remove?ids.filter(id=>id!==companyId):[...new Set([...ids,companyId])];
      const primary=next.includes(Number(before.companyId))?Number(before.companyId):(next[0]||0);
      if (next.length!==ids.length) await vibe(`/v1/contacts/${contactId}`,auth,{method:'PATCH',body:JSON.stringify({companyIds:next,companyId:primary})});
      const after=await read();
      const actual=companyIds(after);
      if (actual.length!==next.length || next.some(id=>!actual.includes(id)) || Number(after.companyId||0)!==primary) throw fail('Bitrix24 не подтвердил полный состав связей. Обновите список перед повторной попыткой.',502);
      return after;
    } finally {release();if(locks.get(contactId)===pending)locks.delete(contactId);}
  }
  async function contacts(companyId, select, auth) {
    if(!valid(companyId))throw fail('Не определена компания.',400);
    const response=await vibe(`/v1/companies/${Number(companyId)}?select=id,contactIds`,auth);
    const company=response.data||response;
    if(!Array.isArray(company.contactIds))throw fail('Не удалось прочитать состав контактов компании.',502);
    const ids=[...new Set(company.contactIds.map(Number).filter(valid))];
    const all=new Map();
    for (let index=0;index<ids.length;index+=100) {
      const chunk=ids.slice(index,index+100);
      const b=await vibe('/v1/contacts/search',auth,{method:'POST',body:JSON.stringify({filter:{id:{$in:chunk}},select:[...new Set(['id',...select])],sort:'id',limit:100,offset:0,autoWindow:false,withTotal:true})});
      if(!Array.isArray(b.data)||b.meta?.truncated)throw fail('Не удалось полностью загрузить связанные контакты.',502);
      for(const c of b.data)all.set(Number(c.id),c);
      if(chunk.some(id=>!all.has(id)))throw fail('Часть связанных контактов недоступна. Проверьте права.',502);
    }
    return ids.map(id=>all.get(id));
  }
  return {change,contacts};
}

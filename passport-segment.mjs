export const segmentField='ufCrmWmKaSegment';
export const paths={companies:'ufCrm_1785825564',contacts:'ufCrm_1785825531'};
export const folders=['VIP и крупные монтажники','Средние монтажники','Мелкие монтажники','Сантехники отделочники'];
const norm=s=>String(s??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
const allowed=new Set(folders.map(norm));
export function segmentFromPath(path){
 const match=String(path??'').split(/;|→|\//).some(part=>allowed.has(norm(part)));
 return {status:match?'active':'missing',value:match?'Монтажник':'Не определён',storedValue:match?'Монтажник':'',isInstaller:match};
}

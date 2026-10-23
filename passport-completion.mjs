// Only classification answers are evidence of passport completion.
// Save timestamps, relationships, roles, notes and financial fields are not.
const nonempty = a => Array.isArray(a) && a.some(x => typeof x === 'string' && x.trim());
function list(value) {
 if(Array.isArray(value))return value;
 if(typeof value!=='string'||!value.trim())return [];
 try{const p=JSON.parse(value);return Array.isArray(p)?p:[];}catch{return value.split('|').map(x=>x.trim()).filter(Boolean);}
}
export function hasClassificationPassport(card,fields){
 if(['objects','works','contours','systems','elements'].some(k=>nonempty(list(card?.[fields[k]]))))return true;
 const raw=card?.[fields.elementTypes];
 let detail;try{detail=typeof raw==='string'?JSON.parse(raw):raw;}catch{return nonempty(list(raw));}
 if(Array.isArray(detail))return nonempty(detail);
 return !!detail && ['items','productGroups','finalItems'].some(k=>nonempty(detail[k]));
}

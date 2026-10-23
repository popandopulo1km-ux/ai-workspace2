// All money is in kopecks. Margins are ratios of original totals, not rounded display percentages.
export function periodTotals(daily,from,to){
 const totals=new Map();
 for(const [key,,date,amount] of daily.rows)if(date>=from&&date<=to)totals.set(key,(totals.get(key)||0)+amount);
 return totals;
}
export function unitTotal(unit,totals){return [...new Set(unit.memberKeys)].reduce((n,k)=>n+(totals.get(k)||0),0);}
export function potential(total,current,weight,margin){
 if(!(total>0))return {income:null,reason:'Нет положительного оборота КА'};
 if(!(weight>0&&weight<1))return {income:null,reason:'Нет доли ТГ в выборке счетов'};
 if(!(margin?.turnover>0)||!Number.isFinite(margin.income))return {income:null,reason:'Нет доходности ТГ'};
 if(!Number.isFinite(current))return {income:null,reason:'Нет суммы продаж ТГ'};
 const extra=Math.max(0,weight*total-current);
 return {income:Math.round(extra*margin.income/margin.turnover),extra:Math.round(extra),weight,margin:margin.income/margin.turnover,reason:extra===0?'Средняя доля уже достигнута':''};
}

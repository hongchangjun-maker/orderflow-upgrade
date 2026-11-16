import {type Doc} from './domain';
import {orderRows} from './order-reader';
import {query,type LiveContext} from './store';
export async function exportOrders(c:LiveContext,data:Doc){
  const orders=await orderRows(c,data),keys=JSON.stringify(orders.map(o=>o.ocodekey));
  const lines=await query(c,"SELECT p.key ocodekey,i.name iname,i.name disp,i.unit,i.quantity qty,i.price cost,i.quantity*i.price amt FROM of_orders p JOIN of_orders o ON o.shop=p.shop AND (o.id=p.id OR o.merged_into=p.id) JOIN of_order_items i ON i.order_id=o.id WHERE p.shop=? AND p.key IN (SELECT value FROM json_each(?)) ORDER BY p.id,i.id",c.shop,keys);
  const summary=new Map<string,Doc>();
  for(const line of lines){const key=JSON.stringify([line.iname,line.unit,line.cost]),old=summary.get(key);summary.set(key,{iname:line.iname,unit:line.unit,cost:line.cost,tqty:Number(old?.tqty??0)+Number(line.qty)});}
  const columns=[...summary.values()];
  const pivotData=orders.map(o=>({...o,telno:o.mobile,tran_name:o.tranname??o.cust_name,...Object.fromEntries(columns.map((col,index)=>['a'+(index+1),lines.filter(l=>l.ocodekey===o.ocodekey&&l.iname===col.iname&&l.unit===col.unit&&l.cost===col.cost).reduce((n,l)=>n+Number(l.qty),0)]))}));
  return {orders,items:lines,itemSummary:columns,itemDetail:lines,pivotMeta:{inames_title:columns.map(i=>i.iname).join('\u0017'),costs:columns.map(i=>i.cost).join('\u0017')},pivotData,truncated:orders.length===5000};
}

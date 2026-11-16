// Source-presentation vocabulary only. Persisted/API canonical values stay frozen.
const delivery={direct:'배달',pickup:'픽업(방문)',parcel:'택배'};
const payment={transfer:'계좌이체',store:'현금',prepay:'선결제'};
export function sourceOrderDTO(value,toSource=true,methodKind){
  if(Array.isArray(value))return value.map(v=>sourceOrderDTO(v,toSource,methodKind));
  if(!value||typeof value!=='object')return value;
  const result={};
  for(const [key,item]of Object.entries(value)){
    if(toSource&&key==='orderno'&&typeof item==='number'){result[key]=String(item);continue;}
    const map=key==='part_gbn'&&methodKind==='delivery'?{...delivery,delivery:'배달'}:['delivery_gbn','deliveryGbn'].includes(key)||key==='code_name'&&methodKind==='delivery'?delivery:['pay_gbn','payGbn'].includes(key)||key==='code_name'&&methodKind==='pay'?payment:null;
    result[key]=map&&typeof item==='string'?(toSource?map[item]:Object.entries(map).find(([,label])=>label===item)?.[0])??item:sourceOrderDTO(item,toSource,methodKind);
  }
  return result;
}
export function sourceOrderRows(orders){
  // Frozen source grid computes actual paid = tamt - point.
  // Canonical API tamt is already net, so its presentation subtotal adds points back once.
  return orders.map(order=>({...order,tamt:Number(order.tamt??0)+Number(order.point??0),damt:Number(order.damt??0)-Number(order.point??0)}));
}

import { LiveError, text, type Doc } from "./domain";
import { formDetail } from "./forms";
import { amountDue } from "./pricing";
import { first, parse, query, type LiveContext } from "./store";
export async function orderRows(c: LiveContext, filter: Doc = {}) {
  const from =
      text(filter.frDate ?? filter.fr_date).replaceAll("-", "") || "00000000",
    to =
      text(filter.toDate ?? filter.to_date).replaceAll("-", "") || "99999999";
  const clauses:string[]=[],params:unknown[]=[];
  const keyword=text(filter.searchData??filter.search).toLowerCase();
  if(keyword){clauses.push("(instr(lower(COALESCE(json_extract(o.data,'$.cust_name'),c.name)||' '||c.mobile||' '||o.id||' '||COALESCE(json_extract(o.data,'$.addr'),'')),?)>0)");params.push(keyword);}
  const statuses=text(filter.orderStatus??filter.status).split(',').filter(v=>/^\d{2}$/u.test(v));
  if(statuses.length){clauses.push('o.status IN ('+statuses.map(()=>'?').join(',')+')');params.push(...statuses);}
  if(['Y','N'].includes(text(filter.ispaid??filter.finbank))){clauses.push('o.ispaid=?');params.push(text(filter.ispaid??filter.finbank));}
  for(const [field,value] of [['pay_gbn',filter.payGbn??filter.pay_gbn],['delivery_gbn',filter.deliveryGbn??filter.delivery_gbn]] as const){if(value&&value!=='all'&&value!=='ALL'){clauses.push(`json_extract(o.data,'$.${field}')=?`);params.push(text(value));}}
  if(filter.urlorderToken){clauses.push('o.form_id IN (SELECT id FROM of_forms WHERE token=?)');params.push(text(filter.urlorderToken));}
  const result = await query(
    c,
    "SELECT o.*,c.name cust_name,c.mobile FROM of_orders o JOIN of_customers c ON c.id=o.customer_id WHERE o.shop=? AND o.order_date BETWEEN ? AND ? AND o.merged_into IS NULL AND (?='' OR o.key=?)"+(clauses.length?' AND '+clauses.join(' AND '):'')+" ORDER BY o.id DESC LIMIT 5000",
    c.shop,
    from,
    to,
    text(filter.key),
    text(filter.key),
    ...params,
  );
  const output: Doc[] = [];
  const ids = JSON.stringify(result.map((o) => o.id));
  const membersAll = await query(
    c,
    "SELECT id,key,amount,fee,data,merged_into FROM of_orders WHERE shop=? AND (id IN (SELECT value FROM json_each(?)) OR merged_into IN (SELECT value FROM json_each(?)))",
    c.shop,
    ids,
    ids,
  );
  const linesAll = await query(
    c,
    "SELECT i.*,o.merged_into FROM of_order_items i JOIN of_orders o ON o.id=i.order_id WHERE o.shop=? AND (o.id IN (SELECT value FROM json_each(?)) OR o.merged_into IN (SELECT value FROM json_each(?)))",
    c.shop,
    ids,
    ids,
  );
  const memberMap = new Map<number, Doc[]>(),
    lineMap = new Map<number, Doc[]>();
  for (const m of membersAll) {
    const id = Number(m.merged_into ?? m.id);
    memberMap.set(id, [...(memberMap.get(id) ?? []), m]);
  }
  for (const l of linesAll) {
    const id = Number(l.merged_into ?? l.order_id);
    lineMap.set(id, [...(lineMap.get(id) ?? []), l]);
  }
  for (const o of result) {
    const members = memberMap.get(Number(o.id)) ?? [o],
      lines = lineMap.get(Number(o.id)) ?? [];
    const data = parse(o.data);
    const total = members.reduce(
      (n, r) => n + amountDue({...r,data:parse(r.data)}),
      0,
    );
    const row = {
      ...data,
      delivery_part_gbn:data.delivery_part_gbn??(data.delivery_gbn==='pickup'?'픽업(방문)':data.delivery_gbn==='parcel'?'택배':'배달'),
      ocodekey: o.key,
      orderno: Number(o.id),
      uocode: Number(o.form_id),
      cust_name: data.cust_name??o.cust_name,
      mobile: o.mobile,
      order_date: o.order_date,
      status: o.status,
      ispaid: o.ispaid,
      finbank: o.ispaid,
      order_amt: members.reduce((n, r) => n + Number(r.amount), 0),
      delivery_amt: members.reduce((n, r) => n + Number(r.fee), 0),
      tamt: total,
      total_amt: total,
      tqty: lines.length,
      item_summary: lines[0]?.name ?? "",
      contents: lines.map((i) => `${i.name} ${i.quantity}${i.unit}`).join("\n"),
      revision: o.revision,
      isrt_date: o.created_at,
      update_date: o.updated_at,
      point: members.reduce((n,r)=>n+Number(parse(r.data).point_used??0),0),
      point_used: members.reduce((n,r)=>n+Number(parse(r.data).point_used??0),0),
      saved_point: members.reduce((n,r)=>n+Number(parse(r.data).saved_point??0),0),
      adjustment: members.reduce((n,r)=>n+Number(parse(r.data).adjustment??0),0),
      damt:members.reduce((n,r)=>n+Number(parse(r.data).point_used??0)-Number(parse(r.data).adjustment??0),0),
      tran_name:data.tran_name??data.tranname??data.cust_name??o.cust_name,
      cash_receipt:data.cash_receipt_no??(['Y','N'].includes(String(data.cash_receipt))?'':data.cash_receipt??''),
      isrt_user: "고객",
      sms_result: "",
      memberKeys: members.map((m) => m.key),
      ordernumber:
        members.length > 1 ? members.map((m) => m.key).join(",") : "",
    };
    output.push(row);
  }
  return output;
}
export async function orderDetail(c: LiveContext, key: unknown) {
  const order = await first(
    c,
    "SELECT * FROM of_orders WHERE key=? AND shop=?",
    text(key),
    c.shop,
  );
  if (!order) throw new LiveError("주문을 찾을 수 없습니다.", 404);
  if (order.merged_into)
    throw new LiveError("병합 대표 주문에서 조회해 주세요.", 409);
  const header = (await orderRows(c, { key }))[0];
  const items = await query(
    c,
    "SELECT i.* FROM of_order_items i JOIN of_orders o ON i.order_id=o.id WHERE o.shop=? AND (o.id=? OR o.merged_into=?)",
    c.shop,
    order.id,
    order.id,
  );
  return {
    header,
    items: items.map((i) => ({
      ...i,
      seqno: i.id,
      iname: i.name,
      item_name: i.name,
      disp: i.name,
      qty: i.quantity,
      cost: i.price,
      amt: Number(i.quantity) * Number(i.price),
    })),
    availableItems: (await formDetail(c, Number(order.form_id))).items,
  };
}


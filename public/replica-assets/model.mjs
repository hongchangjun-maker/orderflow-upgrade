// Pure domain fixture; contains no original customers, orders, or credentials.
export const seller = Object.freeze({ mcode: "SIM-ONLY", ucode: "SIM-OWNER", mname: "아삭아삭", userName: "사용자", userId: "simulation", email: "", mobile: "", isAdmin: false, role: "OWNER", userLevel: 40 });
export function createOrders(count = 100, now = new Date()) {
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(now).replaceAll("-", "");
  return Array.from({ length: Math.min(2000, Math.max(0, Math.trunc(count))) }, (_, i) => ({
    orderno: i + 1, ocodekey: `SIM-${i+1}`, order_date: date, order_time: "10:30", isrt_date: `${date}103000`,
    cust_name: `가상고객 ${i+1}`, mobile: `0100000${String(i+1).padStart(4,"0")}`, addr: "가상시 가상구 (실제 배송지 아님)", addr_detail: "시뮬레이션 전용", zipcode: "00000",
    order_status: ["00","10","22","24","30"][i%5], order_status_name: ["대기","접수","포장","배송","완료"][i%5], status: ["00","10","22","24","30"][i%5],
    delivery_gbn: "direct", delivery_gbn_name: "직배송", pay_yn: i%3 ? "N" : "Y", pay_gbn: "transfer", pay_gbn_name: "계좌이체", deposit_yn: i%3 ? "N" : "Y",
    order_amt: 20000+i*100, delivery_amt: 3000, total_amt: 23000+i*100, item_count: 2, item_qty: 2, order_qty: 2,
    order_items: "제철 사과 1박스 / 감귤 1박스", items: "제철 사과 1박스 / 감귤 1박스", request_msg: "가상 주문입니다", memo: "시험용", uocode: 1,
    tamt:23000+i*100,tqty:2,item_summary:"제철 사과",contents:"제철 사과 1박스\n감귤 1박스",addr2:"시뮬레이션 전용",ispaid:i%3?"N":"Y",finbank:i%3?"N":"Y",iscashreceipt:"N",ispresent:"N",sms_result:"",damt:0,saved_point:0,point_rate:0,delivery_memo:"가상 주문입니다",isrt_user:"시뮬레이터",
    point: 0, use_point:0, save_point:0, discount_amt:0, prepay_amt:0, print_yn:"N", cashreceipt_yn:"N", gift_yn:"N", alimtalk_yn:"N", real_pay_amt:23000+i*100,
  }));
}
export function summaryOf(orders) {
  return { today_order_count: orders.length, today_sales_amount: orders.filter(o=>o.order_status!=="40").reduce((a,o)=>a+o.total_amt,0), today_pending_count:orders.filter(o=>o.order_status==="00").length };
}
export function selectOrders(orders, request={}) {
  const query = String(request.searchData ?? request.search ?? "").toLowerCase();
  return orders.filter(o => (!request.frDate || o.order_date >= request.frDate) && (!request.toDate || o.order_date <= request.toDate) && (!query || `${o.cust_name} ${o.mobile} ${o.orderno} ${o.addr}`.toLowerCase().includes(query)));
}
export function updateOrders(orders, keys, patch) {
  const selected = new Set(keys.map(k=> typeof k==="object" ? k.ocodekey : k));
  return orders.map(o=> selected.has(o.ocodekey) ? {...o,...patch}:o);
}

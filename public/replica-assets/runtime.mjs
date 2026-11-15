import { seller, createOrders, summaryOf, selectOrders, updateOrders } from "./model.mjs";

// Infrastructure boundary: no fetch/XHR/WebSocket. Axios resolves in this module.
const PREFIX = "orderflow:orange-replica:v1:";
function isolatedStorage(storage) {
  return { getItem: k=>{try{return storage.getItem(PREFIX+k)}catch{return null}}, setItem:(k,v)=>{try{storage.setItem(PREFIX+k,String(v))}catch{showNotice("브라우저 저장 공간이 부족합니다. 현재 세션에서만 변경됩니다.")}}, removeItem:k=>{try{storage.removeItem(PREFIX+k)}catch{/* unavailable */}}, clear:()=>{for(let i=storage.length-1;i>=0;i--){const k=storage.key(i);if(k?.startsWith(PREFIX))storage.removeItem(k)}} };
}
export const replicaStorage = isolatedStorage(window.localStorage);
export const replicaSessionStorage = isolatedStorage(window.sessionStorage);
// Not an authentication credential. It is never transmitted or accepted by a server.
replicaStorage.setItem("accessToken", "LOCAL-SIMULATION-NOT-A-CREDENTIAL");
replicaStorage.setItem("seller", JSON.stringify(seller));
export const replicaSocket = { on(){return this}, off(){return this}, emit(){return this}, disconnect(){}, connected:false };
let state;
try { state=JSON.parse(replicaStorage.getItem("state")??"null"); } catch { state=null; }
if(!state || state.version!==1 || !Array.isArray(state.orders) || state.orders.length>2000) state={version:1,orders:[],collections:{},settings:{}};
const save=()=>replicaStorage.setItem("state",JSON.stringify(state));
const clone=value=>JSON.parse(JSON.stringify(value));
const diagnostics = new Set();
function showNotice(text) { const el=document.getElementById("replica-notice");if(el)el.textContent=text; }
const ok=data=>({success:true,data:clone(data),simulation:true});
function blocked(config, message="독립 시뮬레이션에서는 이 외부 연동을 실행하지 않습니다. 원본 서버·은행·문자에는 전송하지 않았습니다.") {
  showNotice(message);
  const error = new Error(message);
  error.config=config; error.response={status:409,data:{success:false,error:{code:"SIMULATION_ONLY",message}},config};
  return Promise.reject(error);
}
function list(name){return state.collections[name]??=[]}
function params(config){try{return typeof config.data==="string"?JSON.parse(config.data):config.data??{}}catch{return {}}}
export async function replicaAdapter(config) {
  const url=new URL(config.url,"https://replica.invalid");
  const path=url.pathname.replace(/^\/api\/v1/,"");
  const method=(config.method??"get").toUpperCase();
  const data=params(config);
  let value;
  // Never allow a provider action, password change, destructive bulk op, or charge.
  if (method!=="GET" && /(?:\/auth\/|\/sms\/(?:send|charge)|\/cashreceipt|\/fee\/extend|\/easyfin|\/telegram\/test|\/share\/alimtalk|\/inquiry\/(?:send|escalate|create)|\/chat\/.*\/messages)/u.test(path)) return blocked(config);
  if(path==="/account/perms/mine") value={role:"OWNER",userLevel:40,perms:{}};
  else if(path==="/account/perms") value={users:[{...seller,role:"OWNER",name:seller.userName}],defs:[],overrides:[],permissions:[],accounts:[]};
  else if(path==="/dashboard/today-summary") value=summaryOf(state.orders);
  else if(path==="/orders/list") {const orders=selectOrders(state.orders,data);value={orders,summary:{total_count:orders.length,total_amt:orders.reduce((a,o)=>a+o.total_amt,0)},totalCount:orders.length};}
  else if(path==="/orders/status"&&method==="PUT") {state.orders=updateOrders(state.orders,data.orders??[],{order_status:data.status,status:data.status});value={updated:(data.orders??[]).length,failed:[]};save();}
  else if(path==="/orders/payment"&&method==="PUT") {state.orders=updateOrders(state.orders,data.orders??[],{pay_yn:data.ispaid??data.pay_yn??"Y",ispaid:data.ispaid??"Y",finbank:data.finbank??"Y",deposit_yn:data.deposit_yn??"Y"});value={updated:(data.orders??[]).length,failed:[]};save();}
  else if(path==="/orders/detail") {const order=state.orders.find(o=>o.ocodekey===data.ocodekey);value={order:order??{},header:order??{},items:order?[{seqno:1,iname:"제철 사과",unit:"박스",qty:1,cost:order.order_amt,amt:order.order_amt}]:[]};}
  else if(path==="/orders/delivery-methods") value=[{code:"10",name:"배송",gbn:"10",label:"배송"},{code:"20",name:"픽업",gbn:"20",label:"픽업"}];
  else if(path==="/orders/pay-methods") value=[{code:"10",name:"계좌입금",label:"계좌입금"}];
  else if(path==="/orders/url-orders") value=list("forms");
  else if(path==="/orders/excel-data") value={orders:selectOrders(state.orders,data),items:[]};
  else if(path==="/dashboard/order-status") value={status_received:0,status_packing:0,status_shipping:0,status_completed:0};
  else if(path==="/dashboard/recent-orders") value=state.orders.slice(0,10);
  else if(path==="/dashboard/pending-counts") value={unconfirmed:state.orders.filter(o=>o.order_status==="10").length,unpacked:0,unshipped:0,total_confirmed:0,total_packed:0,total_shipped:0,total_orders:state.orders.length};
  else if(path==="/dashboard/customer-alerts") value={new_customers:0,reorder_customers:0,low_balance_list:[]};
  else if(path==="/chat/settings") {if(method==="PUT"){state.settings.chat=data;save();}value={settings:state.settings.chat??{enabled:false,autoReplyOffHours:false,autoReplyText:"",notifyPc:false,notifyApp:false,bizHours:{from:"09:00",to:"18:00",days:"YYYYYNN"}}};}
  else if(path==="/chat/unread") value={unread:0};
  else if(path==="/chat/rooms") value={rooms:[],total:0,hasMore:false};
  else if(path==="/inquiry/unread-count") value={unread_count:0};
  else if(path==="/notice/list") value={list:[],items:[],total:0};
  else if(path==="/inquiry/list") value=[];
  else if(path==="/fee/list") value={fees:[],details:[]};
  else if(path==="/auth/login-popup") value={notices:[],items:[],popup:null};
  else if(path==="/urlorder-v2/hub") value={items:list("forms"),rows:list("forms"),recent:list("forms"),total:list("forms").length,latest:null};
  else if(path==="/urlorders/list") value=list("forms");
  else if(/^\/urlorders\/setting(?:\/\d+)?$/u.test(path)) {if(method==="GET")value={setting:{uocode:0,url_gbn:"V3",use_yn:"Y",title:"새 주문서"},items:[],delivery:[],payments:[]};else return blocked(config,"주문서 화면은 복제되었지만 원본의 저장 계약 전체는 아직 검증되지 않았습니다. 기존 ORDERFLOW 주문서는 별도 메뉴에서 사용할 수 있습니다.");}
  else if(path==="/images") value={images:[],total:0,folders:[]};
  else if(path==="/images/folders") value=[];
  else if(path==="/badges") value=[];
  else if(path==="/delivery-route/setting") value={origins:[],teams:[],setting:{}};
  else if(path==="/recurring-orders/summary") value={total:0,active:0,paused:0};
  else if(path==="/recurring-orders/list") value=[];
  else if(path==="/deposit/list") value=[];
  else if(path==="/customers/search") value=[];
  else if(path==="/customers/stats") value={total:0,new:0,vip:0};
  else if(path==="/customers/block/setting") {if(method==="PUT"){state.settings.block=data;save();}value=state.settings.block??{};}
  else if(path==="/sms/info") value={remainPoint:0,callback:"",callbackMobile:"",smsPrice:0,lmsPrice:0,mmsPrice:0};
  else if(path==="/sms/stats") value={total:0,success:0,fail:0,pending:0};
  else if(path==="/sms/history") value={list:[],items:[],total:0};
  else if(path==="/shop-setting") {if(method==="PUT"){state.settings.shop=data;save();}value=state.settings.shop??{kms_sangho:"아삭아삭",kms_callback_mobile:"",kms_order:"N",kms_order_callback_mobile:"",new_customer_sms:"N",new_customer_sms_mobile:"",random_orderno:"N",order_fr_no:1,order_to_no:999};}
  else if(path.startsWith("/shop-setting/logo")) value={url:null,logo_url:null,draft:null,hasLogo:false};
  else if(path==="/event-calendar") value=[];
  else if(["/sms/templates","/sms/address/groups","/sms/address/contacts","/sms/block","/chat/quick-replies"].some(p=>path===p||path.startsWith(p+"/"))) {
    const base=["/sms/templates","/sms/address/groups","/sms/address/contacts","/sms/block","/chat/quick-replies"].find(p=>path===p||path.startsWith(p+"/"));
    const records=list(base);
    if(method==="GET")value=base==="/chat/quick-replies"?{quickReplies:records}:records;
    else if(method==="POST"){const row={...data,seqno:Date.now(),id:Date.now()};records.push(row);value=row;save();}
    else if(method==="PUT"){const id=Number(path.split("/").at(-1));state.collections[base]=records.map(r=>r.id===id||r.seqno===id?{...r,...data}:r);value={updated:1};save();}
    else if(method==="DELETE"){const id=Number(path.split("/").at(-1));state.collections[base]=records.filter(r=>r.id!==id&&r.seqno!==id);value={deleted:1};save();}
  }
  else if(["/dashboard/top-items","/dashboard/action-log","/delivery-route/progress","/delivery-route/progress/stops","/delivery-route/teams","/delivery-route/origins","/delivery-fee/fees","/delivery-fee/shop-city","/customers/block","/customers/block/mobiles","/customers/point/history","/customers/prepayment/history","/customers/book","/sms/charge/history","/sms/block/log"].includes(path)) value=[];
  else if(method==="POST" && /(?:\/list|\/search|\/items|\/orders|\/history|\/item-summary|\/merge-list|\/merged-detail|\/pay-breakdown|\/messages)$/u.test(path)) {value=[];diagnostics.add(`${method} ${path}`);showNotice("시뮬레이션 · 일부 조회는 빈 시험 데이터입니다. 실제 서버 연동 검증 전입니다.");}
  else return blocked(config,"이 기능은 화면 복제 단계입니다. 서버 동작을 검증하기 전에는 저장·전송을 실행하지 않습니다.");
  return {data:ok(value),status:200,statusText:"OK",headers:{"x-replica-mode":"local-only"},config};
}

function mountControls() {
  const menu=document.createElement("button");menu.id="replica-menu-toggle";menu.textContent="☰ 메뉴";menu.setAttribute("aria-label","모바일 메뉴 열기");menu.setAttribute("aria-expanded","false");
  menu.addEventListener("click",()=>{const open=document.body.classList.toggle("replica-menu-open");menu.setAttribute("aria-expanded",String(open));});
  document.body.append(menu);
  const toolbar=document.createElement("aside"); toolbar.id="replica-tools";toolbar.setAttribute("aria-label","독립 복제본 시뮬레이션");
  toolbar.innerHTML='<details><summary>🟠 독립 복제 · 시뮬레이션</summary><p>원본은 변경하지 않습니다. 가상 데이터만 이 브라우저에 저장합니다.</p><p>문자·입금조회·현금영수증·카카오·권한변경은 실제 연동되지 않습니다.</p><button data-action="100">가상 주문 100건</button><button data-action="1000">가상 주문 1,000건</button><button data-action="reset">가상 데이터 초기화</button><a href="/admin">이전 ORDERFLOW 시뮬레이션</a><a href="/order/fresh-market">기존 새 앱 고객 주문서</a><a href="/overview">ORDERFLOW 소개</a><p id="replica-notice" role="status" aria-live="polite">원본 데이터 0건 · 외부 전송 없음</p></details>';
  toolbar.addEventListener("click",event=>{const action=event.target?.dataset?.action;if(!action)return;if(action==="reset"){if(!window.confirm("이 복제본의 가상 데이터만 초기화할까요? 원본과 실제 운영 데이터는 변경되지 않습니다."))return;state={version:1,orders:[],collections:{},settings:{}};}else state.orders=createOrders(Number(action));save();window.location.reload();});
  document.body.append(toolbar);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mountControls,{once:true});else mountControls();

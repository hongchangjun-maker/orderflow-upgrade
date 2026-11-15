import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createOrders, selectOrders, summaryOf, updateOrders } from "../public/replica-assets/model.mjs";

test("replica fixture is bounded, unique, synthetic, and searchable",()=>{
  const orders=createOrders(5000);
  assert.equal(orders.length,2000);
  assert.equal(new Set(orders.map(o=>o.ocodekey)).size,2000);
  assert.equal(selectOrders(orders,{searchData:"가상고객 2000"}).length,1);
  const updated=updateOrders(orders,[{ocodekey:"SIM-1"}],{order_status:"40"});
  assert.equal(updated[0].order_status,"40");
  assert.equal(orders[0].order_status,"00");
  assert.equal(summaryOf(updated).today_sales_amount,summaryOf(orders).today_sales_amount-orders[0].total_amt);
});

test("reconstruction bytes and critical isolation anchors are frozen",async()=>{
  const [app,runtime,worker,manifest,css]=await Promise.all(["../public/replica-assets/application.js","../public/replica-assets/runtime.mjs","../worker/index.ts","../public/replica-assets/provenance.json","../public/replica-assets/reference.css"].map(p=>readFile(new URL(p,import.meta.url),"utf8")));
  const meta=JSON.parse(manifest);
  assert.equal(createHash("sha256").update(app).digest("hex"),meta.outputSha256);
  assert.match(app,/\$s\.defaults\.adapter=replicaAdapter/);
  assert.match(app,/basename:"\/replica"/);
  assert.match(app,/const s=replicaSocket/);
  assert.doesNotMatch(app,/Notification\.requestPermission\(/);
  assert.doesNotMatch(app,/https:\/\/(?:xn--9y2bw0aj3kmoj8tj|xn--z92bu1i0sh|링크주문서)/);
  assert.doesNotMatch(runtime,/\bfetch\(|new (?:WebSocket|XMLHttpRequest)\(/);
  assert.match(worker,/connect-src 'none'/);
  assert.match(worker,/form-action 'none'/);
  assert.match(css,/#d65b13/i);
  assert.match(css,/#612b16/i);
});

test("local adapter never transmits and refuses provider mutations",async()=>{
  const makeStorage=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),key:i=>[...m.keys()][i],get length(){return m.size}}};
  globalThis.window={localStorage:makeStorage(),sessionStorage:makeStorage()};
  globalThis.document={readyState:"loading",addEventListener(){},getElementById(){return null}};
  const {replicaAdapter}=await import("../public/replica-assets/runtime.mjs");
  const request=(url,method="get",data)=>replicaAdapter({url,method,data});
  assert.equal((await request("/dashboard/today-summary")).data.data.today_order_count,0);
  assert.equal((await request("/account/perms/mine")).data.data.role,"OWNER");
  await assert.rejects(request("/sms/send","post",{}),/독립 시뮬레이션/);
  await assert.rejects(request("/orders/cashreceipt","post",{}),/독립 시뮬레이션/);
  await assert.rejects(request("/auth/change-password","put",{}),/독립 시뮬레이션/);
  await request("/sms/templates","post",{title:"시험용",contents:"연습"});
  assert.equal((await request("/sms/templates")).data.data[0].title,"시험용");
  assert.ok([...Array(window.localStorage.length)].every((_,i)=>window.localStorage.key(i).startsWith("orderflow:orange-replica:v1:")));
  delete globalThis.window;delete globalThis.document;
});

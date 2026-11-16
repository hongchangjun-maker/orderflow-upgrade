import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const report=JSON.parse(await readFile(new URL('../outputs/live-http-report.json',import.meta.url),'utf8'));
const base='https://orderflow-korea-upgrade-staging.hhongcjun.workers.dev';
assert.equal(report.base,base,'Repeated writes are staging-only');
const token=new URL(report.publicFormUrl).pathname.split('/').pop();
const path=`${base}/api/live-public/form/${token}`;
const catalog=await (await fetch(path)).json();
assert.equal(catalog.data.items.length,20);
const rounds=Number(process.env.BURST_ROUNDS??2);
const load=Number(process.env.BURST_LOAD??300);
assert.ok(Number.isInteger(rounds)&&rounds>=1&&rounds<=2);
assert.ok(Number.isInteger(load)&&load>=1&&load<=300);
assert.ok(catalog.data.items.every(i=>Number(i.stock)>=load*rounds),'Insufficient fixture inventory');
const run=crypto.randomUUID(),results=[];
for(let round=0;round<rounds;round++){
  const burst=await Promise.all(Array.from({length:load},async(_,i)=>{
    const start=performance.now();
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','x-orderflow-request':'1'},body:JSON.stringify({cust_name:'반복부하 검증',mobile:`010${String(90000000+round*1000+i)}`,addr:'검증 전용 주소, 실제 배송 금지',consent:true,idempotencyKey:`${run}-${round}-${i}`,items:catalog.data.items.map(item=>({seqno:item.id,qty:1}))})});
    const body=await response.json();return {status:response.status,error:body.error,ms:Math.round(performance.now()-start)};
  }));
  const failed=burst.filter(r=>r.status!==200),times=burst.map(r=>r.ms).sort((a,b)=>a-b);
  results.push({round:round+1,customers:load,itemsPerOrder:20,success:load-failed.length,p95ms:times[Math.floor(load*.95)],failures:failed});
  await writeFile(new URL('../outputs/repeated-burst-report.json',import.meta.url),JSON.stringify({base,run,results,passed:results.every(r=>r.success===load)},null,2));
  console.log(JSON.stringify(results.at(-1)));
  assert.equal(failed.length,0,'Repeated burst failed; inspect staging logs');
}

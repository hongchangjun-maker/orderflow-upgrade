// Temporary public entry is strictly limited to the separate staging database.
import {sha256Hex,scopedFingerprint} from '../../lib/security';
import {getD1} from '../../lib/data';
import {context} from './context';
import {LiveError} from './domain';
import {saveForm} from './forms';
import {createLiveOrder} from './orders';
import {now,type LiveContext} from './store';
import {publicTestEnabled} from './test-mode';
export async function openTestSession(request:Request){
  if(!publicTestEnabled())throw new LiveError('운영 환경에서는 테스트 접속을 만들 수 없습니다.',404);
  if(request.headers.get('x-orderflow-request')!=='1'||request.headers.get('origin')!==new URL(request.url).origin)throw new LiveError('허용되지 않은 요청입니다.',403);
  try{const current=await context(request);if(current.permissions.testMode===true)return {cookie:null,shop:current.shop};}catch(error){if(!(error instanceof LiveError)||error.status!==401)throw error;}
  const db=getD1(),time=now(),fingerprint=await scopedFingerprint(request,'public-test-entry');
  const gate=await db.prepare('INSERT INTO of_submissions(fingerprint,created_at) SELECT ?,? WHERE (SELECT COUNT(*) FROM of_submissions WHERE fingerprint=? AND created_at>?)<20').bind(fingerprint,time,fingerprint,new Date(Date.now()-3600000).toISOString()).run();
  if(!gate.meta.changes)throw new LiveError('테스트 공간 생성이 많습니다. 기존 브라우저를 이용하거나 잠시 후 다시 시도해 주세요.',429);
  const shop=crypto.randomUUID().replaceAll('-',''),token=crypto.randomUUID()+crypto.randomUUID(),actor=`test-${shop}@orderflow.invalid`,expires=new Date(Date.now()+12*3600000).toISOString();
  await db.batch([
    db.prepare('INSERT INTO of_shops(id,owner,name,created_at) VALUES(?,?,?,?)').bind(shop,actor,'청과 테스트 매장',time),
    db.prepare("INSERT INTO of_staff(shop,login,name,password_hash,role,permissions) VALUES(?,?,?,'!disabled-test-password','OWNER',?)").bind(shop,actor,'테스트 사용자',JSON.stringify({testMode:true})),
    db.prepare('INSERT INTO of_sessions(hash,staff_id,expires_at) VALUES(?,(SELECT id FROM of_staff WHERE login=?),?)').bind(await sha256Hex(token),actor,expires),
  ]);
  const c:LiveContext={db,shop,actor,role:'OWNER',permissions:{testMode:true},origin:new URL(request.url).origin};
  const names=['사과','배','감귤','딸기','샤인머스캣','포도','복숭아','수박','참외','멜론','바나나','오렌지','키위','토마토','방울토마토','감자','고구마','양파','당근','오이'];
  const form=await saveForm(c,{title:'청과 주문 테스트 · 실제 배송 없음',use_gbn:'Y',shipping_fee:3000,delivery_deliver:'Y',delivery_pickup:'Y',pay_tran:'Y',pay_store:'Y',close_at:expires,notice:'테스트 전용 주문서입니다. 실제 개인정보나 배송 주소를 입력하지 마세요.',items:names.map((iname,i)=>({iname,unit:'박스',cost:10000+i*500,stock:500,disp_gbn:'Y',...(iname==='복숭아'?{imageUrls:['/visuals/products/peach.webp']}:iname==='멜론'?{imageUrls:['/visuals/products/melon.webp']}:{})}))});
  for(let i=0;i<3;i++)await createLiveOrder(c,Number(form.int_value1),{cust_name:`테스트 고객 ${i+1}`,mobile:`0100000000${i+1}`,addr:'테스트 주소 · 실제 배송 금지',delivery_gbn:'direct',pay_gbn:'transfer',idempotencyKey:`sample-${shop}-${i}`,items:[{seqno:form.items[i].seqno,qty:i+1},{seqno:form.items[i+3].seqno,qty:1}]});
  return {shop,cookie:`orderflow_staff=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`};
}

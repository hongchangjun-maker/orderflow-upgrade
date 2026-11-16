import {sha256Hex,scopedFingerprint} from '../../lib/security';
import {cookieValue} from './credentials';
import {integer,LiveError,mobileOf,required,text,type Doc} from './domain';
import {audit,first,now,query,type LiveContext} from './store';
export async function verifiedCustomer(db:D1Database,request:Request,shop?:string){
  const cookie=cookieValue(request,'orderflow_customer');if(!cookie)return null;
  const row=await db.prepare('SELECT a.shop,a.mobile,a.hash FROM of_customer_sessions s JOIN of_customer_access a ON a.hash=s.access_hash WHERE s.hash=? AND s.expires_at>? AND a.active=1 AND a.expires_at>?').bind(await sha256Hex(cookie),now(),now()).first<{shop:string;mobile:string;hash:string}>();
  if(!row||shop&&row.shop!==shop)return null;return row;
}
export async function customerAccessApi(c:LiveContext,path:string,method:string,data:Doc){
  if(path!=='/customers/access-link')return undefined;
  if(method==='DELETE'){await c.db.prepare('UPDATE of_customer_access SET active=0 WHERE shop=? AND mobile=?').bind(c.shop,mobileOf(data.mobile)).run();await audit(c,'customer:access-revoke',text(data.mobile).slice(-4));return{revoked:true};}
  const mobile=mobileOf(data.mobile);const token=crypto.randomUUID().replaceAll('-','');const hash=await sha256Hex(token);
  const form=data.uocode?await first(c,'SELECT token FROM of_forms WHERE id=? AND shop=?',Number(data.uocode),c.shop):null;
  if(data.uocode&&!form)throw new LiveError('주문서를 찾을 수 없습니다.',404);
  const pin=text(data.pin)||mobile.slice(-4);if(!/^\d{4,8}$/u.test(pin))throw new LiveError('확인번호는 숫자 4~8자리로 입력해 주세요.',422);
  const expiresAt=new Date(Date.now()+integer(data.days??30,1,90)*86400000).toISOString();
  await c.db.prepare('INSERT INTO of_customer_access(hash,shop,mobile,pin_hash,expires_at) VALUES(?,?,?,?,?)').bind(hash,c.shop,mobile,await sha256Hex(`${hash}:${pin}`),expiresAt).run();
  await audit(c,'customer:access-link',mobile.slice(-4));
  let url=`${c.origin}/customer/${token}`;
  if(form)url=`${c.origin}/buy/${form.token}?customer=${token}`;
  return {url,token,expiresAt,pinHint:data.pin?'설정한 확인번호':'휴대폰 번호 뒤 4자리'};
}
export async function customerProfile(db:D1Database,request:Request,token:string,data?:Doc){
  if(!/^[a-f\d]{32}$/u.test(token))throw new LiveError('유효하지 않은 고객전용 링크입니다.',404);
  const hash=await sha256Hex(token),access=await db.prepare('SELECT * FROM of_customer_access WHERE hash=? AND active=1 AND expires_at>?').bind(hash,now()).first<Doc>();
  if(!access)throw new LiveError('고객전용 링크가 만료됐습니다. 매장에 새 링크를 요청해 주세요.',410);
  const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store'});
  let verified=await verifiedCustomer(db,request,String(access.shop));
  if(data){
    const fingerprint=await scopedFingerprint(request,`customer-pin:${hash}`);
    const gate=await db.prepare('INSERT INTO of_submissions(fingerprint,created_at) SELECT ?,? WHERE (SELECT COUNT(*) FROM of_submissions WHERE fingerprint=? AND created_at>?)<5').bind(fingerprint,now(),fingerprint,new Date(Date.now()-600000).toISOString()).run();
    if(!gate.meta.changes)throw new LiveError('확인번호 시도가 많습니다. 10분 후 다시 시도해 주세요.',429);
    if(await sha256Hex(`${hash}:${required(data.last4??data.pin,'확인번호',8)}`)!==access.pin_hash)throw new LiveError('고객 확인번호가 일치하지 않습니다.',401);
    const session=crypto.randomUUID()+crypto.randomUUID();await db.prepare('INSERT INTO of_customer_sessions(hash,access_hash,expires_at) VALUES(?,?,?)').bind(await sha256Hex(session),hash,new Date(Date.now()+3600000).toISOString()).run();
    headers.append('Set-Cookie',`orderflow_customer=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`);
    verified={shop:String(access.shop),mobile:String(access.mobile),hash};
  }
  const authenticated=!!verified&&verified.hash===hash;
  const base={authenticated,mobileMasked:String(access.mobile).replace(/(\d{3})\d+(\d{4})/u,'$1-****-$2')};
  if(!authenticated)return Response.json({success:true,data:base},{headers});
  const customer=await db.prepare('SELECT name FROM of_customers WHERE shop=? AND mobile=?').bind(access.shop,access.mobile).first<Doc>();
  const c:LiveContext={db,shop:String(access.shop),actor:'customer',role:'CUSTOMER',permissions:{},origin:new URL(request.url).origin};
  const balances=await query(c,'SELECT kind,SUM(delta) balance FROM of_ledger WHERE shop=? AND mobile=? GROUP BY kind',access.shop,access.mobile);
  const orders=await query(c,"SELECT o.id,o.key,o.order_date,o.status,o.ispaid,o.amount+o.fee-COALESCE(json_extract(o.data,'$.point_used'),0)+COALESCE(json_extract(o.data,'$.adjustment'),0) total FROM of_orders o JOIN of_customers cu ON cu.id=o.customer_id WHERE o.shop=? AND cu.mobile=? ORDER BY o.id DESC LIMIT 100",access.shop,access.mobile);
  const forms=await query(c,"SELECT token,json_extract(data,'$.title') title FROM of_forms WHERE shop=? AND active=1 ORDER BY id DESC LIMIT 50",access.shop);
  return Response.json({success:true,data:{...base,customerName:customer?.name??'',mobile:access.mobile,orders,forms:forms.map(f=>({...f,url:`/buy/${f.token}?customer=${token}`})),pointBalance:Number(balances.find(b=>b.kind==='point')?.balance??0),prepayBalance:Number(balances.find(b=>b.kind==='prepay')?.balance??0)}},{headers});
}

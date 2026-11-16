import {verifyAdminPassword} from '../../lib/auth';
import {sha256Hex} from '../../lib/security';
import {cookieValue,passwordHash,verifyPassword} from './credentials';
import {LiveError,required,text,type Doc} from './domain';
import {audit,first,now,transaction,type LiveContext} from './store';
export async function ownerSession(request:Request,db:D1Database):Promise<LiveContext|null>{
  const token=cookieValue(request,'orderflow_owner');if(!token)return null;
  const owner=await db.prepare('SELECT c.email,c.shop FROM of_owner_sessions s JOIN of_owner_credentials c ON c.email=s.email AND c.version=s.version WHERE s.hash=? AND s.expires_at>?').bind(await sha256Hex(token),now()).first<{email:string;shop:string}>();
  if(!owner)throw new LiveError('사장님 세션이 만료됐습니다. 다시 로그인해 주세요.',401);
  return{db,shop:owner.shop,actor:owner.email,role:'OWNER',permissions:{},origin:new URL(request.url).origin};
}
export async function loginStoredOwner(db:D1Database,email:string,password:string,headers:Headers):Promise<'missing'|'valid'|'invalid'>{
  const row=await db.prepare('SELECT password_hash,version FROM of_owner_credentials WHERE email=?').bind(email).first<{password_hash:string;version:number}>();
  if(!row)return'missing';if(!await verifyPassword(password,row.password_hash))return'invalid';
  const token=crypto.randomUUID()+crypto.randomUUID();
  await db.prepare('INSERT INTO of_owner_sessions(hash,email,version,expires_at) VALUES(?,?,?,?)').bind(await sha256Hex(token),email,row.version,new Date(Date.now()+43200000).toISOString()).run();
  headers.append('Set-Cookie',`orderflow_owner=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`);
  return'valid';
}
export async function changeOwnerPassword(c:LiveContext,input:Doc){
  if(c.role!=='OWNER')throw new LiveError('사장님만 변경할 수 있습니다.',403);
  const current=text(input.currentPassword??input.oldPassword??input.old_password,128);
  const old=await first(c,'SELECT password_hash,version FROM of_owner_credentials WHERE email=? AND shop=?',c.actor,c.shop);
  const valid=old?await verifyPassword(current,String(old.password_hash)):await verifyAdminPassword(current);
  if(!valid)throw new LiveError('현재 비밀번호를 확인해 주세요.',401);
  const hash=await passwordHash(required(input.newPassword??input.new_password,'새 비밀번호',128));
  await transaction(c,[
    c.db.prepare('INSERT INTO of_owner_credentials(email,shop,password_hash,updated_at) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash,version=of_owner_credentials.version+1,updated_at=excluded.updated_at').bind(c.actor,c.shop,hash,now()),
    c.db.prepare('DELETE FROM of_owner_sessions WHERE email=?').bind(c.actor),
  ],[{sql:old?'EXISTS(SELECT 1 FROM of_owner_credentials WHERE email=? AND version=?)':'NOT EXISTS(SELECT 1 FROM of_owner_credentials WHERE email=?)',values:old?[c.actor,old.version]:[c.actor]}]);
  await audit(c,'owner:password-change','self');return{changed:true,relogin:true};
}

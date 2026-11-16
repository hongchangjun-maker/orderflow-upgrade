import {LiveError} from './domain';
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export async function passwordHash(password:string,salt=crypto.randomUUID()){
  if(password.length<10||password.length>128)throw new LiveError('비밀번호는 10~128자로 설정해 주세요.',422);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),{name:'PBKDF2'},false,['deriveBits']);
  return `${salt}:${hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:100000},key,256))}`;
}
export async function verifyPassword(password:string,stored:string){
  try{const actual=await passwordHash(password,stored.split(':')[0]);if(actual.length!==stored.length)return false;let delta=0;for(let i=0;i<actual.length;i++)delta|=actual.charCodeAt(i)^stored.charCodeAt(i);return delta===0;}catch{return false;}
}
export function cookieValue(request:Request,name:string){return request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)??'';}
export const clearCookie=(name:string)=>`${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

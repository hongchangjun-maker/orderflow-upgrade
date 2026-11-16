import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyReplicaAssets} from './verify-replica-assets.mjs';
const base='https://orderflow-korea-upgrade.hhongcjun.workers.dev';
const checks=[];
await verifyReplicaAssets(base);
const check=(name)=>{checks.push(name);console.log(`PASS ${name}`);};
const health=await fetch(base+'/api/health');assert.equal(health.status,200);const status=await health.json();assert.equal(status.database,'connected');assert.equal(status.environment,'production');assert.equal(status.authConfigured,true);check('production D1 connected and existing auth configured');
for(const path of ['/api/replica/session','/api/admin/orders']){assert.equal((await fetch(base+path)).status,401);}
assert.equal((await fetch(base+'/api/replica/session',{headers:{Authorization:'Bearer HTTPONLY-COOKIE-SESSION'}})).status,401);check('new and preserved admin APIs reject anonymous and UI-token access');
const replica=await fetch(base+'/replica',{redirect:'manual'});assert.equal(replica.status,303);assert.match(replica.headers.get('location'),/\/sign-in$/u);assert.match(replica.headers.get('content-security-policy'),/connect-src 'self'/u);assert.equal(replica.headers.get('cache-control'),'no-store');check('seller route enforces login and isolated CSP');
const signin=await fetch(base+'/sign-in');assert.equal(signin.status,200);assert.match(await signin.text(),/운영 로그인/u);check('production sign-in renders');
for(const filename of ['runtime.mjs','application.js']){const live=await fetch(base+'/replica-assets/'+filename);assert.equal(live.status,200);const liveBytes=new Uint8Array(await live.arrayBuffer()),local=await readFile(new URL('../public/replica-assets/'+filename,import.meta.url));assert.equal(createHash('sha256').update(liveBytes).digest('hex'),createHash('sha256').update(local).digest('hex'));}check('deployed runtime and pinned presentation hashes match verified checkout');
const mutation=await fetch(base+'/api/replica/workspace/form',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(mutation.status,403);
const cross=await fetch(base+'/api/replica/workspace/form',{method:'POST',headers:{'Content-Type':'application/json','x-orderflow-request':'1',Origin:'https://example.invalid'},body:'{}'});assert.equal(cross.status,403);check('production rejects missing CSRF header and cross-origin writes');
await mkdir(new URL('../outputs/',import.meta.url),{recursive:true});await writeFile(new URL('../outputs/production-verification.json',import.meta.url),JSON.stringify({base,time:new Date().toISOString(),checks,passed:true},null,2));

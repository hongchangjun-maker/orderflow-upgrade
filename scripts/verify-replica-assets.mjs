import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export async function verifyReplicaAssets(base){
  const release=await readFile(new URL('../app/modules/live/release.ts',import.meta.url),'utf8');
  const version=release.match(/REPLICA_ASSET_VERSION\s*=\s*['"]([^'"]+)['"]/u)?.[1];
  assert.ok(version);
  for(const file of ['application.js','runtime.mjs','order-dto.mjs']){
    const expected=createHash('sha256').update(await readFile(new URL('../public/replica-assets/'+file,import.meta.url))).digest('hex');
    const response=await fetch(base+'/replica-assets/'+version+'/'+file);
    assert.equal(response.status,200,file);
    assert.equal(createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex'),expected,file);
    assert.match(response.headers.get('cache-control'),/immutable/u);
  }
  const style=await fetch(base+'/replica-assets/isolation.css?v='+version);
  assert.equal(style.status,200);assert.equal(await style.text(),await readFile(new URL('../public/replica-assets/isolation.css',import.meta.url),'utf8'));
  console.log('PASS release-versioned source module graph and modal-safe CSS hashes');return version;
}

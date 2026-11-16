import assert from 'node:assert/strict';
import {request as httpsRequest} from 'node:https';
const verified=new Set();
export async function verifyUploadBoundary(base,cookie=''){
  assert.ok(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/u.test(base)||base==='https://orderflow-korea-upgrade-staging.hhongcjun.workers.dev');
  if(verified.has(base+cookie))return;
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVJkAAAAASUVORK5CYII=','base64');
  const chunk=Buffer.alloc(10_000_000-png.length);chunk.writeUInt32BE(chunk.length-12,0);chunk.write('ofQa',4);
  const table=Array.from({length:256},(_,n)=>{let crc=n;for(let i=0;i<8;i++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;return crc>>>0;});
  let crc=0xffffffff;for(const byte of chunk.subarray(4,-4))crc=table[(crc^byte)&255]^(crc>>>8);chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);
  const large=Buffer.concat([png.subarray(0,-12),chunk,png.subarray(-12)]);
  const send=async(bytes,name)=>{
    const boundary='orderflow-'+crypto.randomUUID();
    const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)]);
    if(base.startsWith('http:'))return fetch(base+'/api/replica/images/upload',{method:'POST',headers:{'Content-Type':`multipart/form-data; boundary=${boundary}`,'x-orderflow-request':'1',...(cookie?{cookie}:{})},body,signal:AbortSignal.timeout(90_000)});
    // A dedicated TLS-verified connection avoids reusing the stress runner's
    // hundreds of pooled undici sockets for a large multipart upload.
    return new Promise((resolve,reject)=>{
      const request=httpsRequest(base+'/api/replica/images/upload',{method:'POST',agent:false,headers:{'Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':body.length,'x-orderflow-request':'1',...(cookie?{cookie}:{})},signal:AbortSignal.timeout(90_000)},response=>{
        const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);response.on('end',()=>resolve({status:response.statusCode,arrayBuffer:async()=>Buffer.concat(chunks)}));
      });request.on('error',reject);request.end(body);
    });
  };
  console.log('CHECK uploading 10MB PNG on fresh connection');
  const accepted=await send(large,'boundary.png');assert.equal(accepted.status,200);await accepted.arrayBuffer();
  console.log('PASS actual 10MB PNG accepted; checking 10000001 bytes');
  const rejected=await send(Buffer.alloc(10_000_001),'over.png');assert.equal(rejected.status,413);await rejected.arrayBuffer();
  console.log('PASS actual oversized upload rejected');verified.add(base+cookie);
}

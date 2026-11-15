import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
const root=resolve(import.meta.dirname,"..");
const source=await readFile(resolve(root,"app/replica/[[...path]]/route.ts"),"utf8");
const html=source.match(/new Response\(`([^`]+)`/u)?.[1];
if(!html)throw new Error("Replica document unavailable");
const types={".js":"text/javascript",".mjs":"text/javascript",".css":"text/css",".json":"application/json"};
http.createServer(async(req,res)=>{
  const path=new URL(req.url,"http://localhost").pathname;
  if(path==="/replica"||path.startsWith("/replica/")){
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"});res.end(html);return;
  }
  if(/^\/replica-assets\/[a-z0-9.-]+$/u.test(path)){
    try{res.writeHead(200,{"Content-Type":types[extname(path)]??"application/octet-stream"});res.end(await readFile(resolve(root,"public",path.slice(1))));}catch{res.end("");}return;
  }
  res.writeHead(404);res.end("Not found");
}).listen(3016,"127.0.0.1",()=>console.log("Replica isolated preview: http://127.0.0.1:3016/replica"));

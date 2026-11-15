import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// Mechanical reconstruction of user-owned shipped UI. Never executes the input.
const input = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Explicit reference directory required");
const root = resolve(import.meta.dirname, "..");
const js = await readFile(resolve(input, "index.js"), "utf8");
const css = await readFile(resolve(input, "index.css"), "utf8");
const sha = (s) => createHash("sha256").update(s).digest("hex");
if (sha(js) !== "fc48b6f9798201f29a16e53f78638c2b6bcd8a6fca07b94d26067d4ca339704c") throw new Error("Reference bytes changed; review before regeneration");
const patches = [];
function replaceOnce(text, from, to, reason) {
  if (text.split(from).length !== 2) throw new Error(`Non-unique reconstruction anchor: ${reason}`);
  patches.push(reason);
  return text.replace(from, to);
}
let output = replaceOnce(js, "const $s=eY(B3);", "const $s=eY(B3);$s.defaults.adapter=replicaAdapter;", "All Axios clients use isolated local adapter");
output = replaceOnce(output, "i.jsx(gce,{children:i.jsx(oZe,{})})", "i.jsx(gce,{basename:\"/replica\",children:i.jsx(oZe,{})})", "Preserve original routes inside replica namespace");
output = replaceOnce(output, "const s=FGe(r,n);", "const s=replicaSocket;", "Disable original realtime network connection");
output = output.replaceAll("Notification.requestPermission()", "Promise.resolve(\"denied\")");
output = output.replaceAll(/\blocalStorage\b/gu, "replicaStorage").replaceAll(/\bsessionStorage\b/gu, "replicaSessionStorage");
// Original public URLs must never receive copied order/session data.
output = output.replaceAll(/https:\/\/(?:xn--9y2bw0aj3kmoj8tj\.kr|xn--z92bu1i0sh\.kr|링크주문서\.kr)[^\s"'`<>]*/gu, "/replica");
output = output.replaceAll('fetch("/manual/app/help-map.json",{cache:"no-cache"})', 'Promise.resolve(new Response("{}",{headers:{"Content-Type":"application/json"}}))');
const palette = {"3b4caf":"d65b13","2f96f9":"f9a23f","1e2a5e":"612b16","303f9f":"a9430d","2f3e96":"ad4810","2d3a8c":"a44312","2f3e8f":"a44312","2f3d8f":"a44312","eef0ff":"fff0e4","e8eaf6":"fff0e2","c7d2fe":"f5c6a4","f4f6fb":"fff8f2","e8edff":"fff0e2","3b5bdb":"c95b1a","2f3e8e":"a44312","dee1ff":"ffe2ca","d9ddf3":"f5d3b6","eef0fb":"fff3e8"};
function orange(text) {
  return text.replace(/#([\da-f]{6})([\da-f]{2})?\b/giu, (whole, rgb, alpha="") => palette[rgb.toLowerCase()] ? `#${palette[rgb.toLowerCase()]}${alpha}` : whole)
    .replaceAll(/(?<![\w-])(blue|indigo|purple)-(?=\d)/gu, "orange-");
}
output = orange(output);
output = 'import { replicaAdapter, replicaStorage, replicaSessionStorage, replicaSocket } from "/replica-assets/runtime.mjs";\n' + output;
const target = resolve(root, "public/replica-assets");
await mkdir(target, { recursive: true });
await writeFile(resolve(target, "application.js"), output);
await writeFile(resolve(target, "reference.css"), orange(css));
await writeFile(resolve(target, "provenance.json"), JSON.stringify({ referenceUrl: "https://xn--9y2bw0aj3kmoj8tj.kr/", captured: "2026-11-16", sourceSha256: sha(js), stylesheetSha256: sha(css), outputSha256: sha(output), patches, limitations: ["Shipped frontend only; source backend is unavailable.", "All application requests are local simulations, never actual bank/SMS/payment operations."] }, null, 2));
console.log(JSON.stringify({ outputSha256: sha(output), bytes: Buffer.byteLength(output), patches }));

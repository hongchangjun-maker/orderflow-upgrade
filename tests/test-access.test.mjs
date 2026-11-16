import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const compile=source=>ts.transpileModule(source.replace(/^import[^\n]*\n/gmu,'').replace(/^export /gmu,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const modeCode=compile(await readFile(new URL('../app/modules/live/test-mode.ts',import.meta.url),'utf8'));
test('public test flag is staging-only and cannot enable anonymous production sessions',()=>{
  for(const [environment,flag,expected]of [['production','1',false],['staging','1',true],['staging','0',false],['development','1',false]]){
    const enabled=new Function('runtimeValue',modeCode+'; return publicTestEnabled;')(key=>key==='ENVIRONMENT'?environment:flag);
    assert.equal(enabled(),expected);
  }
});
const contextCode=compile(await readFile(new URL('../app/modules/live/context.ts',import.meta.url),'utf8'));
class LiveError extends Error{constructor(message,status){super(message);this.status=status;}}
function fixture(enabled,guest){
  const user={shop:'test-scope',login:'test@orderflow.invalid',role:guest?'OWNER':'STAFF',permissions:JSON.stringify(guest?{testMode:true}:{})};
  const db={prepare:()=>({bind:()=>({first:async()=>user})})};
  return new Function('getAdminUser','getD1','sha256Hex','LiveError','parse','ownerSession','publicTestEnabled',contextCode+'; return context;')(async()=>null,()=>db,async()=>'',LiveError,JSON.parse,async()=>null,()=>enabled);
}
const request=()=>new Request('https://test.invalid',{headers:{cookie:'orderflow_staff=test-only-fixture'}});
test('automatic test session remains scoped to its own authenticated test shop',async()=>{
  const context=await fixture(true,true)(request());assert.equal(context.shop,'test-scope');assert.equal(context.permissions.testMode,true);
});
test('disabling test mode invalidates existing guest sessions despite their owner role',async()=>{
  await assert.rejects(fixture(false,true)(request()),error=>error.status===401);
});
test('disabling temporary guest access does not disable ordinary staff authentication',async()=>{
  const context=await fixture(false,false)(request());assert.equal(context.role,'STAFF');
});

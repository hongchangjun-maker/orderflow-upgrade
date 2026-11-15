import ts from "typescript";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root=resolve(import.meta.dirname,"..");
const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed});
async function format(dir){for(const entry of await readdir(resolve(root,dir),{withFileTypes:true})){const path=`${dir}/${entry.name}`;if(entry.isDirectory())await format(path);else if(/\.tsx?$/u.test(path)){const content=await readFile(resolve(root,path),"utf8");const parsed=ts.createSourceFile(path,content,ts.ScriptTarget.Latest,true,path.endsWith("tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);await writeFile(resolve(root,path),printer.printFile(parsed));}}}
for(const path of ["app/modules/live","app/modules/live-client","app/live-ui","app/sign-in","app/workspace"])await format(path);

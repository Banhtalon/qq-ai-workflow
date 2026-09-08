import {readFile,readdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {validateProfile} from "./lib/workflow.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
async function walk(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else out.push(p);}return out;}
const profile=JSON.parse(await readFile(path.join(root,".ai-workflow/PROJECT_PROFILE.example.json"),"utf8"));
validateProfile(profile);
const files=[...await walk(path.join(root,".ai-workflow")),path.join(root,"AGENTS.md"),path.join(root,"GEMINI.md"),path.join(root,"README.md")];
for(const f of files){
 const s=await readFile(f,"utf8");
 if(/CONTROLLER_BOOTSTRAP|TECHNICAL_OPERATOR_BOOTSTRAP|scripts\/prepare-attempt|V9_CANONICAL_SPEC/.test(s))throw Error("stale entry point: "+f);
 for(const m of s.matchAll(/\]\(([^)]+)\)/g)){
   if(/^(https?:|#)/.test(m[1]))continue;
   await readFile(path.resolve(path.dirname(f),m[1]),"utf8");
 }
}
console.log("PASS: active profile, entry points and documentation links");

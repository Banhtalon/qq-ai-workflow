import {readFile,readdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {validateProfile} from "./lib/workflow.mjs";
import {ENTRY_POINT_FILES,REFERENCE_GUIDANCE_FILES,guidanceRuleDriftTerms} from "./lib/documentation.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
async function walk(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else out.push(p);}return out;}
const profile=JSON.parse(await readFile(path.join(root,".ai-workflow/PROJECT_PROFILE.example.json"),"utf8"));
validateProfile(profile);
const files=[...await walk(path.join(root,".ai-workflow")),path.join(root,"AGENTS.md"),path.join(root,"GEMINI.md"),path.join(root,"README.md")];
for(const f of files){
 const s=await readFile(f,"utf8");
 if(/CONTROLLER_BOOTSTRAP|TECHNICAL_OPERATOR_BOOTSTRAP|scripts\/prepare-attempt|V9_CANONICAL_SPEC/.test(s))throw Error("stale entry point: "+f);
 for(const m of s.matchAll(/\]\(([^)]+)\)/g)){
   const target=m[1].split("#",1)[0];
   if(!target||/^(https?:)/.test(target))continue;
   await readFile(path.resolve(path.dirname(f),target),"utf8");
 }
}
for(const relative of ENTRY_POINT_FILES){
 const actual=await readFile(path.join(root,relative),"utf8");
 const fixture=await readFile(path.join(root,"test/fixtures/reference-entrypoints",relative),"utf8");
 if(actual!==fixture)throw Error("entry point differs from approved fixture: "+relative);
}
for(const relative of REFERENCE_GUIDANCE_FILES){
 const terms=guidanceRuleDriftTerms(await readFile(path.join(root,relative),"utf8"));
 if(terms.length)console.warn("WARN: guidance may add workflow rules: "+relative+" ("+terms.join(", ")+")");
}
console.log("PASS: active profile, entry points, documentation links and reference fixtures");

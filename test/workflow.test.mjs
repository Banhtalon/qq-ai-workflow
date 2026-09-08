import test from "node:test";
import assert from "node:assert/strict";
import {writeFile,readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {fixture,review,profile} from "./fixture.mjs";
import {validateTask,validateProfile,contractHash,writeJson,readJson,freeze,verify,readiness,route,git} from "../scripts/lib/workflow.mjs";
import {runRedacted,redactText,argvForPlatform} from "../scripts/lib/redact.mjs";

const cli=fileURLToPath(new URL("../scripts/workflow.mjs",import.meta.url));
test("CLI rejects legacy secret-bearing gates without creating or overwriting evidence",async()=>{
 const marker="synthetic-review-marker-012345";
 for(const extra of [["token="+marker],["--token",marker],[marker]]){
  const f=await fixture();try{
   // Model a packet frozen by an older kit, before metadata validation existed.
   f.task.gates[0].argv.push(...extra);
   f.task.contract_sha256=contractHash(f.task);
   await writeJson(f.taskPath,f.task);
   const lock=await readJson(f.taskPath+".lock.json");
   lock.contract_sha256=f.task.contract_sha256;await writeJson(f.taskPath+".lock.json",lock);
   const out=path.join(f.dir,"evidence.json");
   for(const existing of [false,true]){
    if(existing)await writeFile(out,"existing evidence\n");
    const result=spawnSync(process.execPath,[cli,"verify",f.taskPath,f.repo,out],
     {encoding:"utf8",env:{...process.env,TEST_SECRET:marker}});
    assert.equal(result.status,1);assert.match(result.stderr,/Secret-like gate metadata rejected/);
    assert(!result.stdout.includes(marker));assert(!result.stderr.includes(marker));
    if(existing)assert.equal(await readFile(out,"utf8"),"existing evidence\n");
    else await assert.rejects(readFile(out),{code:"ENOENT"});
   }
   const unfrozen=path.join(f.dir,"unfrozen.json");
   const unsafe=structuredClone(f.task);unsafe.gates[0].argv.push("token="+marker);
   await writeJson(unfrozen,unsafe);
   await assert.rejects(freeze(unfrozen),/Secret-like gate metadata rejected/);
   await assert.rejects(readFile(unfrozen+".lock.json"),{code:"ENOENT"});
  }finally{await f.cleanup();}
 }
});

test("saved PASS and FAIL evidence redact output and omit extra gate metadata",async()=>{
 for(const code of [0,3]){
  const marker="synthetic-output-marker-012345";
  const gate={id:"output",argv:[process.execPath,"-e",
   `console.log(process.env.TEST_SECRET);console.error(process.env.TEST_SECRET);process.exit(${code})`],
   timeout_seconds:2,extra:marker};
  const f=await fixture([gate]);try{
   const out=path.join(f.dir,"evidence.json");
   const result=spawnSync(process.execPath,[cli,"verify",f.taskPath,f.repo,out],
    {encoding:"utf8",env:{...process.env,TEST_SECRET:marker}});
   assert.equal(result.status,code===0?0:1);
   const raw=await readFile(out,"utf8"),e=JSON.parse(raw);
   assert(!raw.includes(marker));assert(!result.stdout.includes(marker));assert(!result.stderr.includes(marker));
   assert.equal(e.status,code===0?"PASS":"FAIL");assert.equal(e.gates[0].code,code);
   assert.equal(e.gates[0].redaction_applied,true);assert(!("extra" in e.gates[0]));
   assert.deepEqual(e.gates[0].argv,gate.argv);
  }finally{await f.cleanup();}
 }
});

test("real git candidate: gates, independent review, Owner acceptance",async()=>{
 const f=await fixture();try{
 const e=await verify(f.taskPath,f.repo),r=review(f.task);
 assert.equal(e.status,"PASS");assert.equal(readiness(f.task,e,r).status,"READY_FOR_OWNER");
 f.task.owner_acceptance={accepted:true,head:f.task.candidate_head,contract_sha256:f.task.contract_sha256,source:"Owner test confirmation"};
 assert.deepEqual(readiness(f.task,e,r),{status:"DONE",merge_authorized:false});
 }finally{await f.cleanup();}
});
test("contract cannot be refrozen or weakened silently",async()=>{
 const f=await fixture();try{
 await assert.rejects(freeze(f.taskPath),/EEXIST/);
 f.task.acceptance_criteria=["changed"];await writeJson(f.taskPath,f.task);
 await assert.rejects(verify(f.taskPath,f.repo),/contract changed/);
 }finally{await f.cleanup();}
});
test("uncommitted work and head mismatch block verification",async()=>{
 const f=await fixture();try{
 await writeFile(path.join(f.repo,"feature.txt"),"dirty");await assert.rejects(verify(f.taskPath,f.repo),/clean/);
 git(f.repo,"add",".");git(f.repo,"commit","-m","later");await assert.rejects(verify(f.taskPath,f.repo),/head changed/);
 }finally{await f.cleanup();}
});
test("failed gates and changed command evidence cannot pass",async()=>{
 const f=await fixture();try{
 const e=await verify(f.taskPath,f.repo),r=review(f.task);
 for(const alter of [x=>x.gates[0].code=1,x=>x.gates[0].timed_out=true,x=>x.gates[0].argv=["fake"],x=>x.gates=[],
 x=>x.head="a".repeat(40),x=>x.contract_sha256="bad"]){
 const bad=structuredClone(e);alter(bad);assert.equal(readiness(f.task,bad,r).status,"NEEDS_FIX");
 }
 }finally{await f.cleanup();}
});
test("missing, stale, self or nonpassing review is rejected",async()=>{
 const f=await fixture();try{
 const e=await verify(f.taskPath,f.repo),r=review(f.task);
 assert.equal(readiness(f.task,e,null).status,"WAITING_CAPABILITY");
 for(const alter of [x=>x.reviewer_session="writer-1",x=>x.head="a".repeat(40),x=>x.independent=false,
 x=>x.material_findings=["bug"],x=>delete x.material_findings,x=>x.verdict="BLOCKED"]){
 const bad=structuredClone(r);alter(bad);assert.equal(readiness(f.task,e,bad).status,"NEEDS_FIX");
 }
 const elevated={...e,effective_risk:"ELEVATED"};assert.equal(readiness(f.task,elevated,{...r,risk_checks_completed:false}).status,"NEEDS_FIX");
 }finally{await f.cleanup();}
});
test("routing keeps risk separate and stops bounded repairs/paid fallback",async()=>{
 const f=await fixture();try{
 assert.equal(route(f.task,profile).tier,"fast");
 assert.equal(route({...f.task,risk:"ELEVATED"},profile).tier,"senior");
 assert.equal(route({...f.task,complexity:"COMPLEX"},profile).tier,"senior");
 assert.equal(route({...f.task,repair_rounds:2},profile).tier,"senior");
 assert.equal(route({...f.task,senior_passes:1},profile,{needsRepair:true}).status,"BLOCKED_TECHNICAL");
 assert.equal(route(f.task,profile,{quotaAvailable:false}).status,"WAITING_QUOTA");
 const p=structuredClone(profile);p.bindings.fast.verified=false;assert.equal(route(f.task,p).status,"WAITING_CAPABILITY");
 assert.throws(()=>validateProfile({...profile,billing:"API"}));
 assert.throws(()=>validateProfile({...profile,routing_mode:"LOCAL_AUTO",bridge_installed:true}));
 assert.throws(()=>validateTask({...f.task,repair_rounds:3}));
 }finally{await f.cleanup();}
});
test("redaction, failing command, missing binary and timeout are real subprocess checks",async()=>{
 assert(!redactText("Bearer abcdefghijklmnop").includes("abcdefghijklmnop"));
 const fail=await runRedacted([process.execPath,"-e","process.exit(4)"]);assert.equal(fail.code,4);
 const missing=await runRedacted(["qq-does-not-exist-123"]);assert.equal(missing.code,127);
 const slow=await runRedacted([process.execPath,"-e","setInterval(()=>{},1000)"],{timeoutSeconds:1});
 assert.equal(slow.code,124);assert.equal(slow.timed_out,true);
 const s=await runRedacted([process.execPath,"-e","console.log(process.env.TEST_SECRET)"],{env:{...process.env,TEST_SECRET:"hidden-fixture-value"}});
 assert(!s.stdout.includes("hidden-fixture-value"));
});
test("Windows command selection never directly spawns batch shims",()=>{
 const execPath="C:\\Program Files\\nodejs\\node.exe";
 const npm=argvForPlatform(["npm","test"],{platform:"win32",execPath,exists:p=>p.endsWith("npm-cli.js")});
 assert.equal(npm[0],execPath);assert.match(npm[1],/npm-cli\.js$/);assert.deepEqual(npm.slice(2),["test"]);
 assert.throws(()=>argvForPlatform(["pnpm","test"],{platform:"win32",execPath,exists:()=>false}),/\.cmd\/\.bat shims/);
 assert.throws(()=>argvForPlatform(["tool.cmd","x"],{platform:"win32",execPath,exists:()=>false}),/\.cmd\/\.bat shims/);
 assert.throws(()=>argvForPlatform(["npm","test"],{platform:"win32",execPath,exists:()=>false}),/batch shim/);
});
test("schema rejects missing types and duplicate gate IDs",async()=>{
 const f=await fixture();try{
 assert.throws(()=>validateTask({...f.task,gates:[]}));
 assert.throws(()=>validateTask({...f.task,gates:[f.task.gates[0],f.task.gates[0]]}));
 assert.throws(()=>validateTask({...f.task,user_visible:"false"}));
 assert.throws(()=>validateTask({...f.task,base_sha:"main"}));
 assert.equal(contractHash(f.task),f.task.contract_sha256);
 }finally{await f.cleanup();}
});

test("effective risk floor is monotonic and evidence must match task state",async()=>{
 const f=await fixture();try{
 const raised=await readJson(f.taskPath);raised.effective_risk="ELEVATED";await writeJson(f.taskPath,raised);
 const e=await verify(f.taskPath,f.repo);assert.equal(e.effective_risk,"ELEVATED");
 const persisted=await readJson(f.taskPath);assert.equal(persisted.effective_risk,"ELEVATED");
 const mismatched={...e,effective_risk:"LOW"};
 assert.equal(readiness(persisted,mismatched,review(persisted)).status,"NEEDS_FIX");
 persisted.effective_risk="LOW";await writeJson(f.taskPath,persisted);
 await assert.rejects(verify(f.taskPath,f.repo),/effective risk cannot decrease/);
 }finally{await f.cleanup();}
});

test("actual failed gate stops subsequent gates",async()=>{
 const f=await fixture([{id:"fail",argv:[process.execPath,"-e","process.exit(3)"],timeout_seconds:2},
 {id:"later",argv:[process.execPath,"-e","process.exit(0)"],timeout_seconds:2}]);try{
 const e=await verify(f.taskPath,f.repo);assert.equal(e.status,"FAIL");assert.equal(e.gates.length,1);
 }finally{await f.cleanup();}
});
test("gate modifying the candidate cannot produce accepted evidence",async()=>{
 const f=await fixture([{id:"mutate",argv:[process.execPath,"-e","require('fs').writeFileSync('feature.txt','mutation')"],timeout_seconds:2}]);
 try{await assert.rejects(verify(f.taskPath,f.repo),/clean/);}finally{await f.cleanup();}
});

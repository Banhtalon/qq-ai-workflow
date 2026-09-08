import test from "node:test";
import assert from "node:assert/strict";
import {fixture,review,profile} from "./fixture.mjs";
import {verify,readiness,route} from "../scripts/lib/workflow.mjs";

test("synthetic pilot: small feature reaches Owner test, not automatic merge",async()=>{
 const f=await fixture();try{
 assert.equal(route(f.task,profile).invoked,false);
 const e=await verify(f.taskPath,f.repo);
 assert.equal(readiness(f.task,e,review(f.task)).status,"READY_FOR_OWNER");
 }finally{await f.cleanup();}
});
test("synthetic pilot: material review requests repair then senior fallback",async()=>{
 const f=await fixture();try{
 const e=await verify(f.taskPath,f.repo);
 assert.equal(readiness(f.task,e,{...review(f.task),verdict:"NEEDS_FIX",material_findings:["fixture regression"]}).status,"NEEDS_FIX");
 assert.equal(route({...f.task,repair_rounds:2},profile,{needsRepair:true}).tier,"senior");
 assert.equal(route({...f.task,repair_rounds:2,senior_passes:1},profile,{needsRepair:true}).status,"BLOCKED_TECHNICAL");
 }finally{await f.cleanup();}
});
test("synthetic pilot: quota/capability interruption preserves task",async()=>{
 const f=await fixture();try{
 const before=JSON.stringify(f.task);
 assert.equal(route(f.task,profile,{quotaAvailable:false}).status,"WAITING_QUOTA");
 const p=structuredClone(profile);p.bindings.fast.verified=false;
 assert.equal(route(f.task,p).status,"WAITING_CAPABILITY");
 assert.equal(JSON.stringify(f.task),before);
 }finally{await f.cleanup();}
});

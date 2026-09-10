import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fixture,review,profile} from './fixture.mjs';
import {executionRoute,validateTask,contractHash,readiness as rawReadiness,verify,route,writeJson,readJson,freeze} from '../scripts/lib/workflow.mjs';
const reviewerBinding={provider:'openai',model:'fixture',command:['codex']};
const bindingHash=createHash('sha256').update(JSON.stringify(reviewerBinding)).digest('hex');
const readiness=(t,e,r)=>rawReadiness(t,e,r,{reviewerBinding});

const execution={policy:'GEMINI_FIRST_V1',prepared:true,local_synthetic:true,rationale:'Bounded local implementation; reviewed design and gates',design_sessions:[],browser_required:false};
test('prepared risk routes writer and reviewer separately; legacy remains conservative',()=>{
 const t={risk:'ELEVATED',complexity:'COMPLEX',repair_rounds:0,senior_passes:0};
 assert.deepEqual(executionRoute(t),{worker:'senior',reviewer:'reviewer'});
 assert.deepEqual(executionRoute({...t,execution}),{worker:'worker',reviewer:'elevated_reviewer'});
 for(const change of [{prepared:false},{local_synthetic:false}])assert.equal(executionRoute({...t,execution:{...execution,...change}}).worker,'senior');
 assert.equal(executionRoute({...t,execution,repair_rounds:2}).worker,'senior');
});
test('execution decisions are validated and hash-bound; elevated reviewer cannot be omitted',async()=>{
 const f=await fixture();try{
  const t={...f.task,execution,risk:'ELEVATED'};
  validateTask(t);assert.notEqual(contractHash(t),contractHash(f.task));
  assert.notEqual(contractHash(t),contractHash({...t,execution:{...execution,prepared:false}}));
  assert.throws(()=>validateTask({...t,execution:{...execution,prepared:'yes'}}));
  assert.equal(route(t,profile).status,'WAITING_CAPABILITY');
  const p=structuredClone(profile);p.bindings.elevated_review={...p.bindings.review};
  assert.equal(route(t,p).tier,'fast');
 }finally{await f.cleanup();}
});
test('design participant cannot approve; browser evidence binds final version',async()=>{
 const f=await fixture();try{
  const e=await verify(f.taskPath,f.repo),t={...f.task,execution:{...execution,browser_required:true}};
  t.contract_sha256=contractHash(t);e.contract_sha256=t.contract_sha256;
  const r={...review(t),effective_risk:t.effective_risk,reviewer_tier:'reviewer',reviewer_binding_hash:bindingHash};
  assert.equal(readiness(t,e,r).status,'WAITING_CAPABILITY');
  t.ui_evidence={head:t.candidate_head,contract_sha256:t.contract_sha256,url:'http://localhost:3000/',status:'PASS',checks:[{action:'Open page',observed:'Expected form visible',passed:true}]};
  assert.equal(readiness(t,e,r).status,'READY_FOR_OWNER');
  t.ui_evidence.head='0'.repeat(40);assert.equal(readiness(t,e,r).status,'WAITING_CAPABILITY');
  t.execution.design_sessions=[r.reviewer_session];t.contract_sha256=contractHash(t);e.contract_sha256=t.contract_sha256;r.contract_sha256=t.contract_sha256;
  assert.match(readiness(t,e,r).reason,/independent/);
 }finally{await f.cleanup();}
});

test('public readiness and status require an expected binding and reject absent or mismatched review digests',async()=>{
 const f=await fixture();try{
  const taskPath=path.join(f.dir,'modern.json');await writeJson(taskPath,{...f.task,execution});await freeze(taskPath);
  const t=await readJson(taskPath),e=await verify(taskPath,f.repo);
  const r={...review(t),effective_risk:t.effective_risk,reviewer_tier:'reviewer',reviewer_binding_hash:bindingHash};
  assert.equal(rawReadiness(t,e,r).status,'WAITING_CAPABILITY');
  const config={schema_version:'qq.bridge.v1',billing:'SUBSCRIPTION_ONLY',mode:'ASSISTED',timeout_seconds:30,write_paths:['feature.txt'],gate_paths:[],worker:reviewerBinding,senior:reviewerBinding,reviewer:reviewerBinding,elevated_reviewer:reviewerBinding};
  const ep=path.join(f.dir,'e.json'),rp=path.join(f.dir,'r.json'),cp=path.join(f.dir,'c.json');await writeJson(ep,e);await writeJson(cp,config);
  const cli=path.resolve('scripts/workflow.mjs');
  for(const expected of [undefined,'0'.repeat(64),bindingHash]){
   const candidate={...r,reviewer_binding_hash:expected};await writeJson(rp,candidate);
   const result=spawnSync(process.execPath,[cli,'status',taskPath,ep,rp,f.repo,cp],{encoding:'utf8'});
   assert.equal(result.status,expected===bindingHash?0:1,result.stderr);
   assert.equal(JSON.parse(result.stdout).status,expected===bindingHash?'READY_FOR_OWNER':'NEEDS_FIX');
  }
  const missing=spawnSync(process.execPath,[cli,'status',taskPath,ep,rp,f.repo],{encoding:'utf8'});
  assert.equal(missing.status,1);assert.equal(JSON.parse(missing.stdout).status,'WAITING_CAPABILITY');
 }finally{await f.cleanup();}
});

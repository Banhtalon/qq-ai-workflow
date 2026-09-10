import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,review,profile} from './fixture.mjs';
import {executionRoute,validateTask,contractHash,readiness,verify,route} from '../scripts/lib/workflow.mjs';

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
  const r={...review(t),effective_risk:t.effective_risk,reviewer_tier:'reviewer'};
  assert.equal(readiness(t,e,r).status,'WAITING_CAPABILITY');
  t.ui_evidence={head:t.candidate_head,contract_sha256:t.contract_sha256,url:'http://localhost:3000/',status:'PASS',checks:[{action:'Open page',observed:'Expected form visible',passed:true}]};
  assert.equal(readiness(t,e,r).status,'READY_FOR_OWNER');
  t.ui_evidence.head='0'.repeat(40);assert.equal(readiness(t,e,r).status,'WAITING_CAPABILITY');
  t.execution.design_sessions=[r.reviewer_session];t.contract_sha256=contractHash(t);e.contract_sha256=t.contract_sha256;r.contract_sha256=t.contract_sha256;
  assert.match(readiness(t,e,r).reason,/independent/);
 }finally{await f.cleanup();}
});

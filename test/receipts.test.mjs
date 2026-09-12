import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {beginInvocation,finishInvocation,normalizeUsage,promptHash,verifyReceiptChain} from '../scripts/lib/receipts.mjs';
import {invoke} from '../scripts/lib/bridge-adapters.mjs';

async function fixture(){
  const dir=await mkdtemp(path.join(tmpdir(),'qq-receipts-'));const repo=path.join(dir,'repo');await mkdir(repo);
  const state={schema_version:'qq.bridge.run.v1',run_id:'run-receipt-test',task_path:path.join(dir,'task.json'),contract_sha256:'c'.repeat(64),head:'h'.repeat(40)};
  const task={task_id:'TASK-RECEIPT',revision:2,contract_sha256:state.contract_sha256,goal:'receipt fixture'};
  await writeFile(path.join(dir,'state.json'),JSON.stringify(state));await writeFile(state.task_path,JSON.stringify(task));
  return {dir,repo,cleanup:()=>rm(dir,{recursive:true,force:true})};
}

test('assignment receipt separates requested model and hashes prompt without storing it',async()=>{
 const f=await fixture();try{
  const packet=path.join(f.dir,'call');const prompt='FULL PROMPT VALUE';const binding={provider:'openai',cli:'codex',model:'fixture',effort:'medium'};
  const ctx=await beginInvocation({packetDir:packet,role:'worker',binding,prompt,started_at:'2026-09-12T10:00:00.000Z'});
  const r=JSON.parse(await readFile(path.join(packet,'receipts','assignment.json'),'utf8'));
  assert.equal(r.task_id,'TASK-RECEIPT');assert.equal(r.run_id,'run-receipt-test');assert.equal(r.requested_model,'fixture');
  assert.equal(r.prompt_sha256,createHash('sha256').update(prompt).digest('hex'));assert.equal(JSON.stringify(r).includes(prompt),false);assert.ok(ctx.assignment.assignment_id);
 }finally{await f.cleanup();}
});

test('execution receipt records provider, requested/observed models, usage and chain hash',async()=>{
 const f=await fixture();try{
  const packet=path.join(f.dir,'call');const binding={provider:'google',cli:'antigravity',model:'gemini-3'};const prompt='small prompt';
  const ctx=await beginInvocation({packetDir:packet,role:'reviewer',binding,prompt,started_at:'2026-09-12T10:00:00.000Z'});
  const result={provider:'google',requested_model:'gemini-3',observed_models:['gemini-3.1'],session_id:'session-1',status:null,usage:{input_tokens:10,output_tokens:5},result:{summary:'ok',material_findings:[]}};
  const receipt=await finishInvocation({packetDir:packet,role:'reviewer',binding,prompt,result,started_at:'2026-09-12T10:00:00.000Z',finished_at:'2026-09-12T10:00:01.000Z',context:ctx});
  assert.equal(receipt.requested_model,'gemini-3');assert.deepEqual(receipt.observed_models,['gemini-3.1']);assert.equal(receipt.usage.total_tokens,15);assert.equal(receipt.duration_ms,1000);assert.equal(receipt.prev_receipt_sha256,null);assert.match(receipt.receipt_sha256,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(receipt).includes(prompt),false);assert.equal(await verifyReceiptChain(f.dir),true);
 }finally{await f.cleanup();}
});

test('usage explicitly reports unavailable instead of inventing quota',()=>{
 const usage=normalizeUsage(null,'google');assert.deepEqual(usage,{source:'unavailable',input_tokens:null,output_tokens:null,reasoning_tokens:null,cached_tokens:null,total_tokens:null});
 assert.equal(promptHash('x').length,64);
});

test('invoke emits one assignment and one execution receipt for a real invocation',async()=>{
 const f=await fixture();try{
  const cli=path.join(f.dir,'fake.mjs');await writeFile(cli,`for await(const c of process.stdin){};console.log(JSON.stringify({type:'thread.started',thread_id:'receipt-session'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({verdict:'PASS',summary:'ok',material_findings:[],risk_checks_completed:true})}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:7,output_tokens:3}}));`);
  const packet=path.join(f.dir,'invoke');const binding={provider:'openai',cli:'codex',model:'fixture',command:[process.execPath,cli]};
  const result=await invoke(binding,{cwd:f.repo,packetDir:packet,role:'worker',prompt:'temporary prompt value',timeoutSeconds:2});
  assert.equal(result.session_id,'receipt-session');
  const assignment=JSON.parse(await readFile(path.join(packet,'receipts','assignment.json'),'utf8'));const execution=JSON.parse(await readFile(path.join(packet,'receipts','execution.json'),'utf8'));
  assert.equal(assignment.assignment_id,execution.assignment_id);assert.equal(execution.status,null);assert.equal(execution.usage.total_tokens,10);assert.equal(JSON.stringify(execution).includes('temporary prompt value'),false);
 }finally{await f.cleanup();}
});

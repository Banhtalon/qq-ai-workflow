import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {beginInvocation,finishInvocation} from '../scripts/lib/receipts.mjs';
import {aggregateInvocations} from '../scripts/lib/report.mjs';

const cli = fileURLToPath(new URL('../scripts/bridge.mjs', import.meta.url));
const head = 'a'.repeat(40), contract = 'b'.repeat(64);
async function fixture(t, overrides = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'qq-report-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const task = {schema_version:'qq.workflow.task.v10',task_id:'REPORT-1',revision:1,
    goal:'Thêm bộ lọc lớp',candidate_head:head,contract_sha256:contract,user_visible:false};
  const state = {schema_version:'qq.bridge.run.v1',task_id:task.task_id,revision:1,
    task_path:path.join(dir,'task.json'),head,contract_sha256:contract,
    run_id:'report-current-run',
    status:'READY_FOR_OWNER',phase:'reviewer',repair_rounds:1,senior_passes:0,
    in_flight:null,reconciliation_required:false,history:[],...overrides};
  const binding = {task_id:task.task_id,revision:1,head,contract_sha256:contract};
  const data = {'state.json':state,'task.json':task,
    'evidence.json':{...binding,status:'PASS',gates:[{id:'unit',code:0,timed_out:false}]},
    'review.json':{...binding,verdict:'PASS',independent:true,material_findings:[],summary:'checked'}};
  async function put(name, value) {
    await mkdir(path.dirname(path.join(dir,name)),{recursive:true});
    await writeFile(path.join(dir,name),JSON.stringify(value));
  }
  for (const [name,value] of Object.entries(data)) await put(name,value);
  return {dir,state,task,binding,put};
}
function run(dir, args = ['--audience','lead','--format','json'], extraEnv = {}) {
  const out=spawnSync(process.execPath,[cli,'report',dir,...args],{
    encoding:'utf8',timeout:15000,env:{...process.env,...extraEnv}});
  assert.equal(out.error,undefined);
  assert.equal(out.status,0,out.stderr);
  assert.ok(Buffer.byteLength(out.stdout,'utf8')<=8192,'output includes newline within byte cap');
  return out.stdout;
}
async function digest(dir) {
  const entries=[];
  async function visit(folder) {
    for(const item of await readdir(folder,{withFileTypes:true})) {
      const full=path.join(folder,item.name);
      if(item.isDirectory()) await visit(full);
      else entries.push([path.relative(dir,full),createHash('sha256').update(await readFile(full)).digest('hex')]);
    }
  }
  await visit(dir); return entries.sort((a,b)=>a[0].localeCompare(b[0]));
}

test('report CLI defaults to Owner Markdown; JSON is read-only and legacy status stays compatible', async t=>{
  const f=await fixture(t), before=await digest(f.dir);
  const md=run(f.dir,[]); assert.match(md,/Thêm bộ lọc lớp/);
  assert.match(md,/Sol\/Lead đang chuẩn bị hướng dẫn thử/);
  assert.match(md,/Đây là bản tóm tắt tiến độ/);
  assert.match(md,/Người chuẩn bị báo cáo: Sol\/Lead/);
  assert.match(md,/Người thực hiện bước tiếp theo: Sol\/Lead/);
  assert.doesNotMatch(md,/READY_FOR_OWNER|Báo cáo dẫn xuất/);
  const text=run(f.dir); const result=JSON.parse(text);
  assert.match(text,/REPORT-1/); assert.match(text,/READY_FOR_OWNER/);
  assert.ok(result && typeof result==='object');
  assert.equal(result.report_bytes,Buffer.byteLength(text,'utf8'));
  assert.deepEqual(await digest(f.dir),before);
  const old=spawnSync(process.execPath,[cli,'status',f.dir],{encoding:'utf8'});
  assert.equal(old.status,0);
  assert.deepEqual(JSON.parse(old.stdout),{status:'READY_FOR_OWNER',head,
    repair_rounds:1,senior_passes:0,reconciliation_required:false});
});

test('missing evidence is disclosed, never manufactured as a successful check',async t=>{
  const f=await fixture(t); await rm(path.join(f.dir,'evidence.json'));
  const text=run(f.dir);
  assert.match(text,/evidence/); assert.match(text,/missing|unavailable|thiếu|không có/i);
});

test('failed gate and reviewer findings survive the compact report',async t=>{
  const f=await fixture(t,{status:'NEEDS_FIX',phase:'repair'});
  await f.put('evidence.json',{...f.binding,status:'FAIL',gates:[{id:'unit-failure',code:1,stderr:'EXPECTED_FAILURE'}]});
  await f.put('review.json',{...f.binding,verdict:'NEEDS_FIX',material_findings:['REVIEW_BUG_42']});
  const text=run(f.dir);
  assert.match(text,/unit-failure/); assert.match(text,/REVIEW_BUG_42/);
});

test('quota report retains wait; uncertain invocation requires reconciliation',async t=>{
  const f=await fixture(t,{status:'WAITING_QUOTA',phase:'worker'});
  assert.match(run(f.dir),/WAITING_QUOTA/);
  await f.put('state.json',{...f.state,in_flight:{id:'unfinished'},reconciliation_required:true});
  const text=run(f.dir);
  assert.match(text,/reconcil|đối soát/i);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.dir,'state.json'),'utf8')).in_flight,{id:'unfinished'});
});

test('secrets are redacted in Markdown and parseable JSON',async t=>{
  const secret='fixture-private-value-987654321';
  const f=await fixture(t,{status:'BLOCKED_TECHNICAL',error:`failure ${secret} sk-syntheticabcdefgh12345`});
  for(const format of ['md','json']) {
    const text=run(f.dir,['--audience','lead','--format',format],{REPORT_TEST_SECRET:secret});
    assert.ok(!text.includes(secret)); assert.ok(!text.includes('sk-syntheticabcdefgh12345'));
    if(format==='json') JSON.parse(text);
  }
});

test('oversized multilingual findings disclose truncation and retain blocker/reference',async t=>{
  const f=await fixture(t,{status:'NEEDS_FIX'});
  await f.put('review.json',{...f.binding,verdict:'NEEDS_FIX',material_findings:
    Array.from({length:120},(_,i)=>`BLOCKER_${i} ${'Lỗi dữ liệu tiếng Việt 🧪 '.repeat(100)}`)});
  const before=await digest(f.dir);
  for(const format of ['md','json']) {
    const text=run(f.dir,['--audience','lead','--format',format]);
    assert.match(text,/truncat|rút gọn|lược/i); assert.match(text,/review.json/);
    assert.match(text,/NEEDS_FIX/);
    if(format==='json') JSON.parse(text);
  }
  assert.deepEqual(await digest(f.dir),before);
});

test('invalid CLI flags fail without modifying packets',async t=>{
  const f=await fixture(t),before=await digest(f.dir);
  for(const args of [['--audience','admin'],['--format','html'],['--unknown'],['--format']]) {
    const out=spawnSync(process.execPath,[cli,'report',f.dir,...args],{encoding:'utf8'});
    assert.notEqual(out.status,0);
  }
  assert.deepEqual(await digest(f.dir),before);
});

test('real invocation receipts count once; incomplete usage stays unknown and identity is not inferred',async t=>{
  const f=await fixture(t);
  for(const [i,usage] of [{input_tokens:10,output_tokens:4},null].entries()) {
    const packetDir=path.join(f.dir,`attempt-${i}`),role='worker';
    const binding={provider:'google',cli:'antigravity',model:'requested-fixture-model'};
    const started_at='2026-09-13T00:00:00.000Z',finished_at='2026-09-13T00:00:01.000Z';
    const context=await beginInvocation({packetDir,role,receiptKind:'WORK',binding,prompt:'fixture',started_at});
    await finishInvocation({packetDir,receiptRoot:f.dir,role,receiptKind:'WORK',binding,
      prompt:'fixture',started_at,finished_at,context,result:{status:'OK',observed_models:[],usage}});
  }
  const before=await digest(f.dir),report=JSON.parse(run(f.dir));
  assert.equal(report.invocations.count,2);
  assert.equal(report.invocations.usage.input_tokens,null,'unknown invocation prevents a complete sum');
  assert.equal(report.invocations.usage.output_tokens,null);
  assert.deepEqual(await digest(f.dir),before);
});

test('stale UI evidence cannot expose a local trial link or actions',async t=>{
  const f=await fixture(t);
  await f.put('task.json',{...f.task,user_visible:true});
  await f.put('ui_evidence.json',{...f.binding,head:'c'.repeat(40),status:'PASS',
    url:'http://localhost:54321',checks:[{action:'CLICK_PRIVATE_ACTION',observed:'ok',passed:true}]});
  const text=run(f.dir,['--audience','owner','--format','json']);
  assert.ok(!text.includes('http://localhost:54321'));
  assert.ok(!text.includes('CLICK_PRIVATE_ACTION'));
});

test('compact Lead report is smaller than full logs without losing the unresolved finding',async t=>{
  const f=await fixture(t,{status:'NEEDS_FIX'});
  const evidence={...f.binding,status:'FAIL',gates:[{id:'unit',code:1,
    stdout:'synthetic repetitive diagnostic line\n'.repeat(4000),stderr:'failed'}]};
  await f.put('evidence.json',evidence);
  await f.put('review.json',{...f.binding,verdict:'NEEDS_FIX',material_findings:['FIX_FILTER_RESET']});
  const text=run(f.dir);
  assert.ok(Buffer.byteLength(text)<Buffer.byteLength(JSON.stringify(evidence)));
  assert.match(text,/FIX_FILTER_RESET/); assert.match(text,/evidence.json/);
});

test('header-shaped secrets cannot corrupt JSON or leak credentials',async t=>{
  const f=await fixture(t,{status:'BLOCKED_TECHNICAL',error:'Cookie: session=privatevalue\nAuthorization: Bearer privateheader'});
  const text=run(f.dir); JSON.parse(text);
  assert.ok(!text.includes('privatevalue')); assert.ok(!text.includes('privateheader'));
});

test('Owner trial actions require full identity and localhost URL; matching evidence exposes link',async t=>{
  const f=await fixture(t);
  await f.put('task.json',{...f.task,user_visible:true});
  const ui={...f.binding,status:'PASS',criteria_passed:true,url:'http://localhost:54321',target_url:'http://localhost:54321',
    checks:[{action:'FILTER_ACTION',observed:'list updated',passed:true}]};
  await f.put('ui_evidence.json',ui);
  const valid=JSON.parse(run(f.dir,['--format','json']));assert.equal(valid.next_actor,'Owner');assert.equal(valid.local_product_url,'http://localhost:54321');
  const ownerMd=run(f.dir,[]);assert.match(ownerMd,/đang chờ Owner thử/);assert.match(ownerMd,/Người thực hiện bước tiếp theo: Owner/);
  for(const invalid of [{...ui,revision:2},{...ui,url:'https://example.org',target_url:'https://example.org'},
    {...ui,contract_sha256:null},{...ui,criteria_passed:undefined},
    {...ui,checks:[{action:'FILTER_ACTION',passed:true}]}]) {
    await f.put('ui_evidence.json',invalid);
    assert.ok(!run(f.dir,['--format','json']).includes('FILTER_ACTION'));
  }
});

test('controlled pending reconciliation takes precedence over reported status and preserves counters',async t=>{
  const f=await fixture(t);
  const state={...f.state,schema_version:'qq.bridge.controlled-state.v1',phase:'REPAIR',
    status:undefined,budget:{origin:'GEMINI_INITIAL',initial_count:1,repair_count:2,
      escalation_count:1,escalation_used:true,pending_reconcile:true}};
  await f.put('state.json',state);
  const result=JSON.parse(run(f.dir));
  assert.match(result.next_step,/reconcil|đối soát/i);
  assert.equal(result.budget.repair_count,2);
  assert.equal(result.budget.escalation_count,1);
});

test('controlled Product Check wait is shown as an Owner blocker',async t=>{
  const f=await fixture(t,{schema_version:'qq.bridge.controlled-state.v1',status:'UNVERIFIED',phase:'PRODUCT_CHECK_WAIT'});
  const text=run(f.dir,['--audience','owner','--format','md']);
  assert.match(text,/Chưa đủ bằng chứng|kiểm tra trải nghiệm sản phẩm/);
  assert.doesNotMatch(text,/UNVERIFIED|PRODUCT_CHECK_WAIT/);
  assert.doesNotMatch(text,/Không thấy trở ngại/);
});

test('controlled review wait without a main status remains visibly pending',async t=>{
  const f=await fixture(t,{schema_version:'qq.bridge.controlled-state.v1',status:undefined,phase:'REVIEW_WAIT'});
  const text=run(f.dir,['--audience','owner','--format','md']);
  assert.match(text,/người kiểm tra độc lập|bước kiểm tra độc lập/);
  assert.doesNotMatch(text,/REVIEW_WAIT/);
  assert.doesNotMatch(text,/Không thấy trở ngại/);
});

test('controlled run subdirectory receipts are counted, custody is not a second invocation',async t=>{
  const f=await fixture(t),runId='controlled-run';
  await f.put('state.json',{...f.state,schema_version:'qq.bridge.controlled-state.v1',bridge_run_id:runId,run_id:runId});
  const packetDir=path.join(f.dir,runId,'worker'),binding={provider:'google',cli:'antigravity',model:'requested-only'};
  const started_at='2026-09-13T00:00:00.000Z',finished_at='2026-09-13T00:00:01.000Z';
  const context=await beginInvocation({packetDir,role:'worker',receiptKind:'WORK',binding,prompt:'test',started_at});
  await finishInvocation({packetDir,receiptRoot:path.join(f.dir,runId),role:'worker',receiptKind:'WORK',binding,
    prompt:'test',context,started_at,finished_at,result:{status:'OK',observed_models:[],usage:{input_tokens:17,output_tokens:3}}});
  await f.put('receipt.json',{observed_by_bridge:{provider:'google',requested_model:'requested-only'},reported_by_provider:{usage:{input_tokens:99}}});
  const result=JSON.parse(run(f.dir));
  assert.equal(result.invocations.count,1);
  assert.equal(result.invocations.usage.input_tokens,17);
});

test('clipping a single long blocker is disclosed even when final output fits',async t=>{
  const f=await fixture(t,{status:'BLOCKED_TECHNICAL',error:'IMPORTANT_BLOCKER '+ 'chi tiết '.repeat(500)});
  const report=JSON.parse(run(f.dir));
  assert.equal(report.truncation.applied,true);
  assert.match(JSON.stringify(report.blockers),/IMPORTANT_BLOCKER/);
});

test('readable malformed evidence reports unavailable, not successful gates',async t=>{
  const f=await fixture(t);
  await f.put('evidence.json',{...f.binding,status:'PASS',gates:'invalid'});
  const text=run(f.dir); JSON.parse(text);
  assert.match(text,/invalid|unavailable|thiếu|không hợp lệ|không có/i);
});

test('legacy state without task identity uses the bound task file for current evidence',async t=>{
  const f=await fixture(t);
  const legacy={...f.state}; delete legacy.task_id; delete legacy.revision;
  await f.put('state.json',legacy);
  const result=JSON.parse(run(f.dir));
  assert.equal(result.task.id,'REPORT-1');
  assert.ok(result.gates.some(g=>g.id==='unit'));
});

test('tampered receipt chain is not summarized as observed provider usage',async t=>{
  const f=await fixture(t),packetDir=path.join(f.dir,'attempt'),binding={provider:'google',cli:'antigravity',model:'fixture'};
  const context=await beginInvocation({packetDir,role:'worker',receiptKind:'WORK',binding,prompt:'test',started_at:'2026-09-13T00:00:00.000Z'});
  await finishInvocation({packetDir,receiptRoot:f.dir,role:'worker',receiptKind:'WORK',binding,prompt:'test',context,
    started_at:'2026-09-13T00:00:00.000Z',finished_at:'2026-09-13T00:00:01.000Z',result:{status:'OK',usage:{input_tokens:55}}});
  const chain=JSON.parse(await readFile(path.join(f.dir,'.receipts-chain.json'),'utf8'));
  chain.entries[0].receipt_sha256='0'.repeat(64); await f.put('.receipts-chain.json',chain);
  const result=JSON.parse(run(f.dir));
  assert.equal(result.invocations.observed,false);
  assert.equal(result.invocations.count,null);
  assert.equal(result.invocations.usage.input_tokens,null);
});

test('non-regular execution receipt fails closed instead of undercounting usage',async t=>{
  const f=await fixture(t),packetDir=path.join(f.dir,'attempt'),binding={provider:'google',cli:'antigravity',model:'fixture'};
  const context=await beginInvocation({packetDir,role:'worker',receiptKind:'WORK',binding,prompt:'test',started_at:'2026-09-13T00:00:00.000Z'});
  await finishInvocation({packetDir,receiptRoot:f.dir,role:'worker',receiptKind:'WORK',binding,prompt:'test',context,
    started_at:'2026-09-13T00:00:00.000Z',finished_at:'2026-09-13T00:00:01.000Z',result:{status:'OK',usage:{input_tokens:55}}});
  const receipt=path.join(packetDir,'receipts','execution.json');await rm(receipt);await mkdir(receipt);
  const result=JSON.parse(run(f.dir));
  assert.equal(result.invocations.observed,false);
  assert.equal(result.invocations.count,null);
  assert.equal(result.invocations.usage.input_tokens,null);
});

test('READY state with missing bound evidence is reported as a blocker',async t=>{
  const f=await fixture(t); await rm(path.join(f.dir,'evidence.json'));
  const result=JSON.parse(run(f.dir));
  assert.ok(result.blockers.some(value=>/evidence.*unavailable/i.test(value)));
  assert.equal(result.readiness_certified,false);
});

test('DONE with missing evidence or review assigns the blocker to Sol/Lead',async t=>{
  const f=await fixture(t,{status:'DONE'});await rm(path.join(f.dir,'evidence.json'));await rm(path.join(f.dir,'review.json'));
  const result=JSON.parse(run(f.dir,['--audience','owner','--format','json']));
  assert.equal(result.next_actor,'Sol/Lead');assert.match(result.next_step,/Sol\/Lead/);
  assert.ok(result.blockers.length>=2);assert.notEqual(result.next_actor,'Không cần thao tác thêm');
});

test('identity-conflicting DONE requires Sol/Lead reconciliation',async t=>{
  const f=await fixture(t,{status:'DONE'});await f.put('task.json',{...f.task,revision:2});
  const result=JSON.parse(run(f.dir,['--audience','owner','--format','json']));
  assert.equal(result.next_actor,'Sol/Lead');assert.match(result.next_step,/đối soát/);
  assert.ok(result.blockers.length>0);
});

test('conflicting task and checkpoint identity requires reconciliation',async t=>{
  const f=await fixture(t); await f.put('task.json',{...f.task,revision:2});
  const result=JSON.parse(run(f.dir));
  assert.equal(result.checkpoint.reconciliation_required,true);
  assert.match(result.next_step,/reconcil|đối soát/i);
});

test('Owner report hides raw technical findings while Lead report retains them',async t=>{
  const f=await fixture(t,{status:'NEEDS_FIX'});
  await f.put('review.json',{...f.binding,verdict:'NEEDS_FIX',independent:true,material_findings:['TECHNICAL_STACK_DETAIL_42']});
  const owner=run(f.dir,['--audience','owner','--format','json']);
  assert.ok(!owner.includes('TECHNICAL_STACK_DETAIL_42'));
  assert.match(owner,/Reviewer yêu cầu sửa 1 vấn đề/);
  assert.match(run(f.dir),/TECHNICAL_STACK_DETAIL_42/);
});

test('valid stale receipt chain copied under a new task is unavailable',async t=>{
  const f=await fixture(t),packetDir=path.join(f.dir,'attempt'),binding={provider:'google',cli:'antigravity',model:'fixture'};
  const context=await beginInvocation({packetDir,role:'worker',receiptKind:'WORK',binding,prompt:'test',started_at:'2026-09-13T00:00:00.000Z'});
  await finishInvocation({packetDir,receiptRoot:f.dir,role:'worker',receiptKind:'WORK',binding,prompt:'test',context,
    started_at:'2026-09-13T00:00:00.000Z',finished_at:'2026-09-13T00:00:01.000Z',result:{status:'OK',usage:{input_tokens:73}}});
  const next={task_id:'REPORT-NEW',revision:2,head:'d'.repeat(40),contract_sha256:'e'.repeat(64)};
  await f.put('state.json',{...f.state,...next});
  await f.put('task.json',{...f.task,...next,candidate_head:next.head});
  await f.put('evidence.json',{...next,status:'PASS',gates:[]});
  await f.put('review.json',{...next,verdict:'PASS',independent:true,material_findings:[]});
  const result=JSON.parse(run(f.dir));
  assert.equal(result.invocations.observed,false);
  assert.equal(result.invocations.count,null);
  assert.equal(result.invocations.usage.input_tokens,null);
});

test('non-independent review suppresses Owner local actions',async t=>{
  const f=await fixture(t);
  await f.put('task.json',{...f.task,user_visible:true});
  await f.put('review.json',{...f.binding,verdict:'PASS',independent:false,material_findings:[]});
  await f.put('ui_evidence.json',{...f.binding,status:'PASS',criteria_passed:true,target_url:'http://localhost:54321',
    checks:[{action:'FILTER_ACTION',observed:'list updated',passed:true}]});
  const result=JSON.parse(run(f.dir,['--audience','owner','--format','json']));
  assert.equal(result.local_product_url,null);
  assert.deepEqual(result.local_product_actions,[]);
  assert.ok(result.blockers.some(value=>/review/i.test(value)));
});

test('controlled report aggregates worker, reviewer and capability chains',async t=>{
  const f=await fixture(t),runId='12345678-1234-4123-8123-123456789abc';
  await f.put('state.json',{...f.state,schema_version:'qq.bridge.controlled-state.v1',bridge_run_id:runId,run_id:runId});
  const cases=[
    {dir:path.join(f.dir,runId),root:path.join(f.dir,runId),role:'worker',kind:'WORK',provider:'google',tokens:11},
    {dir:path.join(f.dir,'reviewer-12345678-1234-4123-8123-123456789abc'),root:path.join(f.dir,'reviewer-12345678-1234-4123-8123-123456789abc'),role:'reviewer',kind:'REVIEW',provider:'openai',tokens:13},
    {dir:path.join(f.dir,'capabilities','worker','probe-attempt'),root:path.join(f.dir,'capabilities','worker'),role:'probe',kind:'PROBE',provider:'google',tokens:17}
  ];
  for(const item of cases){
    const binding={provider:item.provider,cli:item.provider==='openai'?'codex':'antigravity',model:'fixture'};
    const started_at='2026-09-13T00:00:00.000Z',finished_at='2026-09-13T00:00:01.000Z';
    const context=await beginInvocation({packetDir:item.dir,role:item.role,receiptKind:item.kind,binding,prompt:'test',started_at});
    await finishInvocation({packetDir:item.dir,receiptRoot:item.root,role:item.role,receiptKind:item.kind,binding,prompt:'test',context,
      started_at,finished_at,result:{status:'OK',usage:{input_tokens:item.tokens,output_tokens:1}}});
  }
  const result=JSON.parse(run(f.dir));
  assert.equal(result.invocations.observed,true);
  assert.equal(result.invocations.count,3);
  assert.equal(result.invocations.usage.input_tokens,41);
  assert.deepEqual(result.invocations.by_role_provider.map(x=>[x.role,x.provider,x.count]).sort(),[
    ['probe','google',1],['reviewer','openai',1],['worker','google',1]
  ]);
});

test('legacy report aggregates root probe plus direct UUID worker and reviewer chains',async t=>{
  const f=await fixture(t),ids=['22345678-1234-4123-8123-123456789abc','32345678-1234-4123-8123-123456789abc'];
  const cases=[
    {dir:path.join(f.dir,'capabilities','worker','probe-attempt'),root:f.dir,role:'probe',kind:'PROBE',provider:'google',tokens:5},
    {dir:path.join(f.dir,ids[0]),root:path.join(f.dir,ids[0]),role:'worker',kind:'WORK',provider:'google',tokens:7},
    {dir:path.join(f.dir,ids[1]),root:path.join(f.dir,ids[1]),role:'reviewer',kind:'REVIEW',provider:'openai',tokens:9}
  ];
  for(const item of cases){
    const binding={provider:item.provider,cli:item.provider==='openai'?'codex':'antigravity',model:'fixture'};
    const started_at='2026-09-13T00:00:00.000Z',finished_at='2026-09-13T00:00:01.000Z';
    const context=await beginInvocation({packetDir:item.dir,role:item.role,receiptKind:item.kind,binding,prompt:'test',started_at});
    await finishInvocation({packetDir:item.dir,receiptRoot:item.root,role:item.role,receiptKind:item.kind,binding,prompt:'test',context,
      started_at,finished_at,result:{status:'OK',usage:{input_tokens:item.tokens,output_tokens:1}}});
  }
  const result=JSON.parse(run(f.dir));
  assert.equal(result.invocations.observed,true);
  assert.equal(result.invocations.count,3);
  assert.equal(result.invocations.usage.input_tokens,21);
  assert.deepEqual(result.invocations.by_role_provider.map(x=>[x.role,x.provider,x.count]).sort(),[
    ['probe','google',1],['reviewer','openai',1],['worker','google',1]
  ]);
});

test('controlled report formats V2 budget with active_worker, fallback details and remaining repairs', async t => {
  const f = await fixture(t);
  const state = {
    ...f.state,
    schema_version: 'qq.bridge.controlled-state.v1',
    policy: 'CONTROLLED_DELEGATION_V2',
    phase: 'REPAIR',
    budget: {
      schema_version: 'qq.workflow.budget.v2',
      policy: 'CONTROLLED_DELEGATION_V2',
      origin: 'GEMINI_INITIAL',
      active_worker: 'luna',
      fallback_occurred: true,
      fallback_reason: 'WAITING_QUOTA',
      initial_count: 1,
      repair_count: 2,
      senior_count: 1,
      senior_used: true,
      pending_reconcile: false
    }
  };
  await f.put('state.json', state);
  const text = run(f.dir, ['--audience', 'lead', '--format', 'json']);
  const result = JSON.parse(text);

  assert.equal(result.budget.schema_version, 'qq.workflow.budget.v2');
  assert.equal(result.budget.policy, 'CONTROLLED_DELEGATION_V2');
  assert.equal(result.budget.active_worker, 'luna');
  assert.equal(result.budget.fallback_occurred, true);
  assert.equal(result.budget.fallback_reason, 'WAITING_QUOTA');
  assert.equal(result.budget.initial_count, 1);
  assert.equal(result.budget.repair_count, 2);
  assert.equal(result.budget.senior_count, 1);
  assert.equal(result.budget.remaining.repair, 2);
  assert.equal(result.budget.remaining.senior, 1);
});

test('controlled report includes fallback_worker capability probe receipts in observed invocations', async t => {
  const f = await fixture(t), runId = '22223333-1234-4123-8123-123456789abc';
  await f.put('state.json', { ...f.state, schema_version: 'qq.bridge.controlled-state.v1', policy: 'CONTROLLED_DELEGATION_V2', bridge_run_id: runId, run_id: runId });
  const cases = [
    { dir: path.join(f.dir, runId), root: path.join(f.dir, runId), role: 'worker', kind: 'WORK', provider: 'google', tokens: 10 },
    { dir: path.join(f.dir, 'capabilities', 'fallback_worker', 'probe-attempt'), root: path.join(f.dir, 'capabilities', 'fallback_worker'), role: 'probe', kind: 'PROBE', provider: 'openai', tokens: 15 }
  ];
  for (const item of cases) {
    const binding = { provider: item.provider, cli: item.provider === 'openai' ? 'codex' : 'antigravity', model: 'fixture' };
    const started_at = '2026-09-13T00:00:00.000Z', finished_at = '2026-09-13T00:00:01.000Z';
    const context = await beginInvocation({ packetDir: item.dir, role: item.role, receiptKind: item.kind, binding, prompt: 'test', started_at });
    await finishInvocation({ packetDir: item.dir, receiptRoot: item.root, role: item.role, receiptKind: item.kind, binding, prompt: 'test', context,
      started_at, finished_at, result: { status: 'OK', usage: { input_tokens: item.tokens, output_tokens: 1 } } });
  }
  const result = JSON.parse(run(f.dir));
  assert.equal(result.invocations.observed, true);
  assert.equal(result.invocations.count, 2);
  assert.equal(result.invocations.usage.input_tokens, 25);
  assert.deepEqual(result.invocations.by_role_provider.map(x => [x.role, x.provider, x.count]).sort(), [
    ['probe', 'openai', 1], ['worker', 'google', 1]
  ]);
});

test('aggregateInvocations accounts requested vs observed models across receipt schemas', () => {
  // 1. Raw invocation receipt shape (binding + result)
  const rawReceipts = [
    {
      schema_version: 'qq.workflow.invocation-receipt.v1',
      receipt_id: 'raw-1',
      binding: { role: 'worker', provider: 'google', model: 'models/gemini-3.8-flash-high:latest', effort: null },
      result: { observed_models: ['gemini-3.8-flash-high'], status: 'SUCCESS', usage: { input_tokens: 10, output_tokens: 5 } }
    },
    {
      schema_version: 'qq.workflow.invocation-receipt.v1',
      receipt_id: 'raw-2',
      binding: { role: 'worker', provider: 'openai', model: 'gpt-5.6-luna', effort: 'max' },
      result: { observed_models: ['gpt-5.6-luna'], status: 'SUCCESS', usage: { input_tokens: 20, output_tokens: 10 } }
    }
  ];
  const aggRaw = aggregateInvocations(rawReceipts, true);
  assert.equal(aggRaw.count, 2);
  assert.equal(aggRaw.requested_versus_observed[0].role, 'worker');
  assert.equal(aggRaw.requested_versus_observed[0].provider, 'google');
  assert.equal(aggRaw.requested_versus_observed[0].requested_model, 'models/gemini-3.8-flash-high:latest');
  assert.deepEqual(aggRaw.requested_versus_observed[0].observed_models, ['gemini-3.8-flash-high']);
  assert.equal(aggRaw.requested_versus_observed[0].model_match, 'matched');
  assert.equal(aggRaw.requested_versus_observed[1].model_match, 'matched');
  assert.equal(aggRaw.usage.input_tokens, 30);
  assert.equal(aggRaw.usage.output_tokens, 15);

  // 2. Controlled execution receipt shape (observed_by_bridge + reported_by_provider)
  const bridgeReceipts = [
    {
      schema_version: 'qq.workflow.execution-receipt.v1',
      receipt_id: 'bridge-1',
      role: 'senior',
      observed_by_bridge: { provider: 'openai', requested_model: 'gpt-5.6-sol', requested_effort: 'medium' },
      reported_by_provider: { actual_model: 'gpt-5.6-sol', usage: { input_tokens: 50, output_tokens: 25 } }
    }
  ];
  const aggBridge = aggregateInvocations(bridgeReceipts, true);
  assert.equal(aggBridge.count, 1);
  assert.equal(aggBridge.requested_versus_observed[0].role, 'senior');
  assert.equal(aggBridge.requested_versus_observed[0].provider, 'openai');
  assert.equal(aggBridge.requested_versus_observed[0].requested_model, 'gpt-5.6-sol');
  assert.deepEqual(aggBridge.requested_versus_observed[0].observed_models, ['gpt-5.6-sol']);
  assert.equal(aggBridge.requested_versus_observed[0].model_match, 'matched');
  assert.equal(aggBridge.usage.input_tokens, 50);

  // 3. Model mismatch (observed differs from requested)
  const mismatchReceipts = [
    {
      role: 'worker',
      provider: 'google',
      requested_model: 'gemini-3.8-flash-high',
      observed_models: ['gemini-1.5-pro']
    }
  ];
  const aggMismatch = aggregateInvocations(mismatchReceipts, true);
  assert.equal(aggMismatch.requested_versus_observed[0].model_match, 'mismatched');

  // 4. Uncertain match (missing provider observation or missing requested model)
  const uncertainReceipts = [
    {
      role: 'worker',
      binding: { model: 'gemini-3.8-flash-high' },
      result: { observed_models: [] }
    },
    {
      role: 'worker',
      provider: 'openai'
    }
  ];
  const aggUncertain = aggregateInvocations(uncertainReceipts, true);
  assert.equal(aggUncertain.requested_versus_observed[0].model_match, 'uncertain');
  assert.equal(aggUncertain.requested_versus_observed[1].model_match, 'uncertain');
});

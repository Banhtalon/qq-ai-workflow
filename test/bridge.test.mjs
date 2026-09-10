import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {writeFile,readFile,mkdir,unlink} from 'node:fs/promises';
import {fixture} from './fixture.mjs';
import {git,readJson,writeJson,freeze,verify,readiness} from '../scripts/lib/workflow.mjs';
import {execute,subscriptionEnv,failureStatus} from '../scripts/lib/bridge-process.mjs';
import {redactText} from '../scripts/lib/redact.mjs';
import {parseProtocol,invocation,assertSubscriptionSettings,protocolMetadata} from '../scripts/lib/bridge-adapters.mjs';
import {runBridge,acquire,reviewSource,quotaDrill,activate,sourceAllowed,validateConfig,loadReviewSource,configHash} from '../scripts/lib/bridge.mjs';

const windowsOnly={skip:process.platform==='win32'?false:'requires a real Windows runtime'};

async function setup(mode='repair') {
  const f=await fixture();git(f.repo,'switch','-c','feature');
  const cli=path.join(f.dir,'fake.mjs');
  await writeFile(cli,`
import {readFileSync,writeFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';
const args=process.argv.slice(2),mode=${JSON.stringify(mode)};
if(args.includes('--version')){console.log('fake-cli 1.0');process.exit(0);}
if(args.includes('login')){console.log('Logged in using ChatGPT');process.exit(0);}
let input='';for await(const c of process.stdin)input+=c;
const probe=input.includes('Capability probe'),worker=args.includes('workspace-write');
if(!probe&&!worker)writeFileSync(${JSON.stringify(path.join(f.dir,'review-input.txt'))},input);
if(!probe&&mode==='quota'){console.error('429 quota exhausted');process.exit(1);}
if(!probe&&mode==='timeout'){setInterval(()=>{},1000);await new Promise(()=>{});}
if(!probe&&mode==='invalid'){console.log('not JSON');process.exit(0);}
if(!probe&&mode==='self'){}
if(!probe&&worker&&!(mode==='noop'&&input.includes('fix the fixture'))){writeFileSync('feature.txt',mode==='always-fail'?randomUUID():(input.includes('fix the fixture')?'repaired\\n':'written\\n'));}
if(!probe&&mode==='review-write'&&!worker)writeFileSync('feature.txt','reviewer mutation');
if(!probe&&mode==='out-of-scope'&&worker)writeFileSync('unexpected.txt','oops');
if(!probe&&mode==='weaken-gate'&&worker)writeFileSync('package.json',JSON.stringify({scripts:{test:'node -e "process.exit(0)"'}}));
const fail=!probe&&!worker&&(mode==='always-fail'||mode==='noop'||(mode==='repair'&&readFileSync('feature.txt','utf8')!=='repaired\\n'));
const result={verdict:fail?'NEEDS_FIX':'PASS',summary:'fake process',material_findings:fail?['fix the fixture']:[],risk_checks_completed:true};
console.log(JSON.stringify({type:'thread.started',thread_id:mode==='self'?'same-session':randomUUID()}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(result)}}));
console.log(JSON.stringify({type:'turn.completed'}));
`);
  const binding={provider:'openai',model:'fixture',command:[process.execPath,cli]};
  const config={schema_version:'qq.bridge.v1',billing:'SUBSCRIPTION_ONLY',mode:'ASSISTED',timeout_seconds:2,write_paths:['feature.txt'],gate_paths:[],worker:binding,reviewer:binding,senior:binding};
  const packetDir=path.join(f.dir,'packets');
  return {...f,config,packetDir,run:(extra={})=>runBridge({cwd:f.repo,taskPath:f.taskPath,config,packetDir,pilot:true,...extra})};
}

test('real subprocess worker -> gates -> independent review -> repair -> final review',async()=>{
  const f=await setup();try{
    const s=await f.run();assert.equal(s.status,'READY_FOR_OWNER');assert.equal(s.repair_rounds,1);
    assert.equal(s.history.filter(h=>h.phase==='worker').length,2);
    const r=await readJson(path.join(f.packetDir,'review.json'));
    assert.equal(r.head,git(f.repo,'rev-parse','HEAD').trim());
    assert.equal(await readFile(path.join(f.repo,'feature.txt'),'utf8'),'repaired\n');
    assert.equal((await f.run({resume:true})).status,'READY_FOR_OWNER');
    const call=s.history.findLast(h=>h.phase==='reviewer');
    const packetDirs=await (await import('node:fs/promises')).readdir(f.packetDir,{withFileTypes:true});
    const snapshots=[];for(const d of packetDirs.filter(d=>d.isDirectory())){try{snapshots.push(await readJson(path.join(f.packetDir,d.name,'review-source.json')));}catch(e){if(e.code!=='ENOENT')throw e;}}
    assert.ok(snapshots.some(p=>createHash('sha256').update(JSON.stringify(p)).digest('hex')===call.source_sha256));
  }finally{await f.cleanup();}
});

test('exact inspected test approval is byte scoped and never allows recognizable credentials',async()=>{
 const f=await setup('pass');try{
  const name='notes/tests.py',content="password='dummy-local-example'\n";
  const approval={path:name,sha256:createHash('sha256').update(content).digest('hex'),kind:'synthetic-test-data',reason:'Lead inspected synthetic test value'};
  const config={...f.config,synthetic_source_approvals:[approval]};validateConfig(config);
  assert.equal(sourceAllowed(name,content,config,{}),true);
  assert.equal(sourceAllowed(name,content+'# changed\n',config,{}),false);
  assert.equal(sourceAllowed(name,content.replaceAll('\n','\r\n'),config,{}),false);
  assert.equal(sourceAllowed(name,content+'\ufffd',config,{}),false);
  assert.equal(sourceAllowed('notes/views.py',content,config,{}),false);
  assert.equal(sourceAllowed(name,content,config,{EXAMPLE_PASSWORD:'dummy-local-example'}),false);
  for(const raw of ['password=ghp_'+'a'.repeat(24),'Bearer '+'z'.repeat(20),'-----BEGIN PRIVATE KEY-----']){
   const c={...config,synthetic_source_approvals:[{...approval,sha256:createHash('sha256').update(raw).digest('hex')}]};
   assert.equal(sourceAllowed(name,raw,c,{}),false);
  }
  assert.throws(()=>validateConfig({...config,synthetic_source_approvals:[approval,approval]}),/duplicate/);
  assert.throws(()=>validateConfig({...config,synthetic_source_approvals:[{...approval,path:'notes/*.py'}]}),/invalid/);
  assert.throws(()=>validateConfig({...config,review_context_paths:[':(glob)**']}),/invalid/);
 }finally{await f.cleanup();}
});

test('direct gate scripts are included and missing scripts stop the review packet',async()=>{
 const f=await setup('pass');try{
  await writeFile(path.join(f.repo,'check.mjs'),'// gate context\n');git(f.repo,'add','.');git(f.repo,'commit','-m','gate');
  const t={...f.task,candidate_head:git(f.repo,'rev-parse','HEAD').trim(),gates:[{id:'direct',argv:[process.execPath,'check.mjs'],timeout_seconds:2}]};
  assert.ok(reviewSource(f.repo,t,f.config).files.some(p=>p.path==='check.mjs'));
  t.gates[0].argv[1]='missing.mjs';assert.throws(()=>reviewSource(f.repo,t,f.config),/missing/);
 }finally{await f.cleanup();}
});

test('cached bridge readiness and activation reject missing or changed persisted source',async()=>{
 const f=await setup('repair');try{
  await f.run();const rp=path.join(f.packetDir,'review.json'),r=await readJson(rp),t=await readJson(f.taskPath),e=await readJson(path.join(f.packetDir,'evidence.json'));
  const file=path.join(f.packetDir,r.source_file),original=await readFile(file,'utf8');
  const snapshot=await loadReviewSource(f.packetDir,r);
  assert.equal(readiness(t,e,r,{sourceSnapshot:snapshot,sourceConfigHash:configHash(f.config)}).status,'READY_FOR_OWNER');
  await writeFile(file,original.replace('repaired','tampered'));
  assert.equal(readiness(t,e,r,{sourceSnapshot:await loadReviewSource(f.packetDir,r),sourceConfigHash:configHash(f.config)}).status,'NEEDS_FIX');
  await unlink(file);assert.equal(await loadReviewSource(f.packetDir,r),null);
  const sp=path.join(f.packetDir,'state.json'),s=await readJson(sp);s.history.find(h=>h.phase==='worker').provider='google';await writeJson(sp,s);
  await assert.rejects(quotaDrill(f.config,f.packetDir,path.join(f.dir,'activation')),
    process.platform==='win32'?/evidence\/review/:/real Windows pilot required/);
  const resumed=await f.run({resume:true});assert.equal(resumed.status,'NEEDS_FIX');assert.match(resumed.error,/source/);
  await writeFile(file,original);assert.equal((await f.run({resume:true})).status,'READY_FOR_OWNER');
 }finally{await f.cleanup();}
});

test('provider JSON cannot overwrite trusted source or identity fields',()=>{
 const result={verdict:'PASS',summary:'fixture',material_findings:[],risk_checks_completed:true,source_sha256:'spoofed'};
 const output=[{type:'thread.started',thread_id:'fixture'},{type:'item.completed',item:{type:'agent_message',text:JSON.stringify(result)}},{type:'turn.completed'}].map(x=>JSON.stringify(x)).join('\n');
 assert.throws(()=>parseProtocol('openai',output),/unexpected structured result field/);
});

test('review packet checks both Git versions, includes declared context and rejects missing or stale approvals',async()=>{
 const f=await setup('pass');try{
  const name='notes/tests.py',old="password='dummy-local-before'\n",next="password='dummy-local-after'\n";
  await mkdir(path.join(f.repo,'notes'));await writeFile(path.join(f.repo,name),old);await writeFile(path.join(f.repo,'notes/context.py'),'# trusted context\n');
  git(f.repo,'add','.');git(f.repo,'commit','-m','baseline');const base=git(f.repo,'rev-parse','HEAD').trim();
  await writeFile(path.join(f.repo,name),next);git(f.repo,'add','.');git(f.repo,'commit','-m','change');
  const t={...f.task,base_sha:base,candidate_head:git(f.repo,'rev-parse','HEAD').trim()};
  const approve=content=>({path:name,sha256:createHash('sha256').update(content).digest('hex'),kind:'synthetic-test-data',reason:'Inspected dummy local test'});
  const config={...f.config,review_context_paths:['notes/context.py'],synthetic_source_approvals:[approve(next)]};
  t.execution={source_approvals_sha256:createHash('sha256').update(JSON.stringify(config.synthetic_source_approvals)).digest('hex')};
  assert.throws(()=>reviewSource(f.repo,t,config),/secret-like/);
  config.synthetic_source_approvals.push(approve(old));
  assert.throws(()=>reviewSource(f.repo,t,config),/frozen task/);
  t.execution.source_approvals_sha256=createHash('sha256').update(JSON.stringify(config.synthetic_source_approvals)).digest('hex');const packet=reviewSource(f.repo,t,config);
  assert.equal(packet.files.find(x=>x.path===name).content,next);assert.ok(packet.diff.includes(old.trim()));
  assert.equal(packet.baseline.find(x=>x.path==='notes/context.py').unchanged,true);
  assert.equal(packet.baseline.find(x=>x.path===name).unchanged,false);
  assert.equal(packet.base_files.find(x=>x.path===name).content,old);
  assert.equal(packet.contract_sha256,t.contract_sha256);
  assert.throws(()=>reviewSource(f.repo,t,{...config,review_context_paths:['missing.py']}),/missing/);
  await unlink(path.join(f.repo,name));git(f.repo,'add','.');git(f.repo,'commit','-m','delete');t.candidate_head=git(f.repo,'rev-parse','HEAD').trim();
  const noApprovalTask={...t,execution:undefined};
  assert.throws(()=>reviewSource(f.repo,noApprovalTask,{...config,synthetic_source_approvals:[]}),/secret-like/);
 }finally{await f.cleanup();}
});

test('Gemini-first elevated bridge uses worker and elevated reviewer; browser wait resumes without another model call',async()=>{
 const f=await setup('pass');try{
  const t=await readJson(f.taskPath);t.task_id='TASK-GEMINI-BROWSER';t.risk='ELEVATED';t.complexity='COMPLEX';
  t.execution={policy:'GEMINI_FIRST_V1',prepared:true,local_synthetic:true,rationale:'Local fixture with fixed design',design_sessions:[],browser_required:true};
  const taskPath=path.join(f.dir,'modern.json');await writeJson(taskPath,t);await freeze(taskPath);
  const config={...f.config,elevated_reviewer:{...f.config.reviewer,model:'elevated-fixture'}};
  const run=()=>runBridge({cwd:f.repo,taskPath,config,packetDir:f.packetDir,pilot:true});
  const s=await run();assert.equal(s.status,'WAITING_CAPABILITY');assert.equal(s.repair_rounds,0);
  assert.match(await readFile(path.join(f.dir,'review-input.txt'),'utf8'),/Missing browser observations alone are not a code finding/);
  assert.deepEqual(s.history.filter(h=>h.session_id).map(h=>h.tier),['worker','elevated_reviewer']);
  const pending=await runBridge({cwd:f.repo,taskPath,config,packetDir:f.packetDir,pilot:true,resume:true});
  assert.equal(pending.history.length,s.history.length);
  const updated=await readJson(taskPath);updated.ui_evidence={head:updated.candidate_head,contract_sha256:updated.contract_sha256,url:'http://localhost:3000',status:'PASS',checks:[{action:'Open',observed:'Expected page',passed:true}]};await writeJson(taskPath,updated);
  const final=await runBridge({cwd:f.repo,taskPath,config,packetDir:f.packetDir,pilot:true,resume:true});
  assert.equal(final.status,'READY_FOR_OWNER');assert.equal(final.history.length,s.history.length);
  const current=await readJson(taskPath);current.ui_evidence.head='0'.repeat(40);await writeJson(taskPath,current);
  const invalid=await runBridge({cwd:f.repo,taskPath,config,packetDir:f.packetDir,pilot:true,resume:true});assert.equal(invalid.status,'WAITING_CAPABILITY');
 }finally{await f.cleanup();}
});

test('cached readiness is invalidated when independent review is removed',async()=>{
 const f=await setup('pass');try{
  assert.equal((await f.run()).status,'READY_FOR_OWNER');
  await unlink(path.join(f.packetDir,'review.json'));
  assert.equal((await f.run({resume:true})).status,'WAITING_CAPABILITY');
  assert.equal((await f.run({resume:true})).status,'READY_FOR_OWNER');
  const prompt=await readFile(path.join(f.dir,'review-input.txt'),'utf8');
  const payload=JSON.parse(prompt.split('\n').find(line=>line.startsWith('Previous findings and evidence: ')).slice('Previous findings and evidence: '.length));
  assert.equal(payload.evidence.status,'PASS');assert.equal(payload.evidence.head,git(f.repo,'rev-parse','HEAD').trim());
 }finally{await f.cleanup();}
});

test('restoring older matching task and evidence packets cannot approve a newer checkpoint',async()=>{
 const f=await setup('pass');try{
  await f.run();const oldTask=await readJson(f.taskPath),ep=path.join(f.packetDir,'evidence.json'),rp=path.join(f.packetDir,'review.json');
  const oldEvidence=await readJson(ep),oldReview=await readJson(rp);
  await writeJson(rp,{...oldReview,verdict:'NEEDS_FIX',material_findings:['fix the fixture']});
  await f.run({resume:true});const fixed=await f.run({resume:true});assert.equal(fixed.status,'READY_FOR_OWNER');assert.notEqual(fixed.head,oldTask.candidate_head);
  await writeJson(f.taskPath,oldTask);await writeJson(ep,oldEvidence);await writeJson(rp,oldReview);
  const restored=await f.run({resume:true});assert.equal(restored.status,'BLOCKED_TECHNICAL');assert.match(restored.error,/task candidate/);
 }finally{await f.cleanup();}
});

test('material review discovered after entering gate recovery is repaired before another review',async()=>{
 const f=await setup('pass');try{
  await f.run();const ep=path.join(f.packetDir,'evidence.json'),rp=path.join(f.packetDir,'review.json');
  await unlink(ep);assert.equal((await f.run({resume:true})).phase,'gates');
  const r=await readJson(rp);r.verdict='NEEDS_FIX';r.material_findings=['fix the fixture'];await writeJson(rp,r);
  const final=await f.run({resume:true});assert.equal(final.status,'READY_FOR_OWNER');assert.equal(final.repair_rounds,1);
  assert.equal(await readFile(path.join(f.repo,'feature.txt'),'utf8'),'repaired\n');
 }finally{await f.cleanup();}
});

test('activation paths reject restored old pilot packets even without checking pilot checkout',windowsOnly,async()=>{
 const f=await setup('pass');try{
  await f.run();const oldTask=await readJson(f.taskPath),ep=path.join(f.packetDir,'evidence.json'),rp=path.join(f.packetDir,'review.json');
  const oldEvidence=await readJson(ep),oldReview=await readJson(rp);
  await writeJson(rp,{...oldReview,verdict:'NEEDS_FIX',material_findings:['fix the fixture']});
  await f.run({resume:true});await f.run({resume:true});
  const sp=path.join(f.packetDir,'state.json'),s=await readJson(sp);s.history.find(h=>h.phase==='worker').provider='google';await writeJson(sp,s);
  const activationDir=path.join(f.dir,'activation');await quotaDrill(f.config,f.packetDir,activationDir);await activate(f.config,f.packetDir,activationDir);
  await writeJson(f.taskPath,oldTask);await writeJson(ep,oldEvidence);await writeJson(rp,oldReview);
  await assert.rejects(quotaDrill(f.config,f.packetDir,path.join(f.dir,'new-drill')),/pilot task does not match/);
  await assert.rejects(activate(f.config,f.packetDir,activationDir),/pilot task does not match/);
  await assert.rejects(runBridge({cwd:f.repo,taskPath:f.taskPath,config:{...f.config,mode:'LOCAL_AUTO'},packetDir:activationDir,pilot:false}),/pilot task does not match/);
 }finally{await f.cleanup();}
});

test('no-op repair cannot obtain another approval or lose unresolved findings',async()=>{
 const f=await setup('noop');try{
  const s=await f.run();assert.equal(s.status,'BLOCKED_TECHNICAL');assert.match(s.error,/no-op repair/);
  assert.equal(s.history.filter(h=>h.phase==='reviewer').length,1);
  assert.deepEqual(s.unresolved_review.review.material_findings,['fix the fixture']);
  assert.equal(s.repair_rounds,1);assert.equal(s.in_flight,null);
 }finally{await f.cleanup();}
});

test('missing verification during browser wait regenerates gates without a terminal error',async()=>{
 const f=await setup('pass');try{
  const taskPath=path.join(f.dir,'browser.json');
  await writeJson(taskPath,{...await readJson(f.taskPath),task_id:'TASK-BROWSER-MISSING-EVIDENCE',execution:{policy:'GEMINI_FIRST_V1',prepared:true,local_synthetic:true,rationale:'Fixture',design_sessions:[],browser_required:true}});await freeze(taskPath);
  const config={...f.config,elevated_reviewer:f.config.reviewer};
  const run=resume=>runBridge({cwd:f.repo,taskPath,config,packetDir:f.packetDir,pilot:true,resume});
  assert.equal((await run(false)).status,'WAITING_CAPABILITY');
  await unlink(path.join(f.packetDir,'evidence.json'));
  const resumed=await run(true);assert.equal(resumed.status,'WAITING_CAPABILITY');assert.equal(resumed.repair_rounds,0);
  assert.equal(resumed.history.filter(h=>h.phase==='gates').length,2);
  assert.equal((await readJson(path.join(f.packetDir,'evidence.json'))).status,'PASS');
 }finally{await f.cleanup();}
});

test('Google protocol retains reported usage and distinguishes absent counters',()=>{
 const result={verdict:'PASS',summary:'fixture',material_findings:[],risk_checks_completed:false};
 const stats={models:{'flash-fixture':{tokens:{prompt:12,candidates:4}}}};
 const response={session_id:'fixture-session',response:JSON.stringify(result),stats};
 assert.deepEqual(parseProtocol('google',JSON.stringify(response),'gemini').usage,stats);
 delete response.stats;assert.equal(parseProtocol('google',JSON.stringify(response),'gemini').usage,null);
 const envelope={event:'result',result:{status:'SUCCESS',conversation_id:'fixture-session',structured_output:result,usage:{input_tokens:12,output_tokens:4}}};
 assert.deepEqual(parseProtocol('google',JSON.stringify(envelope),'antigravity').usage,envelope.result.usage);
});

test('risk elevation invalidates ordinary review at the same head and selects elevated reviewer',async()=>{
 const f=await setup('pass');try{
  const t=await readJson(f.taskPath);t.task_id='TASK-RISK-UPGRADE';
  t.execution={policy:'GEMINI_FIRST_V1',prepared:true,local_synthetic:true,rationale:'Local fixture',design_sessions:[],browser_required:false};
  const taskPath=path.join(f.dir,'modern.json');await writeJson(taskPath,t);await freeze(taskPath);
  const config={...f.config,elevated_reviewer:{...f.config.reviewer,model:'elevated-fixture'}};
  const run=resume=>runBridge({cwd:f.repo,taskPath,config,packetDir:f.packetDir,pilot:true,resume});
  assert.equal((await run(false)).status,'READY_FOR_OWNER');
  const changed=await readJson(taskPath);changed.effective_risk='ELEVATED';await writeJson(taskPath,changed);
  await writeJson(path.join(f.packetDir,'evidence.json'),await verify(taskPath,f.repo));
  assert.equal((await run(true)).status,'NEEDS_FIX');
  const final=await run(true);assert.equal(final.status,'READY_FOR_OWNER');
  assert.equal(final.history.at(-1).tier,'elevated_reviewer');
 }finally{await f.cleanup();}
});

test('corrected material review follows repair budget and does not shop for another approval',async()=>{
 const f=await setup('pass');try{
  assert.equal((await f.run()).status,'READY_FOR_OWNER');
  const file=path.join(f.packetDir,'review.json'),r=await readJson(file);r.verdict='NEEDS_FIX';r.material_findings=['fix the fixture'];await writeJson(file,r);
  const paused=await f.run({resume:true});assert.equal(paused.status,'NEEDS_FIX');assert.equal(paused.phase,'repair');
  const final=await f.run({resume:true});assert.equal(final.status,'READY_FOR_OWNER');assert.equal(final.repair_rounds,1);
  assert.equal(await readFile(path.join(f.repo,'feature.txt'),'utf8'),'repaired\n');
 }finally{await f.cleanup();}
});

test('missing elevated reviewer stops before any writer call',async()=>{
 const f=await setup('pass');try{
  const t=await readJson(f.taskPath);t.task_id='TASK-MISSING-REVIEWER';t.risk='ELEVATED';
  t.execution={policy:'GEMINI_FIRST_V1',prepared:true,local_synthetic:true,rationale:'Local fixture',design_sessions:[],browser_required:false};
  const taskPath=path.join(f.dir,'modern.json');await writeJson(taskPath,t);await freeze(taskPath);
  const s=await runBridge({cwd:f.repo,taskPath,config:f.config,packetDir:f.packetDir,pilot:true});
  assert.equal(s.status,'WAITING_CAPABILITY');assert.equal(s.history.length,0);
 }finally{await f.cleanup();}
});
test('repair budget persists: two repairs, one senior pass, then stop',async()=>{
  const f=await setup('always-fail');try{
    const s=await f.run();assert.equal(s.status,'BLOCKED_TECHNICAL');assert.equal(s.repair_rounds,2);assert.equal(s.senior_passes,1);
    assert.deepEqual(s.history.filter(h=>h.phase==='worker').map(h=>h.tier),['worker','worker','worker','senior']);
    assert.equal(s.history.filter(h=>h.phase==='worker').length,4);
    assert.equal((await f.run({resume:true})).history.length,s.history.length);
  }finally{await f.cleanup();}
});
for(const [mode,status] of [['quota','WAITING_QUOTA'],['timeout','BLOCKED_TECHNICAL'],['invalid','BLOCKED_TECHNICAL'],['self','BLOCKED_TECHNICAL'],['review-write','BLOCKED_TECHNICAL'],['out-of-scope','BLOCKED_TECHNICAL']]) {
  test(mode+' preserves checkpoint and refuses uncertain replay',async()=>{
    const f=await setup(mode);try{
      const s=await f.run();assert.equal(s.status,status);assert.equal(s.reconciliation_required,true);
      const count=s.history.length;
      if(['review-write','out-of-scope'].includes(mode))await assert.rejects(f.run({resume:true}),/clean/);
      else assert.equal((await f.run({resume:true})).status,'BLOCKED_TECHNICAL');
      assert.equal((await readJson(path.join(f.packetDir,'state.json'))).history.length,count);
    }finally{await f.cleanup();}
  });
}
test('dirty tree and a second writer fail before spawning',async()=>{
  const f=await setup();try{
    const release=await acquire(f.repo);await assert.rejects(f.run(),/lock exists/);await release();
    await writeFile(path.join(f.repo,'feature.txt'),'owner work');await assert.rejects(f.run(),/clean/);
    assert.equal(await readFile(path.join(f.repo,'feature.txt'),'utf8'),'owner work');
  }finally{await f.cleanup();}
});
test('default mode cannot execute automatic work or accept fake profile toggle',async()=>{
  const f=await setup();try{
    await assert.rejects(f.run({pilot:false}),/ASSISTED/);
    f.config.mode='LOCAL_AUTO';await assert.rejects(f.run({pilot:false}),/ENOENT/);
  }finally{await f.cleanup();}
});
test('quota drill binds a completed Windows pilot without calling provider CLIs',windowsOnly,async()=>{
  const f=await setup();try{
    const state=await f.run();assert.equal(state.status,'READY_FOR_OWNER');
    const statePath=path.join(f.packetDir,'state.json'),stored=await readJson(statePath);
    await assert.rejects(quotaDrill(f.config,f.packetDir,path.join(f.dir,'activation')),/both real subscription providers/);
    stored.history.find(h=>h.phase==='worker').provider='google';
    stored.capability_history[0].reports.find(r=>r.role==='worker').provider='google';
    await writeJson(statePath,stored);const before=await readFile(statePath,'utf8'),activationDir=path.join(f.dir,'activation');
    await assert.rejects(quotaDrill(f.config,f.packetDir,f.packetDir),/must be separate/);
    const drill=await quotaDrill(f.config,f.packetDir,activationDir);
    assert.equal(drill.status,'QUOTA_DRILL_PASS');assert.equal(drill.pause.status,'WAITING_QUOTA');assert.equal(drill.resume.automatic_replay,false);
    assert.equal(await readFile(statePath,'utf8'),before);
    const receipt=await activate(f.config,f.packetDir,activationDir);assert.equal(receipt.status,'ACCEPTED');
    const altered=await readJson(path.join(activationDir,'quota-drill.json'));delete altered.pause.history_digest;delete altered.resume.history_digest;await writeJson(path.join(activationDir,'quota-drill.json'),altered);
    await assert.rejects(activate(f.config,f.packetDir,activationDir),/quota drill receipt/);
    altered.pause.history_digest=drill.pause.history_digest;altered.resume.history_digest=drill.resume.history_digest;altered.pause.status='DONE';await writeJson(path.join(activationDir,'quota-drill.json'),altered);
    f.config.mode='LOCAL_AUTO';await assert.rejects(runBridge({cwd:f.repo,taskPath:f.taskPath,config:f.config,packetDir:activationDir,pilot:false}),/quota drill receipt/);
  }finally{await f.cleanup();}
});
test('LOCAL_AUTO resume stays valid after its first task advances the pilot checkout',windowsOnly,async()=>{
  const f=await setup();try{
    const pilot=await f.run(),statePath=path.join(f.packetDir,'state.json');assert.equal(pilot.status,'READY_FOR_OWNER');
    const stored=await readJson(statePath);stored.history.find(h=>h.phase==='worker').provider='google';stored.capability_history[0].reports.find(r=>r.role==='worker').provider='google';await writeJson(statePath,stored);
    const activationDir=path.join(f.dir,'activation'),drill=await quotaDrill(f.config,f.packetDir,activationDir);await activate(f.config,f.packetDir,activationDir);
    const automatic={...(await readJson(f.taskPath)),task_id:'TASK-AUTO-FOLLOW-UP',base_sha:git(f.repo,'rev-parse','HEAD').trim(),candidate_head:null,contract_sha256:null,implementer_sessions:[],repair_rounds:0,senior_passes:0,user_visible:false,owner_acceptance:null};
    const automaticPath=path.join(f.dir,'automatic-task.json');await writeJson(automaticPath,automatic);await freeze(automaticPath);
    f.config.mode='LOCAL_AUTO';const done=await runBridge({cwd:f.repo,taskPath:automaticPath,config:f.config,packetDir:activationDir,pilot:false});assert.equal(done.status,'DONE');
    assert.notEqual(git(f.repo,'rev-parse','HEAD').trim(),pilot.head);
    assert.equal((await runBridge({cwd:f.repo,taskPath:automaticPath,config:f.config,packetDir:activationDir,pilot:false,resume:true})).status,'DONE');
    assert.equal((await readJson(path.join(activationDir,'quota-drill.json'))).pause.history_digest,drill.pause.history_digest);
  }finally{await f.cleanup();}
});
test('protocol requires session, completion and valid result; requested model is not observed model',()=>{
  assert.throws(()=>parseProtocol('openai','{}'),/incomplete/);
  assert.throws(()=>parseProtocol('google',JSON.stringify({response:'{}'})),/session/);
  const body={verdict:'PASS',summary:'ok',material_findings:[],risk_checks_completed:false};
  const parsed=parseProtocol('google',JSON.stringify({session_id:'session',response:JSON.stringify(body),stats:{models:{'actual-model':{}}}}));
  assert.deepEqual(parsed.observed_models,['actual-model']);
  assert.equal(failureStatus({code:0,stdout:'quota issue discussed',stderr:''}),null);
});
test('Codex accepts only known transient transport notices and permits probe-only diagnostics',()=>{
  const diagnostic={verdict:'PASS',summary:'probe completed',material_findings:['read-only environment'],risk_checks_completed:false};
  const events=[
    {type:'thread.started',thread_id:'probe-session'},
    {type:'error',message:'Reconnecting... 2/5 (temporary transport failure)'},
    {type:'error',message:'Falling back from WebSockets to HTTPS transport. temporary transport failure'},
    {type:'item.completed',item:{type:'agent_message',text:JSON.stringify(diagnostic)}},
    {type:'turn.completed'}
  ];
  const transcript=events.map(JSON.stringify).join('\n');
  assert.throws(()=>parseProtocol('openai',transcript),/invalid structured result/);
  assert.deepEqual(parseProtocol('openai',transcript,'gemini',{capabilityProbe:true}).result,diagnostic);
  assert.throws(()=>parseProtocol('openai',events.map((event,index)=>index===1?{type:'error',message:'authentication failed'}:event).map(JSON.stringify).join('\n'),'gemini',{capabilityProbe:true}),/incomplete/);
  assert.throws(()=>parseProtocol('openai',[...events,{type:'error',message:'Reconnecting... 3/5 (unresolved transport failure)'}].map(JSON.stringify).join('\n'),'gemini',{capabilityProbe:true}),/incomplete/);
});
test('redaction preserves long TASK identifiers while hiding standalone credential prefixes',()=>{
  assert.equal(redactText('TASK-LIVE-PILOT-5'),'TASK-LIVE-PILOT-5');
  assert.equal(redactText('value: sk-synthetic123456789'),'value: [REDACTED_TOKEN]');
});
test('subscription environment and adapters prevent API fallback and preserve argv boundaries',async()=>{
  const env=subscriptionEnv({Path:'ok',OPENAI_API_KEY:'dummy',GOOGLE_APPLICATION_CREDENTIALS:'dummy',GEMINI_API_KEY:'dummy',GEMINI_CLI_SYSTEM_SETTINGS_PATH:'override',CODEX_HOME:'override',TEST_SECRET:'dummy'});
  assert.deepEqual(env,{Path:'ok'});
  const f=await setup();try{
    const spec=await invocation(f.config.worker,{cwd:f.repo,packetDir:f.packetDir,role:'reviewer',prompt:'a & b $(not-shell)'});
    assert(spec.argv.includes('read-only'));assert(spec.argv.includes('forced_login_method="chatgpt"'));assert.equal(spec.input,'a & b $(not-shell)');
    const google=await invocation({...f.config.worker,provider:'google',cli:'gemini'},{cwd:f.repo,packetDir:f.packetDir,role:'reviewer',prompt:'probe'});
    assert(google.argv.includes('plan'));const settings=await readJson(google.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH);
    assert.equal(settings.security.auth.enforcedType,'oauth-personal');
  }finally{await f.cleanup();}
});
test('Antigravity terminal envelope and billing settings fail closed',()=>{
  const result={verdict:'PASS',summary:'actual payload',material_findings:[],risk_checks_completed:false};
  const event={event:'result',result:{status:'SUCCESS',conversation_id:'agy-session',structured_output:result}};
  const parsed=parseProtocol('google',JSON.stringify(event),'antigravity');assert.equal(parsed.session_id,'agy-session');
  for(const status of ['ERROR','WAITING','RUNNING','INTERRUPTED'])assert.throws(()=>parseProtocol('google',JSON.stringify({...event,result:{...event.result,status}}),'antigravity'));
  assert.throws(()=>assertSubscriptionSettings({}));assert.throws(()=>assertSubscriptionSettings({useG1Credits:true}));
  assert.throws(()=>assertSubscriptionSettings({useG1Credits:false,modelProvider:'gemini'}));assertSubscriptionSettings({useG1Credits:false});
  const denied=JSON.stringify({event:'result',result:{status:'SUCCESS',conversation_id:'saved-even-with-empty-response',response:'',denied_actions:[{action:'read_file',display_name:'ListDir'}]}});
  assert.deepEqual(protocolMetadata('google',denied,'antigravity'),{session_id:'saved-even-with-empty-response',denied_actions:['read_file']});
  assert.throws(()=>parseProtocol('google',denied,'antigravity'));
});
test('bounded output and cancellation kill real processes',async()=>{
  const overflow=await execute([process.execPath,'-e',"console.log('x'.repeat(5000));setInterval(()=>{},1000)"],{maxBytes:100});
  assert.equal(overflow.reason,'OUTPUT_LIMIT');assert.equal(overflow.stdout,'');
  const controller=new AbortController();setTimeout(()=>controller.abort(),100);
  const cancelled=await execute([process.execPath,'-e','setInterval(()=>{},1000)'],{signal:controller.signal});
  assert.equal(cancelled.reason,'INTERRUPTED');
});
test('worker cannot rewrite npm gate definitions even if mistakenly allowlisted',async()=>{
  const f=await setup('weaken-gate');try{
    f.config.write_paths.push('package.json');
    const s=await f.run();assert.equal(s.status,'BLOCKED_TECHNICAL');assert.match(s.error,/protected task\/gate/);
    assert.equal(s.history.filter(h=>h.phase==='gates').length,0);
  }finally{await f.cleanup();}
});
test('review packet captures real exact-head diff and complete changed source; stale/dirty is rejected',async()=>{
  const f=await setup();try{
    const source=reviewSource(f.repo,f.task,f.config);
    assert.equal(source.head,f.task.candidate_head);assert.match(source.diff,/\+feature/);
    assert.equal(source.files.find(f=>f.path==='feature.txt').content,'feature\n');
    await writeFile(path.join(f.repo,'feature.txt'),'later edit');assert.throws(()=>reviewSource(f.repo,f.task,f.config),/clean/);
  }finally{await f.cleanup();}
});
test('aborting verification terminates active gate and prevents later gates',async()=>{
  const f=await fixture([{id:'wait',argv:[process.execPath,'-e','setTimeout(()=>console.log("should not finish"),10000)'],timeout_seconds:20},
    {id:'later',argv:[process.execPath,'-e','console.log("should not run")'],timeout_seconds:2}]);
  try{
    const controller=new AbortController();setTimeout(()=>controller.abort(),200);
    const started=Date.now(),e=await verify(f.taskPath,f.repo,{signal:controller.signal});
    assert.equal(e.status,'FAIL');assert.equal(e.gates.length,1);assert.equal(e.gates[0].interrupted,true);assert.equal(e.gates[0].code,130);
    assert(!e.gates[0].stdout.includes('should not finish'));assert(Date.now()-started<8000);
  }finally{await f.cleanup();}
});

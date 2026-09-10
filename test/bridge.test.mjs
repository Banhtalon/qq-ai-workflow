import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {fixture} from './fixture.mjs';
import {git,readJson,writeJson,freeze,verify} from '../scripts/lib/workflow.mjs';
import {execute,subscriptionEnv,failureStatus} from '../scripts/lib/bridge-process.mjs';
import {redactText} from '../scripts/lib/redact.mjs';
import {parseProtocol,invocation,assertSubscriptionSettings,protocolMetadata} from '../scripts/lib/bridge-adapters.mjs';
import {runBridge,acquire,reviewSource,quotaDrill,activate} from '../scripts/lib/bridge.mjs';

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
if(!probe&&mode==='quota'){console.error('429 quota exhausted');process.exit(1);}
if(!probe&&mode==='timeout'){setInterval(()=>{},1000);await new Promise(()=>{});}
if(!probe&&mode==='invalid'){console.log('not JSON');process.exit(0);}
if(!probe&&mode==='self'){}
if(!probe&&worker){writeFileSync('feature.txt',input.includes('fix the fixture')?'repaired\\n':'written\\n');}
if(!probe&&mode==='review-write'&&!worker)writeFileSync('feature.txt','reviewer mutation');
if(!probe&&mode==='out-of-scope'&&worker)writeFileSync('unexpected.txt','oops');
if(!probe&&mode==='weaken-gate'&&worker)writeFileSync('package.json',JSON.stringify({scripts:{test:'node -e "process.exit(0)"'}}));
const fail=!probe&&!worker&&(mode==='always-fail'||(mode==='repair'&&readFileSync('feature.txt','utf8')!=='repaired\\n'));
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
  }finally{await f.cleanup();}
});
test('repair budget persists: two repairs, one senior pass, then stop',async()=>{
  const f=await setup('always-fail');try{
    const s=await f.run();assert.equal(s.status,'BLOCKED_TECHNICAL');assert.equal(s.repair_rounds,2);assert.equal(s.senior_passes,1);
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
test('quota drill binds a completed Windows pilot without calling provider CLIs',async()=>{
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
test('LOCAL_AUTO resume stays valid after its first task advances the pilot checkout',async()=>{
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

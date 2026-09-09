import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {fixture} from './fixture.mjs';
import {git,readJson,writeJson} from '../scripts/lib/workflow.mjs';
import {execute,subscriptionEnv,failureStatus} from '../scripts/lib/bridge-process.mjs';
import {parseProtocol,invocation} from '../scripts/lib/bridge-adapters.mjs';
import {runBridge,acquire} from '../scripts/lib/bridge.mjs';

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
const fail=!probe&&!worker&&(mode==='always-fail'||(mode==='repair'&&readFileSync('feature.txt','utf8')!=='repaired\\n'));
const result={verdict:fail?'NEEDS_FIX':'PASS',summary:'fake process',material_findings:fail?['fix the fixture']:[],risk_checks_completed:true};
console.log(JSON.stringify({type:'thread.started',thread_id:mode==='self'?'same-session':randomUUID()}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(result)}}));
console.log(JSON.stringify({type:'turn.completed'}));
`);
  const binding={provider:'openai',model:'fixture',command:[process.execPath,cli]};
  const config={schema_version:'qq.bridge.v1',billing:'SUBSCRIPTION_ONLY',mode:'ASSISTED',timeout_seconds:2,write_paths:['feature.txt'],worker:binding,reviewer:binding,senior:binding};
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
test('protocol requires session, completion and valid result; requested model is not observed model',()=>{
  assert.throws(()=>parseProtocol('openai','{}'),/incomplete/);
  assert.throws(()=>parseProtocol('google',JSON.stringify({response:'{}'})),/session/);
  const body={verdict:'PASS',summary:'ok',material_findings:[],risk_checks_completed:false};
  const parsed=parseProtocol('google',JSON.stringify({session_id:'session',response:JSON.stringify(body),stats:{models:{'actual-model':{}}}}));
  assert.deepEqual(parsed.observed_models,['actual-model']);
  assert.equal(failureStatus({code:0,stdout:'quota issue discussed',stderr:''}),null);
});
test('subscription environment and adapters prevent API fallback and preserve argv boundaries',async()=>{
  const env=subscriptionEnv({Path:'ok',OPENAI_API_KEY:'dummy',GOOGLE_APPLICATION_CREDENTIALS:'dummy',GEMINI_API_KEY:'dummy',GEMINI_CLI_SYSTEM_SETTINGS_PATH:'override',CODEX_HOME:'override',TEST_SECRET:'dummy'});
  assert.deepEqual(env,{Path:'ok'});
  const f=await setup();try{
    const spec=await invocation(f.config.worker,{cwd:f.repo,packetDir:f.packetDir,role:'reviewer',prompt:'a & b $(not-shell)'});
    assert(spec.argv.includes('read-only'));assert(spec.argv.includes('forced_login_method="chatgpt"'));assert.equal(spec.input,'a & b $(not-shell)');
    const google=await invocation({...f.config.worker,provider:'google'},{cwd:f.repo,packetDir:f.packetDir,role:'reviewer',prompt:'probe'});
    assert(google.argv.includes('plan'));const settings=await readJson(google.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH);
    assert.equal(settings.security.auth.enforcedType,'oauth-personal');
  }finally{await f.cleanup();}
});
test('bounded output and cancellation kill real processes',async()=>{
  const overflow=await execute([process.execPath,'-e',"console.log('x'.repeat(5000));setInterval(()=>{},1000)"],{maxBytes:100});
  assert.equal(overflow.reason,'OUTPUT_LIMIT');assert.equal(overflow.stdout,'');
  const controller=new AbortController();setTimeout(()=>controller.abort(),100);
  const cancelled=await execute([process.execPath,'-e','setInterval(()=>{},1000)'],{signal:controller.signal});
  assert.equal(cancelled.reason,'INTERRUPTED');
});

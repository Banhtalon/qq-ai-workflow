import path from 'node:path';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import os from 'node:os';
import {execute,subscriptionEnv,failureStatus,safe} from './bridge-process.mjs';
import {beginInvocation,finishInvocation} from './receipts.mjs';

export const resultSchema={type:'object',additionalProperties:false,required:['verdict','summary','material_findings','risk_checks_completed'],properties:{
  verdict:{type:'string',enum:['PASS','NEEDS_FIX','BLOCKED']},summary:{type:'string'},
  material_findings:{type:'array',items:{type:'string'}},risk_checks_completed:{type:'boolean'}
}};
export function validateBinding(b) {
  if(!b||!['openai','google'].includes(b.provider)||!Array.isArray(b.command)||!b.command.length||b.command.some(x=>typeof x!=='string'||!x)||!/^[-a-zA-Z0-9_.]+$/.test(b.model??''))throw Error('invalid CLI binding');
  if(b.command.length>2||(b.command.length===2&&(!/node(?:\.exe)?$/i.test(b.command[0])||! /\.(?:mjs|cjs|js)$/i.test(b.command[1]))))throw Error('binding must be executable or node entry point');
  if(b.effort!=null&&!['low','medium','high','xhigh','max','ultra'].includes(b.effort))throw Error('invalid effort');
  if(b.provider==='google'&&b.cli!=null&&!['gemini','antigravity'].includes(b.cli))throw Error('invalid Google CLI');
  if(b.provider==='openai'&&b.cli!=null&&b.cli!=='codex')throw Error('invalid OpenAI CLI');
  return b;
}
export async function invocation(binding,{cwd,packetDir,role,prompt}) {
  const b=validateBinding(binding),env=subscriptionEnv();
  await mkdir(packetDir,{recursive:true});
  if(b.provider==='openai'){
    const schema=path.join(packetDir,'result-schema.json');await writeFile(schema,JSON.stringify(resultSchema));
    const args=[...b.command,'exec','--ignore-user-config','-c','forced_login_method="chatgpt"','-c','model_provider="openai"','-c','approval_policy="never"','-m',b.model,'-s',role==='worker'?'workspace-write':'read-only','--json','--output-schema',schema,'-C',cwd];
    if(b.effort)args.push('-c',`model_reasoning_effort="${b.effort}"`);
    args.push('-');return {argv:args,env,input:prompt};
  }
  if(b.cli!=='gemini'){
    if(role==='reviewer')throw Error('Antigravity plan is not a read-only permission boundary; configure Codex reviewer');
    const settingsPath=path.join(os.homedir(),'.gemini','antigravity-cli','settings.json');
    const settings=JSON.parse(await readFile(settingsPath,'utf8'));
    if(settings.useG1Credits===undefined){settings.useG1Credits=false;await writeFile(settingsPath,JSON.stringify(settings,null,2)+'\n');}
    assertSubscriptionSettings(settings);
    const schema=path.join(packetDir,'result-schema.json');await writeFile(schema,JSON.stringify(resultSchema));
    return {argv:[...b.command,'--add-dir',cwd,'--input-format','stream-json','--output-format','stream-json','--json-schema',schema,'--disable-slash-commands','--model',b.model,...(role==='worker'?['--mode','accept-edits']:[])],env,
      input:JSON.stringify({event:'user',message:{content:`The task repository is ${cwd}. Work only in this directory, not the default CLI scratch directory. Use built-in file tools; do not invoke shell commands or delegate. The Lead runs git and gates.\n${prompt}`}})+'\n'};
  }
  const settings=path.join(packetDir,'gemini-subscription.json');
  await writeFile(settings,JSON.stringify({security:{auth:{selectedType:'oauth-personal',enforcedType:'oauth-personal'},enablePermanentToolApproval:false},general:{enableAutoUpdate:false},tools:{autoAccept:false},mcpServers:{}}));
  env.GEMINI_CLI_SYSTEM_SETTINGS_PATH=settings;
  return {argv:[...b.command,'--model',b.model,'--approval-mode',role==='worker'?'auto_edit':'plan','--output-format','json','--extensions','none','--prompt','Follow the task supplied on stdin.'],env,input:prompt};
}
export function assertSubscriptionSettings(settings){if(settings.useG1Credits!==false||settings.modelProvider)throw Error('Antigravity requires useG1Credits=false and default account provider; no API/credit fallback');}
export function protocolMetadata(provider,stdout,cli) {
  const events=stdout.trim().split(/\r?\n/).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  const session=provider==='openai'?events.find(e=>e.type==='thread.started')?.thread_id:cli==='antigravity'?events.find(e=>e.event==='result')?.result?.conversation_id??events.find(e=>e.event==='init')?.conversation_id:events[0]?.session_id;
  const denied=cli==='antigravity'?events.flatMap(e=>e.result?.denied_actions??[]).map(x=>x.action).filter(x=>typeof x==='string'):[];
  return safe({...(typeof session==='string'&&session?{session_id:session}:{}),...(denied.length?{denied_actions:denied}:{})});
}
function transientOpenAITransportEvent(event) {if(event.type!=='error')return false;const message=event.message??event.error?.message??'';return /^Reconnecting\.\.\. \d+\/\d+ \(/.test(message)||/^Falling back from WebSockets to HTTPS transport\./.test(message);}
export function parseProtocol(provider,stdout,cli='gemini',{capabilityProbe=false}={}) {
  let session,models=[],body,usage=null;
  if(provider==='openai') {
    const events=stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));const starts=events.filter(e=>e.type==='thread.started');const completed=events.findLastIndex(e=>e.type==='turn.completed'),lastTransient=events.findLastIndex(transientOpenAITransportEvent);
    if(starts.length!==1||completed<0||lastTransient>=completed||events.some(e=>e.type==='turn.failed'||(e.type==='error'&&!transientOpenAITransportEvent(e))))throw Error('incomplete Codex protocol');
    session=starts[0].thread_id;const messages=events.filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message');body=messages.at(-1)?.item.text;models=[...new Set(events.flatMap(e=>e.model?[e.model]:[]))];usage=events.filter(e=>e.type==='turn.completed').at(-1)?.usage??null;
  } else if(cli==='antigravity') {
    const events=stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));const results=events.filter(e=>e.event==='result');
    if(results.length!==1||results[0].result?.status!=='SUCCESS')throw Error('incomplete Antigravity protocol');const response=results[0].result;session=response.conversation_id;usage=response.usage??response.stats??null;models=[...new Set(events.flatMap(e=>e.init?.model?[e.init.model]:[]))];body=response.structured_output?JSON.stringify(response.structured_output):response.response;
  } else {
    const response=JSON.parse(stdout);if(response.error)throw Error('Gemini protocol error');session=response.session_id;models=Object.keys(response.stats?.models??{});body=response.response;usage=response.usage??response.stats??null;
  }
  if(typeof session!=='string'||!session.trim()||typeof body!=='string')throw Error('missing session or structured response');
  const result=JSON.parse(body.replace(/^```(?:json)?\s*\n?/,'').replace(/\n?```\s*$/,''));
  if(result&&Object.keys(result).some(k=>!['verdict','summary','material_findings','risk_checks_completed'].includes(k)))throw Error('unexpected structured result field');
  if(!result||!['PASS','NEEDS_FIX','BLOCKED'].includes(result.verdict)||typeof result.summary!=='string'||!Array.isArray(result.material_findings)||!result.material_findings.every(x=>typeof x==='string')||typeof result.risk_checks_completed!=='boolean'||(result.verdict==='PASS'&&result.material_findings.length&&!capabilityProbe))throw Error('invalid structured result');
  return safe({session_id:session,observed_models:models,usage,result});
}
export async function invoke(binding,options) {
  const spec=await invocation(binding,options),started_at=new Date().toISOString(),receiptKind=options.receiptKind;
  const context=await beginInvocation({packetDir:options.packetDir,role:options.role,receiptKind,binding,prompt:options.prompt,started_at});
  let r;
  try {r=await execute(spec.argv,{...spec,cwd:options.cwd,timeoutSeconds:options.timeoutSeconds,signal:options.signal});}
  catch(error){const finished_at=new Date().toISOString();const failed=safe({provider:binding.provider,requested_model:binding.model,requested_effort:binding.effort??null,argv:spec.argv,code:null,reason:'EXECUTION_THROW',started_at,finished_at,status:'BLOCKED_TECHNICAL'});await finishInvocation({packetDir:options.packetDir,receiptRoot:options.receiptRoot,role:options.role,receiptKind,binding,prompt:options.prompt,result:failed,started_at,finished_at,context});throw error;}
  const record=safe({provider:binding.provider,requested_model:binding.model,requested_effort:binding.effort??null,argv:spec.argv,code:r.code,reason:r.reason,started_at:r.started_at??started_at,finished_at:r.finished_at??new Date().toISOString(),status:failureStatus(r)});
  Object.assign(record,protocolMetadata(binding.provider,r.stdout,binding.cli??(binding.provider==='openai'?'codex':'antigravity')));
  if(!record.status&&record.denied_actions?.length){record.status='WAITING_CAPABILITY';record.reason='TOOL_PERMISSION_DENIED';}
  if(!record.status){try{Object.assign(record,parseProtocol(binding.provider,r.stdout,binding.cli??(binding.provider==='openai'?'codex':'antigravity'),{capabilityProbe:receiptKind==='PROBE'}));}catch{record.status='BLOCKED_TECHNICAL';record.reason='INVALID_PROTOCOL';}}
  await finishInvocation({packetDir:options.packetDir,receiptRoot:options.receiptRoot,role:options.role,receiptKind,binding,prompt:options.prompt,result:record,started_at:record.started_at,finished_at:record.finished_at,context});
  return record;
}
export async function doctor(binding,{cwd,packetDir,probe=false,signal,receiptRoot}={}) {
  validateBinding(binding);const version=await execute([...binding.command,'--version'],{cwd,timeoutSeconds:20,signal});
  const report={provider:binding.provider,requested_model:binding.model,cli_version:safe(version.stdout.trim()),status:failureStatus(version)??'UNPROBED',auth:'UNVERIFIED',structured_output:false};
  if(report.status!=='UNPROBED')return report;
  if(binding.provider==='openai'){const auth=await execute([...binding.command,'login','status'],{cwd,timeoutSeconds:20,signal});if(auth.code!==0||! /Logged in using ChatGPT/i.test(auth.stdout+auth.stderr))return {...report,status:'WAITING_CAPABILITY',auth:'CHATGPT_LOGIN_REQUIRED'};report.auth='CHATGPT';}
  if(!probe)return report;let result;
  try{result=await invoke(binding,{cwd,packetDir,receiptRoot:receiptRoot??packetDir,role:'probe',receiptKind:'PROBE',timeoutSeconds:90,signal,prompt:'Capability probe. Do not use tools or change files. Reply only with JSON: {"verdict":"PASS","summary":"subscription CLI probe","material_findings":[],"risk_checks_completed":false}'});}
  catch{return {...report,status:'WAITING_CAPABILITY',auth:'SUBSCRIPTION_CONFIGURATION_REQUIRED'};}
  return {...report,status:result.status??'PROBED',auth:result.status?report.auth:binding.provider==='google'?'GOOGLE_OAUTH':'CHATGPT',structured_output:!result.status,execution:result};
}

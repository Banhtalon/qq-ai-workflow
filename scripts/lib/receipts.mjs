import path from 'node:path';
import {mkdir,readFile,rename,open,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {safe} from './bridge-process.mjs';
import {executionRoute} from './workflow.mjs';

export const RECEIPT_SCHEMA_VERSION='qq.workflow.receipt.v1';
export const RECEIPT_KINDS=new Set(['PROBE','WORK','REVIEW','REPAIR','SENIOR','ELEVATED_REVIEW']);
const sha256=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const canonical=value=>JSON.stringify(safe(value));
export function promptHash(prompt){return sha256(prompt??'');}
export function normalizeUsage(usage,provider){
  if(!usage||typeof usage!=='object')return {source:'unavailable',input_tokens:null,output_tokens:null,reasoning_tokens:null,cached_tokens:null,total_tokens:null};
  const pick=(value,...keys)=>{for(const key of keys)if(Number.isFinite(value?.[key]))return value[key];return null;};
  const tokens=usage.tokens&&typeof usage.tokens==='object'?usage.tokens:null;
  const modelTokens=usage.models&&typeof usage.models==='object'?Object.values(usage.models).map(model=>model?.tokens&&typeof model.tokens==='object'?model.tokens:null):[];
  const sumModels=keys=>{if(!modelTokens.length)return null;let total=0;for(const value of modelTokens){const counter=pick(value,...keys);if(counter===null)return null;total+=counter;}return total;};
  const direct=(...keys)=>pick(usage,...keys)??pick(tokens,...keys);
  const input_tokens=direct('input_tokens','inputTokens','prompt_tokens','promptTokens','prompt')??sumModels(['input_tokens','inputTokens','prompt_tokens','promptTokens','prompt']);
  const output_tokens=direct('output_tokens','outputTokens','completion_tokens','completionTokens','candidates')??sumModels(['output_tokens','outputTokens','completion_tokens','completionTokens','candidates']);
  const reasoning_tokens=direct('reasoning_tokens','reasoningTokens','thoughts')??sumModels(['reasoning_tokens','reasoningTokens','thoughts']);
  const cached_tokens=direct('cached_tokens','cachedTokens','cached_input_tokens','cachedInputTokens','cache_read_input_tokens','cacheReadInputTokens','cached')??sumModels(['cached_tokens','cachedTokens','cached_input_tokens','cachedInputTokens','cache_read_input_tokens','cacheReadInputTokens','cached']);
  const explicit_total=direct('total_tokens','totalTokens','total')??sumModels(['total_tokens','totalTokens','total']);const total_tokens=explicit_total===null&&input_tokens!==null&&output_tokens!==null?input_tokens+output_tokens:explicit_total;
  const hasAny=[input_tokens,output_tokens,reasoning_tokens,cached_tokens,total_tokens].some(v=>v!==null);
  return {source:hasAny?(provider??'provider'):'unavailable',input_tokens,output_tokens,reasoning_tokens,cached_tokens,total_tokens};
}
async function atomicJson(file,value){await mkdir(path.dirname(file),{recursive:true});const persisted=safe(value);const tmp=file+'.'+randomUUID()+'.tmp';const fd=await open(tmp,'wx');try{await fd.writeFile(JSON.stringify(persisted,null,2)+'\n');await fd.sync();}finally{await fd.close();}await rename(tmp,file);return persisted;}
async function contextFor(packetDir){let current=path.resolve(packetDir);for(let i=0;i<5;i++){try{const state=JSON.parse(await readFile(path.join(current,'state.json'),'utf8'));let task=null;if(typeof state.task_path==='string')try{task=JSON.parse(await readFile(state.task_path,'utf8'));}catch{}return {root:current,state,task};}catch(error){if(error.code!=='ENOENT')throw error;}current=path.dirname(current);}return {root:path.resolve(packetDir),state:null,task:null};}
function kindFor(role,state,task,receiptKind){if(receiptKind)return receiptKind;if(role==='probe')return 'PROBE';if(role==='reviewer')return executionRoute(task??{},{}).reviewer==='elevated_reviewer'?'ELEVATED_REVIEW':'REVIEW';if(role==='worker'){const tier=executionRoute(task??{}, {executing:true}).worker;if(state?.senior_passes>0||tier==='senior')return 'SENIOR';if(state?.repair_rounds>0)return 'REPAIR';return 'WORK';}return null;}
function resolveKind(role,state,task,receiptKind){const kind=kindFor(role,state,task,receiptKind);if(!RECEIPT_KINDS.has(kind))throw Error('invalid receipt kind');return kind;}
function receiptHash(receipt){const copy={...receipt};delete copy.receipt_sha256;return sha256(canonical(copy));}
async function nextChain(root){try{return JSON.parse(await readFile(path.join(root,'.receipts-chain.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;return {schema_version:RECEIPT_SCHEMA_VERSION,entries:[],last_receipt_sha256:null};}}
async function appendChain(root,receipt,receiptPath){const chain=await nextChain(root);const persisted=safe(receipt);persisted.prev_receipt_sha256=chain.last_receipt_sha256;persisted.receipt_sha256=receiptHash(persisted);const relative=path.relative(root,receiptPath).replaceAll(path.sep,'/');
  const next={schema_version:RECEIPT_SCHEMA_VERSION,entries:[...(chain.entries??[]),{receipt_id:persisted.receipt_id,receipt_sha256:persisted.receipt_sha256,path:relative}],last_receipt_sha256:persisted.receipt_sha256};
  await atomicJson(path.join(root,'.receipts-chain.json'),next);return persisted;}

export async function beginInvocation({packetDir,role,receiptKind,binding,prompt,started_at}){
  const context=await contextFor(packetDir);const {state,task}=context;const kind=resolveKind(role,state,task,receiptKind);const run_id=state?.run_id??null,task_id=task?.task_id??null,assignment_id=randomUUID();
  const cli=binding.cli??(binding.provider==='openai'?'codex':null);
  const assignment={schema_version:RECEIPT_SCHEMA_VERSION,receipt_type:'ASSIGNMENT',assignment_id,task_id,run_id,kind,phase:role,role,provider:binding.provider,cli,requested_model:binding.model,requested_effort:binding.effort??null,
    scope:task?{goal:task.goal??null,revision:task.revision??null}:null,contract_sha256:task?.contract_sha256??state?.contract_sha256??null,budget_assigned:null,prompt_sha256:promptHash(prompt),created_at:started_at};
  await atomicJson(path.join(packetDir,'receipts','assignment.json'),assignment);return {...context,assignment};
}

function sanitizeModelText(value,prompt){if(typeof value!=='string'||!prompt)return value;return value.split(prompt).join('[prompt omitted]');}
export async function finishInvocation({packetDir,receiptRoot,role,receiptKind,binding,prompt,result,started_at,finished_at,context}){
  const {state,task,root}=context??await contextFor(packetDir);const kind=resolveKind(role,state,task,receiptKind);const assignment_id=context?.assignment?.assignment_id??null;const cli=binding.cli??(binding.provider==='openai'?'codex':null);
  const summary=sanitizeModelText(result?.result?.summary??null,prompt),findings=Array.isArray(result?.result?.material_findings)?result.result.material_findings.map(x=>sanitizeModelText(x,prompt)):[];
  const execution={schema_version:RECEIPT_SCHEMA_VERSION,receipt_type:'EXECUTION',receipt_id:randomUUID(),task_id:task?.task_id??null,run_id:state?.run_id??null,assignment_id,kind,phase:role,role,provider:binding.provider,cli,requested_model:binding.model,observed_models:result?.observed_models??[],requested_effort:binding.effort??null,
    start_at:started_at,end_at:finished_at,duration_ms:Date.parse(finished_at)-Date.parse(started_at),session_id:result?.session_id??null,status:result?.status??null,reason:result?.reason??null,verdict:result?.result?.verdict??null,head_before:state?.head??null,head_after:null,
    usage:normalizeUsage(result?.usage,binding.provider),evidence_refs:[],result_summary:summary,findings,contract_sha256:task?.contract_sha256??state?.contract_sha256??null,prompt_sha256:promptHash(prompt)};
  const target=path.join(packetDir,'receipts','execution.json');const chained=await appendChain(receiptRoot??root,execution,target);await atomicJson(target,chained);return chained;
}

async function executionFiles(root){const found=[];async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.name.startsWith('.'))continue;const full=path.join(dir,entry.name);if(entry.isDirectory())await walk(full);else if(entry.name==='execution.json')found.push(full);}}await walk(root);return found.sort();}
export async function verifyReceiptChain(root){
  const chain=await nextChain(root);if(chain.schema_version!==RECEIPT_SCHEMA_VERSION||!Array.isArray(chain.entries))return {ok:false,reason:'invalid chain metadata'};
  const actual=new Map();for(const file of await executionFiles(root)){const value=JSON.parse(await readFile(file,'utf8'));const rel=path.relative(root,file).replaceAll(path.sep,'/');actual.set(rel,value);}
  if(actual.size!==chain.entries.length)return {ok:false,reason:'receipt count mismatch'};
  let previous=null;for(const entry of chain.entries){const receipt=actual.get(entry.path);if(!receipt)return {ok:false,reason:'missing receipt: '+entry.path};if(receipt.prev_receipt_sha256!==previous)return {ok:false,reason:'broken previous hash: '+entry.path};if(receipt.receipt_sha256!==entry.receipt_sha256||receiptHash(receipt)!==entry.receipt_sha256)return {ok:false,reason:'receipt hash mismatch: '+entry.path};previous=entry.receipt_sha256;}
  if(previous!==chain.last_receipt_sha256)return {ok:false,reason:'final chain pointer mismatch'};
  return {ok:true,count:chain.entries.length,last_receipt_sha256:previous};
}

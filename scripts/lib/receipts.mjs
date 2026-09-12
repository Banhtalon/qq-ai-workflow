import path from 'node:path';
import {mkdir,readFile,rename,open} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';

export const RECEIPT_SCHEMA_VERSION='qq.workflow.receipt.v1';
export const RECEIPT_KINDS=new Set(['PROBE','WORK','REVIEW','REPAIR','SENIOR','ELEVATED_REVIEW']);
const sha256=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');

export function promptHash(prompt){return sha256(prompt??'');}
export function normalizeUsage(usage,provider){
  if(!usage||typeof usage!=='object')return {source:'unavailable',input_tokens:null,output_tokens:null,reasoning_tokens:null,cached_tokens:null,total_tokens:null};
  const pick=(...keys)=>{for(const key of keys)if(Number.isFinite(usage[key]))return usage[key];return null;};
  const input_tokens=pick('input_tokens','inputTokens','prompt_tokens','promptTokens');
  const output_tokens=pick('output_tokens','outputTokens','completion_tokens','completionTokens');
  const reasoning_tokens=pick('reasoning_tokens','reasoningTokens');
  const cached_tokens=pick('cached_tokens','cachedTokens','cache_read_input_tokens','cacheReadInputTokens');
  const explicit_total=pick('total_tokens','totalTokens');
  const total_tokens=explicit_total===null&&input_tokens!==null&&output_tokens!==null?input_tokens+output_tokens:explicit_total;
  const hasAny=[input_tokens,output_tokens,reasoning_tokens,cached_tokens,total_tokens].some(v=>v!==null);
  return {source:hasAny?(provider??'provider'):'unavailable',input_tokens,output_tokens,reasoning_tokens,cached_tokens,total_tokens};
}
async function atomicJson(file,value){
  await mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';const fd=await open(tmp,'wx');
  try{await fd.writeFile(JSON.stringify(value,null,2)+'\n');await fd.sync();}finally{await fd.close();}await rename(tmp,file);
}
async function contextFor(packetDir){
  let current=path.resolve(packetDir);
  for(let i=0;i<4;i++){
    try{const state=JSON.parse(await readFile(path.join(current,'state.json'),'utf8'));let task=null;
      if(typeof state.task_path==='string')try{task=JSON.parse(await readFile(state.task_path,'utf8'));}catch{}
      return {root:current,state,task};
    }catch(error){if(error.code!=='ENOENT')throw error;}
    current=path.dirname(current);
  }
  return {root:path.resolve(packetDir),state:null,task:null};
}
function kindFor(role){return role==='probe'?'PROBE':role==='worker'?'WORK':role==='reviewer'?'REVIEW':role==='senior'?'SENIOR':role==='elevated_reviewer'?'ELEVATED_REVIEW':null;}
function receiptHash(receipt){const copy={...receipt};delete copy.receipt_sha256;return sha256(copy);}
async function nextChain(root){try{return JSON.parse(await readFile(path.join(root,'.receipts-chain.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;return {last_receipt_sha256:null};}}
async function appendChain(root,receipt){const chain=await nextChain(root);receipt.prev_receipt_sha256=chain.last_receipt_sha256;receipt.receipt_sha256=receiptHash(receipt);
  await atomicJson(path.join(root,'.receipts-chain.json'),{schema_version:RECEIPT_SCHEMA_VERSION,last_receipt_sha256:receipt.receipt_sha256});return receipt;}

export async function beginInvocation({packetDir,role,binding,prompt,started_at}){
  const kind=kindFor(role);if(!kind)throw Error('invalid receipt role');
  const {state,task}=await contextFor(packetDir);const run_id=state?.run_id??null,task_id=task?.task_id??null,assignment_id=randomUUID();
  const assignment={schema_version:RECEIPT_SCHEMA_VERSION,receipt_type:'ASSIGNMENT',assignment_id,task_id,run_id,kind,phase:role,role,
    provider:binding.provider,cli:binding.cli??null,requested_model:binding.model,requested_effort:binding.effort??null,
    scope:task?{goal:task.goal??null,revision:task.revision??null}:null,contract_sha256:task?.contract_sha256??state?.contract_sha256??null,
    budget_assigned:null,prompt_sha256:promptHash(prompt),created_at:started_at};
  await atomicJson(path.join(packetDir,'receipts','assignment.json'),assignment);return {assignment,state,task};
}

export async function finishInvocation({packetDir,role,binding,prompt,result,started_at,finished_at,context}){
  const kind=kindFor(role);if(!kind)throw Error('invalid receipt role');
  const {state,task}=context??await contextFor(packetDir);const assignment_id=context?.assignment?.assignment_id??null;
  const execution={schema_version:RECEIPT_SCHEMA_VERSION,receipt_type:'EXECUTION',receipt_id:randomUUID(),task_id:task?.task_id??null,run_id:state?.run_id??null,
    assignment_id,kind,phase:role,role,provider:binding.provider,cli:binding.cli??null,requested_model:binding.model,observed_models:result?.observed_models??[],
    requested_effort:binding.effort??null,start_at:started_at,end_at:finished_at,duration_ms:Date.parse(finished_at)-Date.parse(started_at),
    session_id:result?.session_id??null,status:result?.status??null,reason:result?.reason??null,head_before:state?.head??null,head_after:null,
    usage:normalizeUsage(result?.usage,binding.provider),evidence_refs:[],result_summary:result?.result?.summary??null,findings:result?.result?.material_findings??[],
    contract_sha256:task?.contract_sha256??state?.contract_sha256??null,prompt_sha256:promptHash(prompt)};
  const chained=await appendChain(context?.root??(await contextFor(packetDir)).root,execution);await atomicJson(path.join(packetDir,'receipts','execution.json'),chained);return chained;
}
export async function verifyReceiptChain(root){const chain=await nextChain(root);return chain.schema_version===RECEIPT_SCHEMA_VERSION&&typeof chain.last_receipt_sha256==='string';}

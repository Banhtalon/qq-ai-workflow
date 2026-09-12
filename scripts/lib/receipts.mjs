import path from 'node:path';
import {mkdir,readFile,rename,open} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';

export const RECEIPT_SCHEMA_VERSION='qq.workflow.receipt.v1';
export const RECEIPT_KINDS=new Set(['PROBE','WORK','REVIEW','REPAIR','SENIOR','ELEVATED_REVIEW']);

const sha256=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const safeNumber=value=>Number.isFinite(value)?value:null;

export function promptHash(prompt){return sha256(prompt??'');}

export function normalizeUsage(usage,provider){
  if(!usage||typeof usage!=='object')return {source:'unavailable',input_tokens:null,output_tokens:null,reasoning_tokens:null,cached_tokens:null,total_tokens:null};
  const pick=(...keys)=>{for(const key of keys){if(Number.isFinite(usage[key]))return usage[key];}return null;};
  let input_tokens=pick('input_tokens','inputTokens','prompt_tokens','promptTokens');
  let output_tokens=pick('output_tokens','outputTokens','completion_tokens','completionTokens');
  let reasoning_tokens=pick('reasoning_tokens','reasoningTokens');
  let cached_tokens=pick('cached_tokens','cachedTokens','cache_read_input_tokens','cacheReadInputTokens');
  let total_tokens=pick('total_tokens','totalTokens');
  if(total_tokens===null&&[input_tokens,output_tokens].every(v=>v!==null))total_tokens=input_tokens+output_tokens;
  const hasAny=[input_tokens,output_tokens,reasoning_tokens,cached_tokens,total_tokens].some(v=>v!==null);
  return {source:hasAny?(provider??'provider'):'unavailable',input_tokens,output_tokens,reasoning_tokens,cached_tokens,total_tokens};
}

async function atomicJson(file,value){
  await mkdir(path.dirname(file),{recursive:true});
  const tmp=file+'.'+randomUUID()+'.tmp';const fd=await open(tmp,'wx');
  try{await fd.writeFile(JSON.stringify(value,null,2)+'\n');await fd.sync();}finally{await fd.close();}
  await rename(tmp,file);
}

async function contextFor(packetDir){
  let current=path.resolve(packetDir);
  for(let i=0;i<4;i++){
    const stateFile=path.join(current,'state.json');
    try{
      const state=JSON.parse(await readFile(stateFile,'utf8'));
      let task=null;
      if(typeof state.task_path==='string')try{task=JSON.parse(await readFile(state.task_path,'utf8'));}catch{}
      return {root:current,state,task};
    }catch(error){if(error.code!=='ENOENT')throw error;}
    current=path.dirname(current);
  }
  return {root:path.resolve(packetDir),state:null,task:null};
}

function kindFor(role){
  if(role==='probe')return 'PROBE';
  if(role==='worker')return 'WORK';
  if(role==='reviewer')return 'REVIEW';
  if(role==='senior')return 'SENIOR';
  if(role==='elevated_reviewer')return 'ELEVATED_REVIEW';
  throw Error('invalid receipt role');
}

function receiptHash(receipt){
  const copy={...receipt};delete copy.receipt_sha256;return sha256(copy);
}

async function nextChain(root){
  const file=path.join(root,'.receipts-chain.json');
  try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;return {last_receipt_sha256:null};}
}

async function appendChain(root,receipt){
  const chain=await nextChain(root);
  receipt.prev_receipt_sha256=chain.last_receipt_sha256;
  receipt.receipt_sha256=receiptHash(receipt);
  await atomicJson(path.join(root,'.receipts-chain.json'),{schema_version:RECEIPT_SCHEMA_VERSION,last_receipt_sha256:receipt.receipt_sha256});
  return receipt;
}

export async function recordInvocation({packetDir,role,binding,prompt,result,argv,started_at,finished_at}){
  const kind=kindFor(role),{root,state,task}=await contextFor(packetDir);
  const run_id=state?.run_id??null,task_id=task?.task_id??null,assignment_id=randomUUID();
  const contract_sha256=task?.contract_sha256??state?.contract_sha256??null;
  const assignment={schema_version:RECEIPT_SCHEMA_VERSION,receipt_type:'ASSIGNMENT',assignment_id,task_id,run_id,kind,phase:role,
    role,provider:binding.provider,cli:binding.cli??null,requested_model:binding.model,requested_effort:binding.effort??null,
    scope:task?{goal:task.goal??null,revision:task.revision??null}:null,contract_sha256,budget_assigned:null,
    prompt_sha256:promptHash(prompt),created_at:started_at};
  const execution={schema_version:RECEIPT_SCHEMA_VERSION,receipt_type:'EXECUTION',receipt_id:randomUUID(),task_id,run_id,assignment_id,kind,phase:role,
    role,provider:binding.provider,cli:binding.cli??null,requested_model:binding.model,observed_models:result?.observed_models??[],
    requested_effort:binding.effort??null,start_at:started_at,end_at:finished_at,duration_ms:Date.parse(finished_at)-Date.parse(started_at),
    session_id:result?.session_id??null,status:result?.status??null,reason:result?.reason??null,head_before:state?.head??null,head_after:null,
    usage:normalizeUsage(result?.usage,binding.provider),evidence_refs:[],result_summary:result?.result?.summary??null,findings:result?.result?.material_findings??[],
    contract_sha256,prompt_sha256:promptHash(prompt)};
  await mkdir(path.join(packetDir,'receipts'),{recursive:true});
  await atomicJson(path.join(packetDir,'receipts','assignment.json'),assignment);
  const chained=await appendChain(root,execution);
  await atomicJson(path.join(packetDir,'receipts','execution.json'),chained);
  return {assignment,chained};
}

export async function verifyReceiptChain(root){
  const chain=await nextChain(root);return chain.schema_version===RECEIPT_SCHEMA_VERSION&&typeof chain.last_receipt_sha256==='string';
}

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { runRedacted, looksLikeSecretArgument, redactText } from "./redact.mjs";

const sha=x=>/^[0-9a-f]{40}$/.test(x??"");
const digest=x=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const text=x=>typeof x==="string" && x.trim().length>0;
const required=(ok,msg)=>{if(!ok)throw new Error(msg);};
export const readJson=async p=>JSON.parse(await readFile(p,"utf8"));
export const writeJson=(p,v,flag="w")=>writeFile(p,JSON.stringify(v,null,2)+"\n",{flag});
export function contract(t){
  const keys=["schema_version","task_id","revision","base_sha","goal","acceptance_criteria","gates","user_visible","risk","complexity"];
  return Object.fromEntries(keys.map(k=>[k,t[k]]));
}
export const contractHash=t=>digest(contract(t));
function assertSafeGateMetadata(gates){
  // Reject before writing packets: evidence must retain exact, credential-free argv.
  // Inspect every gate up front, including gates after an earlier failure.
  for(const g of gates){
    const values=[g.id,...g.argv];
    required(values.every(value=>!looksLikeSecretArgument(value)&&redactText(value)===value)&&
      !g.argv.some(value=>/^--?(?:password|passwd|secret|token|cookie|api[_-]?key|private[_-]?key)$/i.test(value)),
      "Secret-like gate metadata rejected; use the account environment, not packet arguments");
  }
}
export function validateTask(t){
  required(t?.schema_version==="qq.workflow.task.v10","unsupported task schema");
  required(/^TASK-[A-Z0-9_-]+$/i.test(t.task_id??""),"invalid task id");
  required(Number.isInteger(t.revision)&&t.revision>0,"invalid revision");
  required(sha(t.base_sha),"invalid base SHA");
  required(text(t.goal),"missing goal");
  required(Array.isArray(t.acceptance_criteria)&&t.acceptance_criteria.length>0&&t.acceptance_criteria.every(text),"missing acceptance criteria");
  required(Array.isArray(t.gates)&&t.gates.length>0,"missing gates");
  const ids=new Set();
  for(const g of t.gates){
    required(text(g.id)&&!ids.has(g.id),"duplicate or missing gate id");ids.add(g.id);
    required(Array.isArray(g.argv)&&g.argv.length>0&&g.argv.every(text),"invalid gate argv");
    required(Number.isInteger(g.timeout_seconds)&&g.timeout_seconds>=1&&g.timeout_seconds<=3600,"invalid timeout");
  }
  required(typeof t.user_visible==="boolean","user_visible must be boolean");
  required(["LOW","ELEVATED"].includes(t.risk),"invalid risk");
  required(t.effective_risk===undefined||["LOW","ELEVATED"].includes(t.effective_risk),"invalid effective risk");
  required(["SIMPLE","COMPLEX"].includes(t.complexity),"invalid complexity");
  for(const k of ["repair_rounds","senior_passes"]) required(Number.isInteger(t[k])&&t[k]>=0,"invalid "+k);
  required(t.repair_rounds<=2&&t.senior_passes<=1,"repair budget exceeded");
  required(Array.isArray(t.implementer_sessions)&&t.implementer_sessions.every(text),"invalid implementer sessions");
  return t;
}
export function validateProfile(p){
  required(p?.schema_version==="qq.workflow.profile.v10","unsupported profile");
  required(p.billing==="SUBSCRIPTION_ONLY","paid fallback is not allowed");
  required(p.routing_mode==="ASSISTED"&&p.bridge_installed===false,"LOCAL_AUTO requires the separate tested bridge; not shipped");
  required(p.max_repairs===2&&p.max_senior_passes===1&&p.max_writers===1,"unsupported budget/concurrency");
  for(const role of ["fast","senior","review"]){
    const b=p.bindings?.[role];
    required(b&&["google","openai"].includes(b.provider)&&typeof b.verified==="boolean","invalid binding");
    required(!b.verified||text(b.model),"verified binding requires model");
  }
  return p;
}
export function route(t,p,{quotaAvailable=true,needsRepair=false}={}){
  validateTask(t);validateProfile(p);
  if(needsRepair&&t.senior_passes>=1) return {status:"BLOCKED_TECHNICAL",reason:"senior repair exhausted"};
  if(!quotaAvailable)return {status:"WAITING_QUOTA",reason:"preserve counters; no paid fallback"};
  const tier=t.risk==="ELEVATED"||t.effective_risk==="ELEVATED"||t.complexity==="COMPLEX"||t.repair_rounds>=2?"senior":"fast";
  const binding=p.bindings[tier];
  if(!binding.verified)return {status:"WAITING_CAPABILITY",tier,reason:"account/model not verified"};
  return {status:"ROUTE_PROPOSED",tier,binding,invoked:false};
}
export const git=(cwd,...args)=>execFileSync("git",args,{cwd,encoding:"utf8",maxBuffer:16*1024*1024});
export function cleanHead(cwd,expected){
  const head=git(cwd,"rev-parse","HEAD").trim();
  required(!expected||head===expected,"candidate head changed");
  required(git(cwd,"status","--porcelain","--untracked-files=all").trim()==="","candidate must be clean; ignore local packet directory");
  return head;
}
export async function freeze(taskPath){
  const t=validateTask(await readJson(taskPath));
  assertSafeGateMetadata(t.gates);
  const hash=contractHash(t);
  await writeJson(taskPath+".lock.json",{schema_version:"qq.workflow.lock.v10",task_id:t.task_id,revision:t.revision,contract_sha256:hash,effective_risk_floor:t.risk},"wx");
  t.contract_sha256=hash;t.effective_risk=t.risk;await writeJson(taskPath,t);return {status:"FROZEN",contract_sha256:hash};
}
export async function assertContract(taskPath,t){
  validateTask(t);
  const lock=await readJson(taskPath+".lock.json");
  required(lock.schema_version==="qq.workflow.lock.v10"&&lock.task_id===t.task_id&&lock.revision===t.revision&&
    lock.contract_sha256===contractHash(t)&&t.contract_sha256===lock.contract_sha256,"contract changed or lock mismatch");
  required(["LOW","ELEVATED"].includes(lock.effective_risk_floor),"invalid effective risk floor");
  required(["LOW","ELEVATED"].includes(t.effective_risk),"missing effective risk");
  required(!(t.risk==="ELEVATED"&&lock.effective_risk_floor!=="ELEVATED"),"risk floor below contract risk");
  required(!(lock.effective_risk_floor==="ELEVATED"&&t.effective_risk!=="ELEVATED"),"effective risk cannot decrease within a revision");
  return lock;
}
export async function verify(taskPath,cwd){
  const t=await readJson(taskPath);const lock=await assertContract(taskPath,t);
  assertSafeGateMetadata(t.gates);
  required(sha(t.candidate_head),"candidate head missing");
  const head=cleanHead(cwd,t.candidate_head);
  git(cwd,"merge-base","--is-ancestor",t.base_sha,head);
  const paths=git(cwd,"diff","--no-renames","--name-only",t.base_sha,head);
  const diff=git(cwd,"diff","--no-ext-diff","--no-textconv","--no-renames","--unified=0",t.base_sha,head);
  const elevated=lock.effective_risk_floor==="ELEVATED"||t.risk==="ELEVATED"||t.effective_risk==="ELEVATED"||/(^|[/\n])(auth|permissions|migrations|supabase|database)([/\.\n])|(^|[/\n])\.env|rls|credential|secret/i.test(paths)||
    /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE|DELETE\s+FROM)\b|service[_-]?role/i.test(diff);
  t.effective_risk=elevated?"ELEVATED":"LOW";
  await writeJson(taskPath,t);
  if(elevated&&lock.effective_risk_floor!=="ELEVATED"){
    lock.effective_risk_floor="ELEVATED";await writeJson(taskPath+".lock.json",lock);
  }
  const results=[];
  for(const g of t.gates){
    results.push({id:g.id,argv:g.argv,timeout_seconds:g.timeout_seconds,
      ...await runRedacted(g.argv,{cwd,timeoutSeconds:g.timeout_seconds})});
    if(results.at(-1).code!==0)break;
  }
  cleanHead(cwd,head);
  const after=await readJson(taskPath);const afterLock=await assertContract(taskPath,after);
  required(after.candidate_head===head&&after.effective_risk===t.effective_risk&&afterLock.effective_risk_floor===t.effective_risk&&contractHash(after)===contractHash(t),"task changed during gates");
  return {schema_version:"qq.workflow.evidence.v10",task_id:t.task_id,revision:t.revision,
    base_sha:t.base_sha,head,contract_sha256:t.contract_sha256,scope:"local",
    effective_risk:t.effective_risk,recorded_at:new Date().toISOString(),
    status:results.length===t.gates.length&&results.every(g=>g.code===0&&!g.timed_out)?"PASS":"FAIL",gates:results};
}
export function readiness(t,e,r){
  validateTask(t);
  const wait=reason=>({status:"NEEDS_FIX",reason});
  if(!sha(t.candidate_head)||t.contract_sha256!==contractHash(t)||!["LOW","ELEVATED"].includes(t.effective_risk))return wait("contract/head invalid");
  if(!t.implementer_sessions.length)return wait("missing implementation session identity");
  if(!e||e.schema_version!=="qq.workflow.evidence.v10"||e.task_id!==t.task_id||e.revision!==t.revision||
    e.base_sha!==t.base_sha||e.head!==t.candidate_head||e.contract_sha256!==t.contract_sha256||e.scope!=="local"||e.status!=="PASS"||
    e.effective_risk!==t.effective_risk||!Array.isArray(e.gates)||e.gates.length!==t.gates.length)
    return wait("missing, failed or stale verification");
  for(let i=0;i<t.gates.length;i++){
    const a=t.gates[i],b=e.gates[i];
    if(b.id!==a.id||JSON.stringify(b.argv)!==JSON.stringify(a.argv)||b.timeout_seconds!==a.timeout_seconds||
      b.code!==0||b.timed_out!==false||b.redaction_applied!==true)return wait("required gate not passed");
  }
  if(!r)return {status:"WAITING_CAPABILITY",reason:"independent review needed"};
  if(r.schema_version!=="qq.workflow.review.v10"||r.task_id!==t.task_id||r.revision!==t.revision||
    r.head!==t.candidate_head||r.contract_sha256!==t.contract_sha256||r.independent!==true||
    !text(r.reviewer_session)||t.implementer_sessions.includes(r.reviewer_session))
    return wait("review is stale or not independent");
  if(r.verdict!=="PASS"||!Array.isArray(r.material_findings)||r.material_findings.length>0)
    return wait("review has unresolved findings");
  if((t.risk==="ELEVATED"||t.effective_risk==="ELEVATED"||e.effective_risk==="ELEVATED")&&r.risk_checks_completed!==true)
    return wait("elevated risk review missing");
  if(!t.user_visible)return {status:"DONE",merge_authorized:false};
  const a=t.owner_acceptance;
  if(a?.accepted===true&&a.head===t.candidate_head&&a.contract_sha256===t.contract_sha256&&text(a.source))
    return {status:"DONE",merge_authorized:false};
  return {status:"READY_FOR_OWNER",merge_authorized:false};
}

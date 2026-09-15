import path from 'node:path';
import {lstat,readFile,realpath,readdir} from 'node:fs/promises';
import {redactText} from './redact.mjs';
import {verifyReceiptChain} from './receipts.mjs';

const MAX_SOURCE_BYTES=2*1024*1024;
const DEFAULT_MAX_BYTES=8192;
const sensitiveKey=/(?:password|passwd|secret|cookie|authorization|api[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token)/i;
function clean(value,key=''){
  if(typeof value==='string')return sensitiveKey.test(key)?'[REDACTED]':redactText(value);
  if(Array.isArray(value))return value.map(item=>clean(item,key));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,clean(item,name)]));
  return value;
}
const scalar=value=>typeof value==='string'?value:value??null;
const ownerStatus=(value,hasBoundProductEvidence=false)=>({
  READY_FOR_OWNER:hasBoundProductEvidence?'Đã qua kiểm tra kỹ thuật và đang chờ Owner thử':'Đã qua kiểm tra kỹ thuật; Sol/Lead đang chuẩn bị hướng dẫn thử',
  DONE:'Đã hoàn tất quy trình được ghi nhận',
  WAITING_QUOTA:'Đang chờ hạn mức sử dụng dịch vụ',
  WAITING_CAPABILITY:'Đang chờ công cụ cần thiết hoạt động lại',
  BLOCKED_TECHNICAL:'Đang vướng lỗi kỹ thuật',
  NEEDS_FIX:'Cần sửa trước khi kiểm tra lại',
  UNVERIFIED:'Chưa đủ bằng chứng để xác nhận',
  WAIT:'Đang chờ xử lý',
  STOP:'Đã dừng để Lead kiểm tra'
}[value]??'Chưa xác định; Lead cần kiểm tra hồ sơ');
const ownerPendingPhase=value=>({
  PRODUCT_CHECK_WAIT:'Đang chờ kiểm tra trải nghiệm sản phẩm.',
  REVIEW_WAIT:'Đang chờ người kiểm tra độc lập.',
  RECONCILE_REQUIRED:'Đang chờ Lead đối soát công việc dang dở.',
  REPAIR:'Đang trong vòng sửa lỗi có giới hạn.'
}[value]??'Công việc đang chờ Lead xử lý.');

async function regularJson(file,{root=null,maxBytes=MAX_SOURCE_BYTES}={}){
  const resolved=path.resolve(file);
  try{
    if(root){const [actual,actualRoot]=await Promise.all([realpath(resolved),realpath(path.resolve(root))]);const rel=path.relative(actualRoot,actual);if(rel===''||rel==='..'||rel.startsWith(`..${path.sep}`)||path.isAbsolute(rel))return null;}
    const info=await lstat(resolved);if(!info.isFile()||info.isSymbolicLink()||info.size>maxBytes)return null;
    return JSON.parse(await readFile(resolved,'utf8'));
  }catch(error){if(['ENOENT','ENOTDIR'].includes(error.code)||error instanceof SyntaxError)return null;throw error;}
}

function taskPathFor(state,packetDir){
  if(typeof state?.task_path!=='string')return null;
  const resolved=path.resolve(state.task_path),allowedRoot=path.dirname(path.resolve(packetDir));
  const rel=path.relative(allowedRoot,resolved);
  return rel!==''&&rel!=='..'&&!rel.startsWith(`..${path.sep}`)&&!path.isAbsolute(rel)?resolved:null;
}

function strictlyBound(object,identity){
  return !!object&&typeof identity?.task_id==='string'&&identity.task_id.length>0&&Number.isInteger(identity.revision)&&typeof identity.head==='string'&&identity.head.length>0&&typeof identity.contract_sha256==='string'&&identity.contract_sha256.length>0&&object.task_id===identity.task_id&&object.revision===identity.revision&&object.contract_sha256===identity.contract_sha256&&(object.head===identity.head||object.candidate_head===identity.head);
}

function blockersFor(state,evidence,review,audience='lead'){
  const owner=audience==='owner';
  const blockers=[];
  const waitingPhases=new Set(['PRODUCT_CHECK_WAIT','REVIEW_WAIT','RECONCILE_REQUIRED','REPAIR']);
  if(state?.reconciliation_required||state?.in_flight||state?.budget?.pending_reconcile)blockers.push(owner?'Lead cần đối soát một thao tác đang dang dở.':'An interrupted or uncertain operation requires Lead reconciliation.');
  if(state?.error)blockers.push(owner?'Công việc đang vướng lỗi kỹ thuật; Lead cần kiểm tra hồ sơ đầy đủ.':scalar(state.error));
  if(['WAITING_QUOTA','WAITING_CAPABILITY','BLOCKED_TECHNICAL','NEEDS_FIX','UNVERIFIED','WAIT','STOP'].includes(state?.status))blockers.push(owner?`${ownerStatus(state.status)}.`:`Observed workflow status: ${state.status}.`);
  if(waitingPhases.has(state?.phase))blockers.push(owner?ownerPendingPhase(state.phase):`Workflow is pending at phase ${state.phase}.`);
  if(evidence?.status&&evidence.status!=='PASS')blockers.push(owner?'Kiểm tra kỹ thuật chưa đạt.':`Observed gate evidence status: ${evidence.status}.`);
  const failedGates=(evidence?.gates??[]).filter(gate=>gate.code!==0||gate.timed_out||gate.interrupted);
  if(owner&&failedGates.length)blockers.push(`${failedGates.length} kiểm tra kỹ thuật chưa đạt.`);
  if(!owner)for(const gate of failedGates)blockers.push(`Gate ${scalar(gate.id)??'unknown'} did not pass (code ${gate.code??'unavailable'}).`);
  const findings=review?.material_findings??[];
  if(owner&&findings.length)blockers.push(`Reviewer yêu cầu sửa ${findings.length} vấn đề.`);
  if(!owner)for(const finding of findings)blockers.push(scalar(finding));
  if(review?.verdict&&review.verdict!=='PASS')blockers.push(owner?`Kết quả review: ${review.verdict}.`:`Observed review verdict: ${review.verdict}.`);
  return [...new Set(blockers.filter(Boolean))];
}

function nextStep(state,hasBoundProductEvidence,audience,hasBlockers=false){
  const owner=audience==='owner';
  if(state?.reconciliation_required||state?.in_flight||state?.budget?.pending_reconcile)return owner?'Lead cần đối soát thao tác đang dang dở trước khi tiếp tục.':'Lead must reconcile the recorded in-flight operation before any resume.';
  if(state?.phase==='RECONCILE_REQUIRED')return owner?'Lead cần đối soát checkpoint trước khi tiếp tục.':'Lead must reconcile the checkpoint before resume.';
  if(state?.phase==='PRODUCT_CHECK_WAIT')return owner?'Lead cần hoàn tất kiểm tra trải nghiệm sản phẩm trước khi tiếp tục.':'Complete or validate the frozen Product Check before using the existing resume command.';
  if(state?.phase==='REVIEW_WAIT')return owner?'Lead cần hoàn tất bước kiểm tra độc lập trước khi tiếp tục.':'Complete the independent review before using the existing resume command.';
  if(state?.phase==='REPAIR')return owner?'Lead kiểm tra phát hiện rồi tiếp tục vòng sửa có giới hạn.':'Use the existing resume command for the bounded repair flow after Lead checks the findings.';
  if(state?.status==='DONE'&&hasBlockers)return owner?'Sol/Lead sẽ xử lý các trở ngại đã ghi trước khi kết luận công việc hoàn tất.':'Resolve the recorded blockers before treating this work as complete.';
  switch(state?.status){
    case 'WAITING_QUOTA':return owner?'Sol/Lead sẽ tiếp tục khi hạn mức sử dụng dịch vụ được khôi phục.':'Wait for subscription quota, then use the existing resume command; do not replay automatically.';
    case 'WAITING_CAPABILITY':return owner?'Lead cần khôi phục hoặc xác minh khả năng cần thiết trước khi tiếp tục.':'Lead must restore or verify the required capability before using the existing resume command.';
    case 'NEEDS_FIX':return owner?'Sol/Lead sẽ kiểm tra vấn đề và tiếp tục vòng sửa có giới hạn.':'Use the existing resume command for the bounded repair flow after Lead checks the findings.';
    case 'BLOCKED_TECHNICAL':return owner?'Sol/Lead sẽ kiểm tra và xử lý trở ngại kỹ thuật.':'Lead must inspect the full packet and resolve the technical blocker before resume.';
    case 'UNVERIFIED':return owner?'Lead cần xác minh bằng chứng còn thiếu trước khi tiếp tục.':'Inspect and restore the missing verification before resume.';
    case 'WAIT':return owner?'Sol/Lead sẽ xử lý điều kiện đang chờ trước khi tiếp tục.':'Inspect the full packet and resolve the recorded wait condition before resume.';
    case 'STOP':return owner?'Sol/Lead sẽ kiểm tra lý do dừng trước khi tiếp tục.':'Inspect the full packet and resolve the recorded stop reason before any resume.';
    case 'READY_FOR_OWNER':return hasBoundProductEvidence?(owner?'Owner có thể thử sản phẩm theo hướng dẫn bên dưới.':'Owner may perform the recorded local product actions.'):(owner?'Sol/Lead sẽ kiểm tra và bổ sung hướng dẫn thử nếu tính năng có giao diện.':'Inspect the full packet; no current bound local product actions were observed.');
    case 'DONE':return owner?'Bản tóm tắt này không đề xuất thêm thao tác.':'No workflow action is suggested by this derived report.';
    default:return owner?'Sol/Lead sẽ kiểm tra hồ sơ trước khi quyết định bước tiếp theo.':'Inspect the full packet before deciding whether resume is safe.';
  }
}

function nextActor(state,hasBoundProductEvidence,hasBlockers=false){
  if(state?.status==='DONE'&&!hasBlockers)return 'Không cần thao tác thêm';
  if(state?.status==='READY_FOR_OWNER'&&hasBoundProductEvidence)return 'Owner';
  return 'Sol/Lead';
}

function usageValue(usage,key){const value=usage?.[key];return Number.isFinite(value)&&value>=0?value:null;}
function normModel(m){if(typeof m!=='string')return null;let s=m.trim().toLowerCase();if(s.startsWith('models/'))s=s.slice(7);if(s.endsWith(':latest'))s=s.slice(0,-7);return s||null;}
export function aggregateInvocations(items,observed){
  const groups=new Map();let anyUsage=false;
  const totals={source:'unavailable',input_tokens:null,output_tokens:null,reasoning_tokens:null,cached_tokens:null,total_tokens:null};
  const known={input_tokens:0,output_tokens:0,reasoning_tokens:0,cached_tokens:0,total_tokens:0};
  const invocations=items.map(item=>{
    const role=item.role??item.phase??item.kind??item.binding?.role??'unavailable';
    const provider=item.provider??item.observed_by_bridge?.provider??item.binding?.provider??'unavailable';
    const requested_model=item.requested_model??item.observed_by_bridge?.requested_model??item.binding?.model??'unavailable';
    let observed_models=[];
    if(Array.isArray(item.observed_models)&&item.observed_models.length>0){
      observed_models=item.observed_models.filter(x=>typeof x==='string'&&x.trim());
    }else if(Array.isArray(item.result?.observed_models)&&item.result.observed_models.length>0){
      observed_models=item.result.observed_models.filter(x=>typeof x==='string'&&x.trim());
    }else if(typeof item.reported_by_provider?.actual_model==='string'&&item.reported_by_provider.actual_model.trim()){
      observed_models=[item.reported_by_provider.actual_model.trim()];
    }else if(typeof item.observed_models==='string'&&item.observed_models.trim()){
      observed_models=[item.observed_models.trim()];
    }else if(typeof item.result?.observed_models==='string'&&item.result.observed_models.trim()){
      observed_models=[item.result.observed_models.trim()];
    }else if(Array.isArray(item.observed_models)){
      observed_models=item.observed_models.filter(x=>typeof x==='string'&&x.trim());
    }else if(Array.isArray(item.result?.observed_models)){
      observed_models=item.result.observed_models.filter(x=>typeof x==='string'&&x.trim());
    }
    const requested_effort=item.requested_effort??item.observed_by_bridge?.requested_effort??item.binding?.effort??null;
    const normReq=(requested_model!=='unavailable')?normModel(requested_model):null;
    const normObs=observed_models.map(normModel).filter(Boolean);
    let model_match='uncertain';
    if(normObs.length>0&&normReq){
      model_match=normObs.includes(normReq)?'matched':'mismatched';
    }
    return {
      receipt_id:item.receipt_id??item.result?.receipt_id??null,
      role,
      provider,
      requested_model,
      observed_models,
      requested_effort,
      model_match
    };
  });
  for(const item of items){
    const role=item.role??item.phase??item.kind??item.binding?.role??'unavailable',
          provider=item.provider??item.observed_by_bridge?.provider??item.binding?.provider??'unavailable';
    const key=`${role}\0${provider}`;groups.set(key,{role,provider,count:(groups.get(key)?.count??0)+1});
    const usage=item.usage??item.reported_by_provider?.usage??item.result?.usage??null;
    const fields={input_tokens:['input_tokens'],output_tokens:['output_tokens'],reasoning_tokens:['reasoning_tokens','thinking_tokens'],cached_tokens:['cached_tokens','cache_read_tokens'],total_tokens:['total_tokens']};
    for(const [target,sources] of Object.entries(fields)){let value=null;for(const source of sources){value=usageValue(usage,source);if(value!==null)break;}if(value!==null){totals[target]=(totals[target]??0)+value;known[target]++;anyUsage=true;}}
  }
  for(const field of Object.keys(known))if(known[field]!==items.length)totals[field]=null;
  totals.source=!anyUsage?'unavailable':Object.values(known).every(count=>count===items.length)?'reported':'partial';
  return {
    observed,
    count:observed?items.length:null,
    by_role_provider:[...groups.values()],
    invocations,
    requested_versus_observed:invocations.map(r=>({
      role:r.role,
      provider:r.provider,
      requested_model:r.requested_model,
      observed_models:r.observed_models,
      model_match:r.model_match
    })),
    usage:totals
  };
}

async function receiptInvocations(packetDir,state,identity){
  const items=[],seen=new Set();
  if(typeof identity?.task_id!=='string'||!identity.task_id||typeof identity?.contract_sha256!=='string'||!identity.contract_sha256)return {items,observed:false};
  const roots=[];
  const addRoot=async(root,type)=>{try{const info=await lstat(path.join(root,'.receipts-chain.json'));if(!info.isFile()||info.isSymbolicLink())return false;roots.push({root,type});return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
  await addRoot(packetDir,'legacy');
  let direct=[];try{direct=await readdir(packetDir,{withFileTypes:true});}catch{return {items,observed:false};}
  const workerName=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for(const entry of direct){
    if(!entry.isDirectory())continue;
    if(workerName.test(entry.name)||entry.name===state?.bridge_run_id)await addRoot(path.join(packetDir,entry.name),'worker');
    else if(/^reviewer-[0-9a-f-]+$/i.test(entry.name)||/^elevated-reviewer-[0-9a-f-]+$/i.test(entry.name))await addRoot(path.join(packetDir,entry.name),'reviewer');
  }
  // Read the short-lived pre-standardization location as well, so reports for
  // packets created before the canonical capabilities path remain complete.
  await addRoot(path.join(packetDir,'fallback_worker_capability'),'capability');
  const capabilities=path.join(packetDir,'capabilities');
  let capabilityRoles=[];try{capabilityRoles=await readdir(capabilities,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')return {items,observed:false};}
  for(const entry of capabilityRoles)if(entry.isDirectory()&&['worker','reviewer','senior','elevated_reviewer','fallback_worker'].includes(entry.name))await addRoot(path.join(capabilities,entry.name),'capability');
  if(!roots.length)return {items,observed:false};
  const loaded=[];
  for(const descriptor of roots){
    const chain=await regularJson(path.join(descriptor.root,'.receipts-chain.json'),descriptor.root===packetDir?{}:{root:packetDir});
    if(!chain||!Array.isArray(chain.entries))return {items:[],observed:false};
    let verification;try{verification=await verifyReceiptChain(descriptor.root);}catch{return {items:[],observed:false};}
    if(!verification?.ok)return {items:[],observed:false};
    for(const entry of chain.entries){
      if(typeof entry?.path!=='string'||entry.path.includes('\\'))return {items:[],observed:false};
      const receipt=await regularJson(path.join(descriptor.root,...entry.path.split('/')),{root:packetDir});
      if(receipt?.receipt_type!=='EXECUTION')return {items:[],observed:false};
      if(receipt.task_id!==identity.task_id||receipt.contract_sha256!==identity.contract_sha256)return {items:[],observed:false};
      loaded.push({receipt,descriptor});
    }
  }
  const controlled=state?.schema_version==='qq.bridge.controlled-state.v1'||state?.policy==='CONTROLLED_DELEGATION_V1'||state?.policy==='CONTROLLED_DELEGATION_V2';
  if(controlled){
    const workerRuns=new Set(loaded.filter(({receipt,descriptor})=>descriptor.type==='worker'&&['WORK','REPAIR','SENIOR'].includes(receipt.kind)&&receipt.run_id===path.basename(descriptor.root)).map(({receipt})=>receipt.run_id));
    for(const {receipt,descriptor} of loaded){
      const lineageOk=descriptor.type==='worker'?workerRuns.has(receipt.run_id):
        descriptor.type==='reviewer'?['REVIEW','ELEVATED_REVIEW'].includes(receipt.kind)&&workerRuns.has(receipt.run_id):
        descriptor.type==='capability'?receipt.kind==='PROBE'&&(receipt.run_id===null||workerRuns.has(receipt.run_id)):false;
      if(!lineageOk)return {items:[],observed:false};
    }
  }else{
    const currentRun=state?.run_id;
    if(typeof currentRun!=='string'||!currentRun||loaded.some(({receipt,descriptor})=>!['legacy','worker'].includes(descriptor.type)||receipt.run_id!==currentRun))return {items:[],observed:false};
  }
  for(const {receipt} of loaded)if(typeof receipt.receipt_id==='string'&&!seen.has(receipt.receipt_id)){seen.add(receipt.receipt_id);items.push(receipt);}
  return {items,observed:true};
}

function gateSummary(evidence){return (Array.isArray(evidence?.gates)?evidence.gates:[]).map(g=>({id:scalar(g.id),status:g.code===0&&!g.timed_out&&!g.interrupted?'PASS':'NOT_PASS',code:g.code??null,timed_out:g.timed_out??null,interrupted:g.interrupted??null}));}

export async function buildReport(packetDir,{audience='owner'}={}){
  if(!['owner','lead'].includes(audience))throw Error('report audience must be owner or lead');
  packetDir=path.resolve(packetDir);
  const state=await regularJson(path.join(packetDir,'state.json'));
  if(!state)throw Error('readable state.json required in packet directory');
  const taskPath=taskPathFor(state,packetDir),task=taskPath?await regularJson(taskPath,{root:path.dirname(packetDir)}):null;
  const identityConflict=!!task&&(
    (state.task_id!==undefined&&state.task_id!==task.task_id)||
    (state.revision!==undefined&&state.revision!==task.revision)||
    (state.contract_sha256!==undefined&&state.contract_sha256!==task.contract_sha256)||
    (state.head!==undefined&&task.candidate_head!==undefined&&state.head!==task.candidate_head));
  const identity={task_id:state.task_id??task?.task_id,revision:state.revision??task?.revision,head:state.head??task?.candidate_head,contract_sha256:state.contract_sha256??task?.contract_sha256};
  const rawEvidence=await regularJson(path.join(packetDir,'evidence.json')),evidence=strictlyBound(rawEvidence,identity)&&typeof rawEvidence.status==='string'&&Array.isArray(rawEvidence.gates)?rawEvidence:null;
  const rawReview=await regularJson(path.join(packetDir,'review.json')),review=strictlyBound(rawReview,identity)&&typeof rawReview.verdict==='string'&&Array.isArray(rawReview.material_findings)?rawReview:null;
  const productCandidates=[await regularJson(path.join(packetDir,'product_check.json')),await regularJson(path.join(packetDir,'ui_evidence.json')),task?.ui_evidence];
  const validProduct=value=>strictlyBound(value,identity)&&value.status==='PASS'&&value.criteria_passed===true&&Array.isArray(value.checks)&&value.checks.length>0&&
    value.checks.every(check=>check?.passed===true&&typeof check.action==='string'&&check.action.trim()&&typeof check.observed==='string'&&check.observed.trim());
  const product=productCandidates.find(validProduct)??null;
  const reviewValid=!!review&&review.verdict==='PASS'&&review.independent===true&&review.material_findings.length===0;
  const preliminaryBlockers=blockersFor(state,evidence,review,audience);
  if(identityConflict)preliminaryBlockers.push(audience==='owner'?'Lead cần đối soát định danh task và checkpoint.':'Task and checkpoint identity conflict; Lead reconciliation is required.');
  if(['READY_FOR_OWNER','DONE'].includes(state.status)&&!evidence)preliminaryBlockers.push(audience==='owner'?'Chưa có bằng chứng kiểm tra hợp lệ cho bản hiện tại.':'Current bound gate evidence is unavailable.');
  if(['READY_FOR_OWNER','DONE'].includes(state.status)&&!review)preliminaryBlockers.push(audience==='owner'?'Chưa có review hợp lệ cho bản hiện tại.':'Current bound review is unavailable.');
  if(review&&!reviewValid)preliminaryBlockers.push(audience==='owner'?'Review hiện tại chưa đủ điều kiện độc lập và PASS.':'Current review is not an independent PASS with zero findings.');
  const candidateUrl=scalar(task?.product_checks?.local_url??product?.target_url??product?.local_url??product?.url);
  const localUrl=typeof candidateUrl==='string'&&/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(candidateUrl)&&!preliminaryBlockers.length?candidateUrl:null;
  const localActions=localUrl&&product&&Array.isArray(product.checks)?product.checks.filter(x=>x?.passed===true).map(x=>scalar(x.action)).filter(Boolean):[];
  const blockers=[...new Set(preliminaryBlockers)];
  const effectiveState=identityConflict?{...state,reconciliation_required:true}:state;
  const base={schema_version:'qq.workflow.report.v1',audience,derived_only:true,readiness_certified:false,source_reference:packetDir,
    goal:scalar(task?.goal??state.goal??null),observed_status:scalar(state.status),observed_phase:scalar(state.phase),blockers,next_step:nextStep(effectiveState,!!localActions.length,audience,blockers.length>0),
    next_actor:nextActor(effectiveState,!!localActions.length,blockers.length>0),local_product_url:localUrl,local_product_actions:localActions,truncation:{applied:false,omitted_items:0,source_reference:packetDir},report_bytes:null};
  if(audience==='lead'){
    const receiptData=await receiptInvocations(packetDir,state,identity);
    const lastConfirmed=review?{phase:'reviewer',head:identity.head,status:review.verdict}:
      evidence?{phase:'gates',head:identity.head,status:evidence.status}:null;
    let budget;
    if(state.budget){
      const b=state.budget;
      const isV2=b.schema_version==='qq.workflow.budget.v2'||b.policy==='CONTROLLED_DELEGATION_V2'||state.policy==='CONTROLLED_DELEGATION_V2';
      if(isV2){
        const sc=b.senior_count??b.escalation_count??0,su=b.senior_used??b.escalation_used??false;
        budget={schema_version:b.schema_version??'qq.workflow.budget.v2',policy:b.policy??'CONTROLLED_DELEGATION_V2',origin:b.origin??null,active_worker:b.active_worker??null,fallback_occurred:!!b.fallback_occurred,fallback_reason:b.fallback_reason??null,initial_count:b.initial_count??null,repair_count:b.repair_count??null,senior_count:sc,senior_used:su,escalation_count:sc,escalation_used:su,pending_reconcile:b.pending_reconcile??null,
          remaining:{initial:b.initial_count==null?null:Math.max(0,1-b.initial_count),repair:b.repair_count==null?null:Math.max(0,4-b.repair_count),senior:Math.max(0,2-sc),escalation:Math.max(0,2-sc)}};
      }else{
        budget={origin:b.origin??null,initial_count:b.initial_count??null,repair_count:b.repair_count??null,escalation_count:b.escalation_count??null,escalation_used:b.escalation_used??null,pending_reconcile:b.pending_reconcile??null,
          remaining:{initial:b.initial_count==null?null:Math.max(0,1-b.initial_count),repair:b.repair_count==null?null:Math.max(0,(b.origin==='ASTRA_INITIAL'?1:2)-b.repair_count),escalation:b.escalation_count==null?null:Math.max(0,(b.origin==='ASTRA_INITIAL'?0:1)-b.escalation_count)}};
      }
    }else{
      budget={repair_rounds:state.repair_rounds??null,senior_passes:state.senior_passes??null,remaining:'unavailable'};
    }
    Object.assign(base,{task:{id:task?.task_id??state.task_id??null,revision:task?.revision??state.revision??null,head:state.head??task?.candidate_head??null,contract_sha256:state.contract_sha256??task?.contract_sha256??null},
      checkpoint:{phase:state.phase??null,last_confirmed:lastConfirmed,reconciliation_required:!!state.reconciliation_required||identityConflict||!!state.budget?.pending_reconcile,in_flight:!!state.in_flight},
      evidence:{observed:!!evidence,status:evidence?.status??'unavailable'},gates:gateSummary(evidence),review:{observed:!!review,verdict:review?.verdict??'unavailable',findings:(review?.material_findings??[]).map(x=>scalar(x)),independent:review?.independent??null},budget,
      evidence_refs:[...(evidence?['evidence.json']:[]),...(review?['review.json']:[]),...(product?[(product===task?.ui_evidence?'task.json#ui_evidence':productCandidates[0]===product?'product_check.json':'ui_evidence.json')]:[])],
      invocations:aggregateInvocations(receiptData.items,receiptData.observed)});
  }
  return clean(base);
}

function markdown(report){
  const owner=report.audience==='owner';
  const lines=[owner?'# Báo cáo công việc cho Owner':'# Workflow report (lead)','',owner?`- Tình trạng: ${ownerStatus(report.observed_status,report.local_product_actions.length>0)}`:`- Observed status: ${report.observed_status??'unavailable'}`,owner?`- Mục tiêu: ${report.goal??'Chưa có trong hồ sơ'}`:`- Goal: ${report.goal??'unavailable'}`,...(owner?[`- Người chuẩn bị báo cáo: Sol/Lead, bằng công cụ V10`,`- Người thực hiện bước tiếp theo: ${report.next_actor}`]:[]),owner?'- Đây là bản tóm tắt tiến độ. Việc nghiệm thu vẫn dựa trên các kiểm tra và xác nhận bắt buộc của V10.':'- Derived only: yes; readiness certified: no','',owner?'## Trở ngại':'## Blockers','',...(report.blockers.length?report.blockers.map(x=>`- ${x}`):[owner?'- Trong phần tóm tắt chưa ghi nhận trở ngại. Đây chưa phải kết luận nghiệm thu.':'- None recorded in the inspected fields; this is not readiness certification.']),'',owner?'## Bước tiếp theo':'## Next step','',report.next_step];
  if(report.local_product_actions.length)lines.push('',owner?'## Thao tác thử local đã liên kết':'## Bound local product actions','',...(report.local_product_url?[`- URL: ${report.local_product_url}`]:[]),...report.local_product_actions.map(x=>`- ${x}`));
  if(report.audience==='lead')lines.push('','## Lead observations','',`\`\`\`json\n${JSON.stringify({task:report.task,checkpoint:report.checkpoint,evidence:report.evidence,gates:report.gates,review:report.review,budget:report.budget,evidence_refs:report.evidence_refs,invocations:report.invocations,report_bytes:report.report_bytes},null,2)}\n\`\`\``);
  lines.push('',owner?'Tham chiếu packet đầy đủ:':'Full packet reference:',report.source_reference,'',owner?`Đã rút gọn: ${report.truncation.applied?'có':'không'}; mục lược bỏ: ${report.truncation.omitted_items}`:`Truncated: ${report.truncation.applied?'yes':'no'}; omitted items: ${report.truncation.omitted_items}`);
  return lines.join('\n')+'\n';
}

function byteLength(value){return Buffer.byteLength(value,'utf8');}
function clipUtf8(value,maxBytes){let out='';for(const char of String(value)){if(byteLength(out+char)>maxBytes)break;out+=char;}return out;}

export function formatReport(input,{format='md',maxBytes=DEFAULT_MAX_BYTES}={}){
  if(!['json','md'].includes(format))throw Error('report format must be json or md');
  if(!Number.isInteger(maxBytes)||maxBytes<512)throw Error('report maxBytes must be an integer of at least 512');
  let report=structuredClone(input),render=()=>format==='json'?JSON.stringify(report,null,2)+'\n':markdown(report);
  const settle=()=>{for(let i=0;i<8;i++){const size=byteLength(render());if(report.report_bytes===size)break;report.report_bytes=size;}return render();};
  if(typeof report.goal==='string'&&byteLength(report.goal)>512){report.goal=clipUtf8(report.goal,512)+' [truncated]';report.truncation.applied=true;report.truncation.omitted_items++;}
  report.blockers=(report.blockers??[]).map(value=>{if(byteLength(value)<=768)return value;report.truncation.applied=true;report.truncation.omitted_items++;return clipUtf8(value,768)+' [truncated; inspect full packet]';});
  let output=settle();if(byteLength(output)<=maxBytes)return output;
  const originalItems=(report.blockers?.length??0)+(report.gates?.length??0)+(report.review?.findings?.length??0);
  report.truncation={applied:true,omitted_items:0,source_reference:report.source_reference};
  if(report.audience==='lead'){delete report.checkpoint?.last_confirmed;if(report.review)delete report.review.independent;}
  output=settle();
  for(const target of [report.gates,report.review?.findings,report.local_product_actions])while(Array.isArray(target)&&target.length&&byteLength(output)>maxBytes){target.pop();report.truncation.omitted_items++;output=settle();}
  if(byteLength(output)>maxBytes){
    while(report.blockers.length>1&&byteLength(output)>maxBytes){report.blockers.pop();report.truncation.omitted_items++;output=settle();}
  }
  output=settle();if(byteLength(output)<=maxBytes)return output;
  const fallback={schema_version:'qq.workflow.report.v1',audience:report.audience,derived_only:true,readiness_certified:false,source_reference:report.source_reference,observed_status:report.observed_status,
    blockers:['Report exceeded the output limit; inspect the full packet for every blocker.'],next_step:'Inspect the full packet before any action.',local_product_url:null,local_product_actions:[],report_bytes:null,truncation:{applied:true,omitted_items:Math.max(1,originalItems),source_reference:report.source_reference}};
  report=fallback;output=settle();
  if(byteLength(output)>maxBytes)throw Error('report metadata exceeds output byte limit');
  return output;
}

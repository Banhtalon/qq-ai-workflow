import path from "node:path";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {readJson,writeJson,freeze,verify,route,readiness,assertContract,cleanHead,git,executionRoute} from "./lib/workflow.mjs";
import {validateConfig,loadReviewSource,configHash} from './lib/bridge.mjs';
import {redactText} from "./lib/redact.mjs";
const [command,...args]=process.argv.slice(2);
const toolkitRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
async function initControlledTask(taskId){
  if(!/^TASK-[A-Z0-9_-]+$/i.test(taskId??""))throw new Error("init requires task id like TASK-123");
  const root=git(process.cwd(),"rev-parse","--show-toplevel").trim();
  const baseSha=cleanHead(root);
  const template=JSON.parse(await readFile(path.join(toolkitRoot,".ai-workflow","templates","task.json"),"utf8"));
  const task={...template,task_id:taskId,base_sha:baseSha,candidate_head:null,contract_sha256:null};
  const dir=path.join(root,".workflow-local"),target=path.join(dir,taskId+".json");
  const rel=path.relative(root,target);
  try{git(root,"check-ignore","--no-index","--",rel);}catch{throw new Error(".workflow-local must be gitignored before init");}
  await mkdir(dir,{recursive:true});
  try{await writeFile(target,JSON.stringify(task,null,2)+"\n",{flag:"wx"});}
  catch(error){if(error.code==="EEXIST")throw new Error(`task already exists: .workflow-local/${taskId}.json`);throw error;}
  return {status:"INITIALIZED",task_id:taskId,task_path:`.workflow-local/${taskId}.json`,base_sha:baseSha,policy:task.execution.policy};
}
try{
  let result;
  if(command==="init"&&args.length===1)result=await initControlledTask(args[0]);
  else if(command==="freeze"&&args.length===1)result=await freeze(args[0]);
  else if(command==="route"&&args.length>=2){
    const flags=args.slice(2);
    if(flags.some(f=>!["--needs-repair","--quota-exhausted"].includes(f)))throw new Error("unknown route flag");
    result=route(await readJson(args[0]),await readJson(args[1]),{needsRepair:flags.includes("--needs-repair"),quotaAvailable:!flags.includes("--quota-exhausted")});
  }
  else if(command==="verify"&&args.length===3){
    const [task,cwd,out]=args;
    const root=git(cwd,"rev-parse","--show-toplevel").trim();
    const rel=path.relative(root,path.resolve(out));
    if(!rel.startsWith(".."+path.sep)&&rel!==".."&&!path.isAbsolute(rel)){
      try{git(root,"check-ignore","--no-index","--",rel);}catch{throw new Error("Evidence output must be outside the repo or gitignored");}
    }
    result=await verify(task,cwd);await writeJson(out,result);
    if(result.status!=="PASS")process.exitCode=1;
  }else if(command==="status"&&(args.length===4||args.length===5)){
    const t=await readJson(args[0]);await assertContract(args[0],t);cleanHead(args[3],t.candidate_head);
    const optional=async p=>{try{return await readJson(p);}catch(e){if(e.code==="ENOENT")return null;throw e;}};
    const config=args[4]?validateConfig(await readJson(args[4])):null;
    const review=await optional(args[2]),sourceSnapshot=await loadReviewSource(path.dirname(path.resolve(args[2])),review);
    result={...readiness(t,await optional(args[1]),review,{reviewerBinding:config?.[executionRoute(t).reviewer],sourceSnapshot,sourceConfigHash:config?configHash(config):null}),task_id:t.task_id,head:t.candidate_head,
      goal:t.goal,local_url:t.ui_evidence?.head===t.candidate_head&&t.ui_evidence?.contract_sha256===t.contract_sha256?t.ui_evidence.url:null};
    if(!["DONE","READY_FOR_OWNER"].includes(result.status))process.exitCode=1;
  }else{
    console.log("init <TASK-ID> | freeze <task> | legacy: route <task> <profile> | verify <task> <repo> <evidence> | status <task> <evidence> <review> <repo> [bridge-config]");
    if(command!=="help")process.exitCode=64;
  }
  if(result)console.log(redactText(JSON.stringify(result,null,2)));
}catch(e){console.error(redactText("BLOCKED: "+e.message));process.exitCode=1;}

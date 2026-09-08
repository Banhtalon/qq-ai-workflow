import {mkdtemp,writeFile,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {git,writeJson,readJson,freeze} from "../scripts/lib/workflow.mjs";
export async function fixture(gates){
 const dir=await mkdtemp(path.join(os.tmpdir(),"qq-v10-")),repo=path.join(dir,"repo");
 git(dir,"init","-b","main",repo);git(repo,"config","user.name","Fixture");git(repo,"config","user.email","fixture@example.invalid");
 await writeFile(path.join(repo,"feature.txt"),"base\n");git(repo,"add",".");git(repo,"commit","-m","base");
 const base=git(repo,"rev-parse","HEAD").trim();
 const task={schema_version:"qq.workflow.task.v10",task_id:"TASK-TEST",revision:1,base_sha:base,goal:"fixture feature",
 acceptance_criteria:["Feature text is present"],gates:[{id:"test",argv:[process.execPath,"-e","process.exit(0)"],timeout_seconds:2}],
 user_visible:true,risk:"LOW",complexity:"SIMPLE",candidate_head:null,contract_sha256:null,
 implementer_sessions:["writer-1"],repair_rounds:0,senior_passes:0,owner_acceptance:null};
 if(gates)task.gates=gates;
 const taskPath=path.join(dir,"task.json");await writeJson(taskPath,task);
 await freeze(taskPath);
 await writeFile(path.join(repo,"feature.txt"),"feature\n");git(repo,"add",".");git(repo,"commit","-m","feature");
 const head=git(repo,"rev-parse","HEAD").trim();
 const t=await readJson(taskPath);t.candidate_head=head;await writeJson(taskPath,t);
 return {dir,repo,taskPath,task:t,cleanup:()=>rm(dir,{recursive:true,force:true})};
}
export const review=t=>({schema_version:"qq.workflow.review.v10",task_id:t.task_id,revision:t.revision,
 head:t.candidate_head,contract_sha256:t.contract_sha256,reviewer_session:"reviewer-1",independent:true,
 verdict:"PASS",material_findings:[],risk_checks_completed:true,summary:"Synthetic fixture; no AI review"});
export const profile={schema_version:"qq.workflow.profile.v10",routing_mode:"ASSISTED",billing:"SUBSCRIPTION_ONLY",
 max_repairs:2,max_senior_passes:1,max_writers:1,bridge_installed:false,
 bindings:{fast:{provider:"google",model:"test-fast",verified:true},
 senior:{provider:"openai",model:"test-senior",verified:true},review:{provider:"openai",model:"test-review",verified:true}}};

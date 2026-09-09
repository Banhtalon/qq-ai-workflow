import path from 'node:path';
import {readJson} from './lib/workflow.mjs';
import {inspect,runBridge,activate} from './lib/bridge.mjs';
import {redactText} from './lib/redact.mjs';

const [command,...args]=process.argv.slice(2);
const controller=new AbortController();
process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
try {
  let result;
  if(command==='doctor') {
    const [config,cwd,dir,...flags]=args;
    result=await inspect(path.resolve(cwd),await readJson(config),path.resolve(dir),flags.includes('--probe'),controller.signal);
  } else if(['pilot','run','resume'].includes(command)) {
    const [config,task,cwd,dir]=args;
    result=await runBridge({config:await readJson(config),taskPath:task,cwd,packetDir:dir,pilot:command==='pilot'||(command==='resume'&&args.includes('--pilot')),resume:command==='resume',signal:controller.signal});
  } else if(command==='activate')result=await activate(await readJson(args[0]),path.resolve(args[1]),path.resolve(args[2]));
  else if(command==='status')result=await readJson(path.join(args[0],'state.json'));
  else throw Error('Usage: bridge.mjs doctor <config> <repo> <packets> [--probe] | pilot/run/resume <config> <task> <repo> <packets> [--pilot] | activate <config> <pilot-packets> <target-packets> | status <packets>');
  // Detailed redacted execution records stay local. Owner sees a short status.
  console.log(JSON.stringify({status:result.status,head:result.head,repair_rounds:result.repair_rounds,senior_passes:result.senior_passes,reconciliation_required:result.reconciliation_required},null,2));
  process.exitCode=['ACCEPTED','PROBED','READY_FOR_OWNER','DONE'].includes(result.status)?0:1;
} catch(error){console.error(redactText(error.message));process.exitCode=1;}

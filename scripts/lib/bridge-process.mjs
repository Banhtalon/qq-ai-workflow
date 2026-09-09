import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import {argvForPlatform, redactText, looksLikeSecretArgument} from './redact.mjs';

// Never inherit API credentials or provider-routing overrides into subscription CLIs.
export function subscriptionEnv(source=process.env) {
  return Object.fromEntries(Object.entries(source).filter(([k]) =>
    !/(SECRET|TOKEN|PASSWORD|PASSWD|COOKIE|JWT|PRIVATE_KEY|API_KEY|ACCESS_KEY)/i.test(k) &&
    !/^(OPENAI_|AZURE_|GOOGLE_|GCLOUD_|CLOUDSDK_|GEMINI_|CODEX_API|CODEX_HOME)/i.test(k)));
}

// Raw bounded output exists only in memory for protocol parsing. Callers persist
// selected fields after redaction, never CLI transcripts or auth-store contents.
export async function execute(argv,{cwd,env=subscriptionEnv(),input='',timeoutSeconds=300,maxBytes=4*1024*1024,signal}={}) {
  if (!Number.isFinite(timeoutSeconds)||timeoutSeconds<=0||timeoutSeconds>3600) throw Error('invalid process timeout');
  if (!Array.isArray(argv)||!argv.length||argv.some(x=>typeof x!=='string'||!x||looksLikeSecretArgument(x))) throw Error('unsafe argv');
  const args=argvForPlatform(argv);
  return new Promise(resolve=>{
    const started_at=new Date().toISOString();
    const child=spawn(args[0],args.slice(1),{cwd,env,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
    const dec=[new StringDecoder('utf8'),new StringDecoder('utf8')];
    const output=['','']; let bytes=0,reason=null,done=false,killed=false;
    const stop=why=>{
      reason??=why;
      if(killed||!child.pid)return; killed=true;
      if(process.platform==='win32') {
        const kill=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{shell:false,windowsHide:true,stdio:'ignore'});
        kill.on('error',()=>child.kill('SIGKILL'));
      } else {try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}
    };
    const finish=code=>{
      if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      resolve({code:code??127,reason,started_at,finished_at:new Date().toISOString(),stdout:output[0]+dec[0].end(),stderr:output[1]+dec[1].end()});
    };
    const abort=()=>stop('INTERRUPTED');
    const timer=setTimeout(()=>stop('TIMEOUT'),timeoutSeconds*1000);
    for(const [i,stream] of [child.stdout,child.stderr].entries())stream.on('data',chunk=>{
      bytes+=chunk.length;
      if(bytes>maxBytes){output[0]='';output[1]='';stop('OUTPUT_LIMIT');return;}
      if(!reason)output[i]+=dec[i].write(chunk);
    });
    child.on('error',()=>{reason??='SPAWN_ERROR';finish(127);});
    child.on('close',finish);
    child.stdin.on('error',()=>{});child.stdin.end(input);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
}

export function failureStatus(result) {
  if(result.reason==='SPAWN_ERROR')return 'WAITING_CAPABILITY';
  if(result.reason)return 'BLOCKED_TECHNICAL';
  // Only inspect failed process output: discussion of quota in a successful
  // review is not evidence that the provider exhausted its quota.
  if(result.code!==0) {
    const s=result.stdout+'\n'+result.stderr;
    if(/quota|rate.?limit|usage limit|resource.exhausted|\b429\b/i.test(s))return 'WAITING_QUOTA';
    if(/auth|log.?in|sign.?in|credential|\b401\b|\b403\b/i.test(s))return 'WAITING_CAPABILITY';
    return 'BLOCKED_TECHNICAL';
  }
  return null;
}
export const safe=value=>JSON.parse(redactText(JSON.stringify(value)));

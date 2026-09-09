import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
export function secretEnvironmentValues(env = process.env) {
  const namePattern = /(SECRET|TOKEN|PASSWORD|PASSWD|COOKIE|JWT|PRIVATE_KEY|API_KEY|ACCESS_KEY)/i;
  return Object.entries(env)
    .filter(([name, value]) => namePattern.test(name) && typeof value === "string" && value.length >= 8)
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length);
}

export function looksLikeSecretArgument(value) {
  const patterns = [
    /(?:^|[=:])(ghp_|github_pat_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}/i,
    /(?:password|passwd|secret|token|cookie|api[_-]?key|private[_-]?key)\s*[=:]\s*\S{4,}/i,
    /Bearer\s+\S+/i,
    /^[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}$/,
  ];
  return patterns.some((pattern) => pattern.test(value));
}

export function redactText(input, env = process.env) {
  let output = String(input);
  for (const value of secretEnvironmentValues(env)) {
    output = output.split(value).join("[REDACTED_ENV_SECRET]");
  }
  const replacements = [
    [/\b(?:set-cookie|cookie)\s*[:=][^\r\n]*/gi, "[REDACTED_COOKIE_HEADER]"],
    [/\b(?:proxy-authorization|authorization)\s*:[^\r\n]*/gi, "[REDACTED_AUTHORIZATION_HEADER]"],
    [/("[^"]*(?:password|passwd|secret|token|cookie|api[_-]?key|private[_-]?key)[^"]*"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"'],
    [/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]"],
    [/(?:ghp_|github_pat_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}/gi, "[REDACTED_TOKEN]"],
    [/\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_JWT]"],
    [/(https?:\/\/)([^\s:@/]+):([^\s@/]+)@/gi, "$1[REDACTED_CREDENTIALS]@"],
    [/\b(password|passwd|secret|token|cookie|api[_-]?key|private[_-]?key)\s*([=:])\s*([^\s,;]+)/gi, "$1$2[REDACTED]"],
  ];
  for (const [pattern, replacement] of replacements) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

export function argvForPlatform(argv,{platform=process.platform,execPath=process.execPath,exists=existsSync}={}) {
  if (platform !== "win32") return argv;
  const p=path.win32;
  if (["npm", "npx"].includes(argv[0])) {
    const cli = p.join(p.dirname(execPath), "node_modules", "npm", "bin", `${argv[0]}-cli.js`);
    if (exists(cli)) return [execPath, cli, ...argv.slice(1)];
    throw new Error(`Windows ${argv[0]} batch shim is not executed directly; use a Node installation with ${argv[0]}-cli.js or an explicit executable`);
  }
  if (["pnpm", "yarn"].includes(argv[0]) || /\.(?:cmd|bat)$/i.test(argv[0])) {
    throw new Error("Windows .cmd/.bat shims are not executed by the verifier; use an explicit .exe or node <cli.js> gate");
  }
  return argv;
}

// Buffer one bounded line only. Oversized lines are discarded in full, rather
// than emitting a prefix that could contain part of a split secret.
export function boundedOutput(env = process.env, limit = 32768) {
  const decoder = new StringDecoder("utf8");
  const suppress = secretEnvironmentValues(env).some(value => /[\r\n]/.test(value) || value.length > limit);
  let line = "";
  let output = "";
  let dropping = false;
  const append = (value) => { output = (output + value).slice(-limit); };
  return {
    push(chunk) {
      if (suppress) return;
      for (const character of decoder.write(chunk)) {
        if (character === "\n") {
          append(dropping ? "[REDACTED_OVERSIZED_LINE]\n" : redactText(line, env) + "\n");
          line = "";
          dropping = false;
        } else if (!dropping) {
          line += character;
          if (line.length > limit) { line = ""; dropping = true; }
        }
      }
    },
    finish() {
      if (suppress) return "[REDACTED_UNSAFE_SECRET_ENVIRONMENT]";
      line += decoder.end();
      append(dropping ? "[REDACTED_OVERSIZED_LINE]" : redactText(line, env));
      line = "";
      dropping = false;
      return output;
    },
  };
}

export async function runRedacted(argv, {cwd, timeoutSeconds = 300, env = process.env, signal} = {}) {
  if(signal?.aborted)return {code:130,timed_out:false,interrupted:true,stdout:'',stderr:'Interrupted before spawn',redaction_applied:true};
  if (!Array.isArray(argv) || !argv.length || argv.some(x => typeof x !== "string" || !x))
    throw new Error("invalid argv");
  if (argv.some(looksLikeSecretArgument))
    return {code:78,timed_out:false,stdout:"",stderr:"Secret-like argument rejected",redaction_applied:true};
  let args;
  try { args=argvForPlatform(argv); }
  catch (error) { return {code:78,timed_out:false,stdout:"",stderr:redactText(error.message,env),redaction_applied:true}; }
  return new Promise(resolve => {
    const child=spawn(args[0],args.slice(1),{cwd,env,shell:false,windowsHide:true,detached:process.platform!=="win32"});
    const out=boundedOutput(env), err=boundedOutput(env);
    let timed=false, interrupted=false, settled=false;
    const finish=code=>{
      if(settled)return; settled=true; clearTimeout(timer);signal?.removeEventListener('abort',abort);
      resolve({code:interrupted?130:timed?124:(code??1),timed_out:timed,interrupted,stdout:out.finish(),stderr:err.finish(),redaction_applied:true});
    };
    const kill=()=>{
      if(!child.pid)return;
      if(process.platform==="win32"){
        const killer=spawn("taskkill",["/pid",String(child.pid),"/T","/F"],{windowsHide:true,shell:false,stdio:"ignore"});
        killer.on("error",()=>child.kill("SIGKILL"));
      } else { try {process.kill(-child.pid,"SIGKILL");} catch {child.kill("SIGKILL");} }
    };
    const abort=()=>{interrupted=true;kill();};
    const timer=setTimeout(()=>{timed=true;kill();},timeoutSeconds*1000);
    child.stdout.on("data",c=>out.push(c)); child.stderr.on("data",c=>err.push(c));
    child.on("error",e=>{err.push(Buffer.from(e.message));finish(127);});
    child.on("close",finish);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
}

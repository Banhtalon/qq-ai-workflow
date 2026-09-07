import { cleanHead, git, reserveAttempt, updateControl } from "./lib/control.mjs";
const [controlPath, controlDigest, destination, branch] = process.argv.slice(2);
try {
  const reserved = await reserveAttempt(controlPath, controlDigest, process.cwd(), destination, branch);
  git(process.cwd(), "worktree", "add", "-b", branch, destination, reserved.control.base_sha);
  cleanHead(destination, reserved.control.base_sha);
  const started = await updateControl(controlPath, reserved.digest, process.cwd(), control => {
    control.state = "IMPLEMENTING";
    control.attempts.at(-1).clean_baseline_proven = true;
    return control;
  });
  console.log(JSON.stringify({ state: started.control.state, controller_digest: started.digest,
    attempt_number: started.control.attempt_number, base_sha: started.control.base_sha }));
} catch {
  console.error("BLOCKED: attempt reservation or creation failed; inspect Controller store before any retry");
  process.exitCode = 2;
}

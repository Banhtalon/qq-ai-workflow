import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const task = option("--task");
const attempt = Number(option("--attempt"));
const base = option("--base");
const destination = option("--destination");
const branch = option("--branch");
if (!task || !Number.isInteger(attempt) || attempt < 1 || attempt > 4 || !/^[0-9a-f]{40}$/i.test(base ?? "") || !destination || !branch) {
  console.error("Usage: --task TASK-ID --attempt 1..4 --base <40-char-sha> --destination <new-path> --branch <new-branch>");
  process.exit(64);
}

const target = path.resolve(destination);
try {
  await access(target);
  console.error("BLOCKED: destination already exists; clean-slate attempt requires a new path");
  process.exit(73);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

await exec("git", ["cat-file", "-e", `${base}^{commit}`], { windowsHide: true });
await exec("git", ["worktree", "add", "-b", branch, target, base], { windowsHide: true });
const head = (await exec("git", ["rev-parse", "HEAD"], { cwd: target, windowsHide: true })).stdout.trim();
const status = (await exec("git", ["status", "--porcelain"], { cwd: target, windowsHide: true })).stdout.trim();
if (head !== base || status !== "") {
  console.error("BLOCKED: created worktree did not prove an exact clean baseline");
  process.exit(2);
}
console.log(JSON.stringify({
  schema_version: "qq.workflow.attempt-start.v9",
  task_id: task,
  attempt_number: attempt,
  base_sha: base,
  branch,
  worktree: target,
  clean_baseline_proven: true,
}, null, 2));

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { git, digest } from "./control.mjs";
import { sha256File, writeJson } from "./workflow.mjs";

export async function fixture(rules, files = { "notes.md": "safe" }, complexity = "S") {
  const root = await mkdtemp(path.join(os.tmpdir(), "qq-v9-fixture-"));
  const cwd = path.join(root, "candidate");
  await mkdir(cwd);
  git(cwd, "init");
  git(cwd, "config", "user.name", "Workflow Test");
  git(cwd, "config", "user.email", "workflow@example.invalid");
  git(cwd, "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "baseline");
  const base = git(cwd, "rev-parse", "HEAD").trim();
  for (const [name, value] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(cwd, name)), { recursive: true });
    await writeFile(path.join(cwd, name), value);
  }
  git(cwd, "add", ".");
  git(cwd, "-c", "commit.gpgsign=false", "commit", "-m", "candidate");
  const head = git(cwd, "rev-parse", "HEAD").trim();
  const manifestPath = path.join(root, "manifest.json");
  const lockPath = path.join(root, "manifest.lock.json");
  const controlPath = path.join(root, "controller.json");
  const manifest = { schema_version: "qq.workflow.verification-manifest.v9",
    task_id: "TASK-FIXTURE", scope_revision: 1, base_sha: base, evidence_tier: "LOCAL_HERMETIC",
    acceptance_criteria: [{ id: "AC1", text: "Hermetic gate runs" }],
    gates: [{ id: "pass", argv: [process.execPath, "-e", "process.stdout.write('pilot-pass')"],
      timeout_seconds: 10, required: true }] };
  await writeJson(manifestPath, manifest);
  const manifestHash = await sha256File(manifestPath);
  await writeJson(lockPath, { schema_version: "qq.workflow.verification-lock.v9",
    task_id: manifest.task_id, scope_revision: 1, base_sha: base, manifest_sha256: manifestHash });
  const control = { schema_version: "qq.workflow.controller.v9", task_id: manifest.task_id,
    scope_revision: 1, base_sha: base, manifest_sha256: manifestHash, rules,
    effective_risk: "GREEN", complexity, state: "VERIFYING", candidate_head: head,
    attempt_number: 1, attempts: [{ number: 1, base_sha: base, destination: cwd,
      branch: "fixture", clean_baseline_proven: true }] };
  await writeJson(controlPath, control);
  return { root, cwd, base, head, manifestPath, lockPath, manifest, controlPath, control,
    controlDigest: await sha256File(controlPath) };
}

export async function saveControl(f) {
  await writeJson(f.controlPath, f.control);
  f.controlDigest = await sha256File(f.controlPath);
  return f;
}
export { digest };

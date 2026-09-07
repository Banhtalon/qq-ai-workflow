import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";

export function digest(bytes) {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

export function git(cwd, ...args) {
  return execFileSync("git", ["-c", "safe.directory=" + path.resolve(cwd), ...args], {
    cwd, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function cleanHead(cwd, expected) {
  if (!/^[a-f0-9]{40}$/.test(expected ?? "")) throw new Error("expected candidate head required");
  const head = git(cwd, "rev-parse", "HEAD").trim();
  if (head !== expected) throw new Error("candidate HEAD mismatch");
  if (git(cwd, "status", "--porcelain=v1", "--untracked-files=all").trim()) {
    throw new Error("candidate checkout is dirty");
  }
  return head;
}

export async function readControl(file, expectedDigest, cwd) {
  if (!file || !/^sha256:[a-f0-9]{64}$/.test(expectedDigest ?? "")) {
    throw new Error("external Controller file and pinned digest required");
  }
  const actual = await realpath(file);
  const root = await realpath(git(cwd, "rev-parse", "--show-toplevel").trim());
  const relative = path.relative(root, actual);
  if (!relative || (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))) {
    throw new Error("Controller store must be outside candidate repository");
  }
  const raw = await readFile(actual);
  if (digest(raw) !== expectedDigest) throw new Error("stale or tampered Controller digest");
  const control = JSON.parse(raw);
  if (control.schema_version !== "qq.workflow.controller.v9" ||
      !/^TASK-[A-Z0-9_-]+$/i.test(control.task_id ?? "") ||
      !Number.isInteger(control.scope_revision) || control.scope_revision < 1 ||
      !/^[a-f0-9]{40}$/.test(control.base_sha ?? "") ||
      !/^sha256:[a-f0-9]{64}$/.test(control.manifest_sha256 ?? "") ||
      !["GREEN", "YELLOW", "RED"].includes(control.effective_risk) ||
      !["S", "M", "L", "XL"].includes(control.complexity) ||
      !Array.isArray(control.attempts) || control.attempts.length > 4 ||
      control.attempt_number !== control.attempts.length || !control.rules?.rules) {
    throw new Error("invalid Controller state");
  }
  const destinations = new Set();
  const branches = new Set();
  control.attempts.forEach((attempt, index) => {
    if (attempt.number !== index + 1 || attempt.base_sha !== control.base_sha ||
        !attempt.destination || !attempt.branch ||
        destinations.has(attempt.destination.toLowerCase()) || branches.has(attempt.branch)) {
      throw new Error("invalid attempt history");
    }
    destinations.add(attempt.destination.toLowerCase());
    branches.add(attempt.branch);
  });
  return { control, file: actual, digest: expectedDigest };
}

// Only the manually invoked Controller runs this transaction. Keep this store
// and trusted executable inaccessible to candidate processes in real deployments.
export async function updateControl(file, expectedDigest, cwd, mutate) {
  const lock = await open(file + ".busy", "wx");
  try {
    const loaded = await readControl(file, expectedDigest, cwd);
    const next = await mutate(structuredClone(loaded.control));
    next.previous_digest = expectedDigest;
    next.updated_at = new Date().toISOString();
    const bytes = JSON.stringify(next, null, 2) + "\n";
    const pending = file + ".pending";
    const handle = await open(pending, "wx");
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await rename(pending, file);
    return { control: next, digest: digest(bytes) };
  } finally {
    await lock.close();
    await unlink(file + ".busy");
  }
}

export async function reserveAttempt(file, pinnedDigest, cwd, destination, branch) {
  if (!destination || !branch) throw new Error("destination and branch required");
  const target = path.resolve(destination);
  // mkdir is exclusive: no existing/failed filesystem can be reused.
  return updateControl(file, pinnedDigest, cwd, async (control) => {
    if (!["READY", "NEEDS_FIX"].includes(control.state) ||
        (control.state === "NEEDS_FIX" && !control.failure_summary)) {
      throw new Error("attempt requires Controller READY or documented NEEDS_FIX");
    }
    if (control.attempt_number >= 4) throw new Error("attempt ladder exhausted");
    if (!branch || branch.startsWith("-") || control.attempts.some(a =>
      a.destination.toLowerCase() === target.toLowerCase() || a.branch === branch)) {
      throw new Error("attempt destination and branch must be unique");
    }
    git(cwd, "check-ref-format", "--branch", branch);
    git(cwd, "cat-file", "-e", control.base_sha + "^{commit}");
    await mkdir(target);
    control.attempt_number += 1;
    control.attempts.push({ number: control.attempt_number, base_sha: control.base_sha,
      destination: target, branch, reserved_at: new Date().toISOString() });
    control.state = "RESERVED";
    control.candidate_head = null;
    return control;
  });
}

export async function assertActiveAttempt(control, cwd) {
  const attempt = control.attempts.at(-1);
  if (!attempt?.clean_baseline_proven ||
      await realpath(attempt.destination) !== await realpath(cwd)) {
    throw new Error("candidate must be the active proven clean-slate attempt");
  }
}

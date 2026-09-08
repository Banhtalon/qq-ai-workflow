import { access } from "node:fs/promises";
import path from "node:path";
import { defaultLockPath, readJson, sha256File, validateManifest, writeJson } from "./lib/workflow.mjs";

const manifestArg = process.argv[2];
if (!manifestArg) {
  console.error("Usage: node scripts/freeze-manifest.mjs <verification-manifest.json> [lock.json]");
  process.exit(64);
}

const manifestPath = path.resolve(manifestArg);
const lockPath = path.resolve(process.argv[3] ?? defaultLockPath(manifestPath));
try {
  await access(lockPath);
  console.error("BLOCKED: lock already exists; create a new scope revision instead of overwriting it");
  process.exit(73);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const manifest = validateManifest(await readJson(manifestPath));
const lock = {
  schema_version: "qq.workflow.verification-lock.v9",
  task_id: manifest.task_id,
  scope_revision: manifest.scope_revision,
  base_sha: manifest.base_sha,
  manifest_sha256: await sha256File(manifestPath),
  frozen_at: new Date().toISOString(),
};
await writeJson(lockPath, lock);
console.log(JSON.stringify({ status: "FROZEN", lock: lockPath, manifest_sha256: lock.manifest_sha256 }, null, 2));

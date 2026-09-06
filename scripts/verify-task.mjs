import path from "node:path";
import { defaultLockPath, verifyManifest, writeJson } from "./lib/workflow.mjs";

const manifestArg = process.argv[2];
if (!manifestArg) {
  console.error("Usage: node scripts/verify-task.mjs <verification-manifest.json> [lock.json] [evidence.json]");
  process.exit(64);
}

const manifestPath = path.resolve(manifestArg);
const lockPath = path.resolve(process.argv[3] ?? defaultLockPath(manifestPath));
const evidencePath = process.argv[4] ? path.resolve(process.argv[4]) : null;

try {
  const evidence = await verifyManifest(manifestPath, { lockPath, cwd: process.cwd() });
  if (evidencePath) await writeJson(evidencePath, evidence);
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.verdict !== "PASS") process.exitCode = 1;
} catch (error) {
  console.error(`BLOCKED: ${error.message}`);
  process.exitCode = 2;
}

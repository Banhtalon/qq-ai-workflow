import path from "node:path";
import { verifyManifest, writeJson } from "./lib/workflow.mjs";
const [manifest, controlPath, controlDigest, evidencePath] = process.argv.slice(2);
try {
  const evidence = await verifyManifest(path.resolve(manifest), {
    cwd: process.cwd(), controlPath, controlDigest,
  });
  if (evidencePath) await writeJson(path.resolve(evidencePath), evidence);
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.verdict !== "PASS") process.exitCode = 1;
} catch {
  console.error("BLOCKED: invalid Controller authority, candidate identity, manifest or gate execution");
  process.exitCode = 2;
}

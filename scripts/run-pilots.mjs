import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyRisk,
  readJson,
  sha256File,
  verifyManifest,
  writeJson,
} from "./lib/workflow.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rules = await readJson(path.join(repositoryRoot, ".ai-workflow", "RISK_RULES.json"));
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "qq-workflow-v9-pilot-"));
const baseIndex = process.argv.indexOf("--base-sha");
const baseSha = baseIndex >= 0 ? process.argv[baseIndex + 1] : "0".repeat(40);
if (!/^[0-9a-f]{40}$/i.test(baseSha ?? "")) {
  throw new Error("--base-sha must be a full 40-character commit SHA");
}

async function freezeForPilot(manifestPath) {
  const manifest = await readJson(manifestPath);
  const lockPath = manifestPath.replace(/\.json$/, ".lock.json");
  await writeJson(lockPath, {
    schema_version: "qq.workflow.verification-lock.v9",
    task_id: manifest.task_id,
    scope_revision: manifest.scope_revision,
    base_sha: manifest.base_sha,
    manifest_sha256: await sha256File(manifestPath),
    frozen_at: new Date().toISOString(),
  });
  return lockPath;
}

async function verificationPilot(taskId) {
  const directory = path.join(temporaryRoot, taskId.toLowerCase());
  await mkdir(directory, { recursive: true });
  const manifestPath = path.join(directory, "verification-manifest.json");
  await writeJson(manifestPath, {
    schema_version: "qq.workflow.verification-manifest.v9",
    task_id: taskId,
    scope_revision: 1,
    base_sha: baseSha,
    evidence_tier: "LOCAL_HERMETIC",
    acceptance_criteria: [{ id: "AC1", text: "Hermetic deterministic gate passes" }],
    gates: [{
      id: "node-runtime",
      argv: [process.execPath, "-e", "process.stdout.write('pilot-pass')"],
      timeout_seconds: 30,
      required: true,
    }],
  });
  const lockPath = await freezeForPilot(manifestPath);
  return await verifyManifest(manifestPath, { lockPath, cwd: repositoryRoot });
}

const greenDecision = classifyRisk({
  paths: ["docs/owner-copy.md"],
  declared: "GREEN",
  priorEffective: "GREEN",
  complexity: "XL",
  rules,
});
const greenEvidence = await verificationPilot("TASK-PILOT-GREEN");

const yellowDecision = classifyRisk({
  paths: [".github/workflows/ci.yml"],
  declared: "GREEN",
  priorEffective: "GREEN",
  complexity: "S",
  rules,
});
const yellowEvidence = await verificationPilot("TASK-PILOT-YELLOW");

const escalationDecision = classifyRisk({
  paths: ["supabase/migrations/999_drop_students.sql"],
  diffText: "DROP TABLE students;",
  declared: "GREEN",
  priorEffective: "YELLOW",
  complexity: "S",
  rules,
});

const checks = {
  green: greenDecision.effective === "GREEN" && greenDecision.complexity === "XL" && greenEvidence.verdict === "PASS",
  yellow: yellowDecision.effective === "YELLOW" && yellowDecision.complexity === "S" && yellowDecision.required_roles.includes("QUALIFIED_REVIEWER") && yellowEvidence.verdict === "PASS",
  escalation: escalationDecision.effective === "RED" && escalationDecision.action === "STOP_AND_ESCALATE" && escalationDecision.required_roles.includes("TECHNICAL_OPERATOR"),
};
const pass = Object.values(checks).every(Boolean);
const summary = {
  schema_version: "qq.workflow.pilot-summary.v9",
  canonical_version: "9.0.0",
  generated_at: new Date().toISOString(),
  evidence_tier: "LOCAL_HERMETIC",
  base_sha: baseSha,
  scenarios: {
    green: { decision: greenDecision, verification: greenEvidence, pass: checks.green },
    yellow: { decision: yellowDecision, verification: yellowEvidence, pass: checks.yellow },
    escalation: {
      decision: escalationDecision,
      verification_invoked: false,
      reason: "RED tripwire stopped execution before gates",
      pass: checks.escalation,
    },
  },
  routing_automation_present: false,
  adoption_decision: pass ? "READY_FOR_NEW_PROJECTS" : "NOT_READY",
  verdict: pass ? "PASS" : "FAIL",
};

const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0
  ? path.resolve(process.argv[outputIndex + 1])
  : path.join(repositoryRoot, "evidence", "pilot-summary.json");
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: outputPath, verdict: summary.verdict, adoption_decision: summary.adoption_decision }, null, 2));
if (!pass) process.exitCode = 1;

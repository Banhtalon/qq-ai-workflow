import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fixture, saveControl } from "./lib/pilot-fixture.mjs";
import { inspectCandidate, readJson, verifyManifest, writeJson } from "./lib/workflow.mjs";

const rules = await readJson(path.resolve(".ai-workflow/RISK_RULES.json"));
const scenarios = {};
for (const [name, files, complexity] of [
  ["green", { "notes.md": "Owner copy" }, "XL"],
  ["yellow", { "scripts/check.mjs": "console.log('check')" }, "S"],
  ["escalation", { "auth/login.ts": "permission boundary" }, "S"],
]) {
  const f = await fixture(rules, files, complexity);
  const decision = inspectCandidate(f.cwd, f.control);
  f.control.effective_risk = decision.effective;
  await saveControl(f);
  if (name === "escalation") {
    let stopped = false;
    try { await verifyManifest(f.manifestPath, f); } catch (error) {
      stopped = /Technical Operator disposition/.test(error.message);
    }
    scenarios[name] = { decision, verification_invoked: true, gates_executed: false,
      pass: stopped && decision.effective === "RED" };
  } else {
    const verification = await verifyManifest(f.manifestPath, f);
    scenarios[name] = { decision, verification, pass: verification.verdict === "PASS" &&
      decision.effective === (name === "green" ? "GREEN" : "YELLOW") &&
      decision.complexity === complexity };
  }
}
const pass = Object.values(scenarios).every(s => s.pass);
const summary = { schema_version: "qq.workflow.pilot-summary.v9", generated_at: new Date().toISOString(),
  evidence_tier: "LOCAL_HERMETIC", scenarios, routing_automation_present: false,
  adoption_decision: "PENDING_INDEPENDENT_REVIEW", verdict: pass ? "PASS" : "FAIL" };
const index = process.argv.indexOf("--output");
const output = path.resolve(index >= 0 ? process.argv[index+1] : ".ai-workflow/runtime/pilot-summary.json");
await mkdir(path.dirname(output), { recursive: true });
await writeJson(output, summary);
console.log(JSON.stringify({ output, verdict: summary.verdict, adoption_decision: summary.adoption_decision }));
if (!pass) process.exitCode = 1;

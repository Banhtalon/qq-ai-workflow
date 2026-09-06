import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyRisk,
  matchesGlob,
  maxRisk,
  redactText,
  runRedacted,
  sha256File,
  verifyManifest,
  writeJson,
} from "../scripts/lib/workflow.mjs";
import rules from "../.ai-workflow/RISK_RULES.json" with { type: "json" };
import projectProfile from "../.ai-workflow/PROJECT_PROFILE.example.json" with { type: "json" };

test("risk is monotonic within a revision", () => {
  assert.equal(maxRisk("YELLOW", "GREEN"), "YELLOW");
  assert.equal(maxRisk("RED", "GREEN", "YELLOW"), "RED");
});

test("template keeps model routing manual", () => {
  assert.equal(projectProfile.routing_mode, "MANUAL");
  assert.deepEqual(projectProfile.attempt_ladder.at(-1), "technical-operator-stop");
});

test("risk and complexity remain independent", () => {
  const decision = classifyRisk({ paths: ["docs/readme.md"], complexity: "XL", rules });
  assert.equal(decision.effective, "GREEN");
  assert.equal(decision.complexity, "XL");
});

test("declared yellow risk requires qualified review even without a path match", () => {
  const decision = classifyRisk({ paths: ["docs/readme.md"], declared: "YELLOW", complexity: "S", rules });
  assert.equal(decision.effective, "YELLOW");
  assert.ok(decision.required_roles.includes("QUALIFIED_REVIEWER"));
});

test("path tripwires are cross-platform", () => {
  assert.equal(matchesGlob("supabase\\migrations\\001.sql", "**/migrations/**"), true);
  assert.equal(matchesGlob(".github/workflows/ci.yml", ".github/workflows/**"), true);
});

test("yellow path requires qualified review", () => {
  const decision = classifyRisk({ paths: ["src/app.ts"], complexity: "S", rules });
  assert.equal(decision.effective, "YELLOW");
  assert.ok(decision.required_roles.includes("QUALIFIED_REVIEWER"));
});

test("destructive migration stops and escalates", () => {
  const decision = classifyRisk({
    paths: ["supabase/migrations/001.sql"],
    diffText: "DROP TABLE students;",
    priorEffective: "YELLOW",
    complexity: "S",
    rules,
  });
  assert.equal(decision.effective, "RED");
  assert.equal(decision.action, "STOP_AND_ESCALATE");
  assert.ok(decision.required_roles.includes("TECHNICAL_OPERATOR"));
});

test("redaction masks environment and token formats", () => {
  const fakeToken = ["gh", "p_", "abcdefghijklmnop"].join("");
  const output = redactText(`token=abc123456789 Bearer ${fakeToken}`, { API_TOKEN: "abc123456789" });
  assert.equal(output.includes("abc123456789"), false);
  assert.equal(output.includes(fakeToken), false);
  assert.match(output, /REDACTED/);
});

test("redaction boundary rejects secret-like command arguments", async () => {
  const fakeToken = ["gh", "p_", "abcdefghijklmnop"].join("");
  const result = await runRedacted([process.execPath, "-e", `token=${fakeToken}`]);
  assert.equal(result.code, 78);
  assert.equal(result.stderr.includes(fakeToken), false);
});

test("frozen manifest verifies, then tampering fails closed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "qq-v9-test-"));
  const manifestPath = path.join(directory, "manifest.json");
  const lockPath = path.join(directory, "manifest.lock.json");
  const manifest = {
    schema_version: "qq.workflow.verification-manifest.v9",
    task_id: "TASK-TEST",
    scope_revision: 1,
    base_sha: "0".repeat(40),
    evidence_tier: "LOCAL_HERMETIC",
    acceptance_criteria: [{ id: "AC1", text: "gate passes" }],
    gates: [{ id: "pass", argv: [process.execPath, "-e", "process.exit(0)"], timeout_seconds: 10, required: true }],
  };
  await writeJson(manifestPath, manifest);
  await writeJson(lockPath, {
    schema_version: "qq.workflow.verification-lock.v9",
    task_id: manifest.task_id,
    scope_revision: manifest.scope_revision,
    base_sha: manifest.base_sha,
    manifest_sha256: await sha256File(manifestPath),
    frozen_at: new Date().toISOString(),
  });
  assert.equal((await verifyManifest(manifestPath, { lockPath })).verdict, "PASS");
  manifest.acceptance_criteria[0].text = "weakened after implementation";
  await writeJson(manifestPath, manifest);
  await assert.rejects(() => verifyManifest(manifestPath, { lockPath }), /changed after freeze/);
});

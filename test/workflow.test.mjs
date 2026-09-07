import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

import path from "node:path";
import test from "node:test";
import { Buffer } from "node:buffer";
import {
  boundedOutput,
  inspectCandidate,
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

test("risk is monotonic within a revision", () => {
  assert.equal(maxRisk("YELLOW", "GREEN"), "YELLOW");
  assert.equal(maxRisk("RED", "GREEN", "YELLOW"), "RED");
});

test("risk and complexity remain independent", () => {
  const decision = classifyRisk({ paths: ["docs/readme.md"], complexity: "XL", rules });
  assert.equal(decision.effective, "GREEN");
  assert.equal(decision.complexity, "XL");
});

test("declared yellow risk requires qualified review without a path match", () => {
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


import { fixture, saveControl } from "../scripts/lib/pilot-fixture.mjs";
import { git, readControl, reserveAttempt } from "../scripts/lib/control.mjs";
test("external anchor rejects coordinated manifest and lock replacement", async () => {
  const f = await fixture(rules);
  assert.equal((await verifyManifest(f.manifestPath, f)).verdict, "PASS");
  f.manifest.acceptance_criteria[0].text = "weakened";
  await writeJson(f.manifestPath, f.manifest);
  await writeJson(f.lockPath, { schema_version: "qq.workflow.verification-lock.v9",
    task_id: f.manifest.task_id, scope_revision: 1, base_sha: f.base,
    manifest_sha256: await sha256File(f.manifestPath) });
  await assert.rejects(verifyManifest(f.manifestPath, f), /external manifest anchor/);
});
test("missing, tampered, stale and in-repository Controller anchors fail closed", async () => {
  const f = await fixture(rules);
  await assert.rejects(verifyManifest(f.manifestPath, { cwd: f.cwd }), /Controller/);
  await assert.rejects(readControl(f.controlPath, "sha256:" + "0".repeat(64), f.cwd), /digest/);
  const internal = path.join(f.cwd, "control.json");
  await writeJson(internal, f.control);
  await assert.rejects(readControl(internal, await sha256File(internal), f.cwd), /outside/);
});
test("verification binds head and rejects both tracked and untracked changes", async () => {
  const f = await fixture(rules);
  const evidence = await verifyManifest(f.manifestPath, f);
  assert.equal(evidence.candidate_head, f.head);
  f.control.candidate_head = f.base;
  await saveControl(f);
  await assert.rejects(verifyManifest(f.manifestPath, f), /HEAD mismatch/);
  f.control.candidate_head = f.head;
  await saveControl(f);
  await writeFile(path.join(f.cwd, "notes.md"), "dirty");
  await assert.rejects(verifyManifest(f.manifestPath, f), /dirty/);
  git(f.cwd, "add", ".");
  await assert.rejects(verifyManifest(f.manifestPath, f), /dirty/);
});
test("risk derives full changes, preserves prior floor and sees root auth", async () => {
  const f = await fixture(rules, { "scripts/check.mjs": "safe", "package.json": "{}",
    "test/check.mjs": "safe", "auth/login.ts": "safe" });
  const risk = inspectCandidate(f.cwd, f.control);
  assert.deepEqual(risk.paths.sort(), ["auth/login.ts", "package.json", "scripts/check.mjs", "test/check.mjs"]);
  assert.equal(risk.effective, "RED");
  f.control.effective_risk = "RED";
  assert.equal(inspectCandidate(f.cwd, f.control).effective, "RED");
  await assert.rejects(verifyManifest(f.manifestPath, f), /risk must be updated/);
});
test("root and nested protected glob paths are equivalent", () => {
  for (const name of ["auth/login.ts", "nested/auth/login.ts", "middleware.ts", "nested/middleware.ts"]) {
    assert.equal(classifyRisk({ paths: [name], rules }).effective, "RED", name);
  }
});
test("reservation is durable, consumes one unique attempt and rejects stale replay", async () => {
  const f = await fixture(rules);
  f.control.state = "READY";
  f.control.attempt_number = 0;
  f.control.attempts = [];
  await saveControl(f);
  const target = path.join(f.root, "attempt");
  const reserved = await reserveAttempt(f.controlPath, f.controlDigest, f.cwd, target, "attempt-one");
  assert.equal(reserved.control.state, "RESERVED");
  assert.equal(reserved.control.attempt_number, 1);
  await assert.rejects(reserveAttempt(f.controlPath, f.controlDigest, f.cwd, target, "attempt-one"), /digest/);
  await assert.rejects(reserveAttempt(f.controlPath, reserved.digest, f.cwd, target, "attempt-two"), /READY/);
});
test("attempt exhaustion and malformed attempt history fail closed", async () => {
  const f = await fixture(rules);
  f.control.state = "NEEDS_FIX";
  f.control.failure_summary = "bounded failure";
  f.control.attempt_number = 4;
  f.control.attempts = Array.from({length:4}, (_,i) => ({number:i+1,base_sha:f.base,
    destination:path.join(f.root, "attempt-" + i),branch:"attempt-" + i}));
  await saveControl(f);
  await assert.rejects(reserveAttempt(f.controlPath, f.controlDigest, f.cwd, path.join(f.root,"fifth"),"fifth"), /exhausted/);
  f.control.attempts[1].number = 1;
  await saveControl(f);
  await assert.rejects(readControl(f.controlPath, f.controlDigest, f.cwd), /history/);
});
test("bounded redaction masks split secrets and discards oversized lines", () => {
  const secret = ["gh", "p_", "abcdefghijklmnop"].join("");
  const boundary = boundedOutput({});
  boundary.push(Buffer.from(secret.slice(0,5)));
  boundary.push(Buffer.from(secret.slice(5) + "\n"));
  assert.equal(boundary.finish().includes(secret), false);
  const huge = boundedOutput({});
  for(let i=0;i<100;i++) huge.push(Buffer.from("x".repeat(32768)));
  huge.push(Buffer.from("\nokay\n"));
  const output = huge.finish();
  assert.ok(output.length <= 32768);
  assert.match(output, /REDACTED_OVERSIZED_LINE/);
  assert.match(output, /okay/);
});

test("gate mutation invalidates evidence after execution", async () => {
  const f = await fixture(rules);
  f.manifest.gates[0].argv = [process.execPath, "-e",
    "require('node:fs').writeFileSync('unexpected.txt','changed')"];
  await writeJson(f.manifestPath, f.manifest);
  f.control.manifest_sha256 = await sha256File(f.manifestPath);
  await writeJson(f.lockPath, { schema_version: "qq.workflow.verification-lock.v9",
    task_id: f.manifest.task_id, scope_revision: 1, base_sha: f.base,
    manifest_sha256: f.control.manifest_sha256 });
  await saveControl(f);
  await assert.rejects(verifyManifest(f.manifestPath, f), /dirty/);
});

test("concurrent reservations cannot allocate the same next attempt", async () => {
  const f = await fixture(rules);
  f.control.state = "READY";
  f.control.attempt_number = 0;
  f.control.attempts = [];
  await saveControl(f);
  const results = await Promise.allSettled([
    reserveAttempt(f.controlPath, f.controlDigest, f.cwd, path.join(f.root,"one"),"one"),
    reserveAttempt(f.controlPath, f.controlDigest, f.cwd, path.join(f.root,"two"),"two"),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
});

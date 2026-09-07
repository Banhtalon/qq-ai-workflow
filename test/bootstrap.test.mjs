import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = relative => readFile(path.join(root, relative), "utf8");

test("v9.1 bootstrap keeps role selection explicit and routing manual", async () => {
  const bootstrap = await read(".ai-workflow/BOOTSTRAP.md");
  assert.match(bootstrap, /receive an explicit role/i);
  assert.match(bootstrap, /authoritative task/i);
  assert.match(bootstrap, /Routing mode: \*\*MANUAL\*\*/);
  assert.match(bootstrap, /BLOCKED_ROLE_MISMATCH/);
});

test("Controller and Implementer permissions stay isolated", async () => {
  const controller = await read(".ai-workflow/roles/CONTROLLER.md");
  const implementer = await read(".ai-workflow/roles/IMPLEMENTER.md");
  assert.match(controller, /do not:\n\n- implement or patch product code/i);
  assert.match(implementer, /must not:\n\n- reserve or increment attempts/i);
  assert.match(implementer, /frozen verification manifest\/lock/i);
  assert.match(implementer, /- merge the candidate/i);
  assert.match(implementer, /BLOCKED/);
});

test("project profile example binds multi-AI roles manually", async () => {
  const profile = JSON.parse(await read(".ai-workflow/PROJECT_PROFILE.example.json"));
  assert.equal(profile.canonical_version, "9.0.0");
  assert.equal(profile.template_release, "9.1.0");
  assert.equal(profile.routing_mode, "MANUAL");
  assert.equal(profile.manual_bindings.controller, "chatgpt-sol");
  assert.equal(profile.manual_bindings.default_implementer, "gemini-flash");
  assert.equal(profile.manual_bindings.qualified_reviewer, "terra-xhigh");
  assert.equal(profile.bootstrap.controller_prompt, ".ai-workflow/prompts/CONTROLLER_BOOTSTRAP.md");
  assert.equal(profile.bootstrap.implementer_prompt, ".ai-workflow/prompts/IMPLEMENTER_BOOTSTRAP.md");
});

test("handoff packets are bounded and keep completion authority with Controller", async () => {
  const handoff = await read(".ai-workflow/templates/IMPLEMENTER_HANDOFF.md");
  const result = await read(".ai-workflow/templates/IMPLEMENTER_RESULT.md");
  for (const field of ["task_id", "scope_revision", "attempt_number", "base_sha", "assigned_branch_or_worktree"]) {
    assert.ok(handoff.includes(field), field);
  }
  for (const field of ["candidate_sha", "Files changed", "Checks run", "New risk observations", "Recommendation"]) {
    assert.ok(result.includes(field), field);
  }
  assert.match(result, /does not declare `DONE`, `OWNER_READY`/i);
});

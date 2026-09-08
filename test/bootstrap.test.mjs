import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = async relative => (await readFile(path.join(root, relative), "utf8")).replaceAll("\r\n", "\n");

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

test("Controller execution-environment gaps route to Technical Operator instead of Owner debugging", async () => {
  const bootstrap = await read(".ai-workflow/BOOTSTRAP.md");
  const controller = await read(".ai-workflow/roles/CONTROLLER.md");
  const operator = await read(".ai-workflow/roles/TECHNICAL_OPERATOR.md");
  const controllerPrompt = await read(".ai-workflow/prompts/CONTROLLER_BOOTSTRAP.md");
  assert.match(bootstrap, /Controller tool limitation is not an Owner blocker/i);
  assert.match(controller, /TECHNICAL_OPERATOR_HANDOFF/);
  assert.match(controller, /do not ask the Owner to run commands/i);
  assert.match(controllerPrompt, /do not stop merely because of the\s+tool limitation/i);
  assert.match(operator, /prepare-attempt\.mjs/);
  assert.match(operator, /never reconstruct authority from repo-local state/i);
});

test("project profile example binds multi-AI roles manually", async () => {
  const profile = JSON.parse(await read(".ai-workflow/PROJECT_PROFILE.example.json"));
  assert.equal(profile.canonical_version, "9.0.0");
  assert.equal(profile.template_release, "9.1.2");
  assert.equal(profile.routing_mode, "MANUAL");
  assert.equal(profile.manual_bindings.controller, "chatgpt-sol");
  assert.equal(profile.manual_bindings.default_implementer, "gemini-flash");
  assert.equal(profile.manual_bindings.qualified_reviewer, "terra-xhigh");
  assert.equal(profile.controller_execution.environment_gap_route, "technical_operator");
  assert.equal(profile.bootstrap.controller_prompt, ".ai-workflow/prompts/CONTROLLER_BOOTSTRAP.md");
  assert.equal(profile.bootstrap.implementer_prompt, ".ai-workflow/prompts/IMPLEMENTER_BOOTSTRAP.md");
  assert.equal(profile.bootstrap.reviewer_prompt, ".ai-workflow/prompts/REVIEWER_BOOTSTRAP.md");
  assert.equal(profile.bootstrap.technical_operator_prompt, ".ai-workflow/prompts/TECHNICAL_OPERATOR_BOOTSTRAP.md");
  assert.equal(profile.bootstrap.technical_operator_handoff, ".ai-workflow/templates/TECHNICAL_OPERATOR_HANDOFF.md");
  assert.equal(profile.bootstrap.technical_operator_result, ".ai-workflow/templates/TECHNICAL_OPERATOR_RESULT.md");
  assert.equal(profile.bootstrap.qualified_review_handoff, ".ai-workflow/templates/QUALIFIED_REVIEW_HANDOFF.md");
  assert.equal(profile.bootstrap.qualified_review_result, ".ai-workflow/templates/QUALIFIED_REVIEW.md");
  assert.equal(profile.bootstrap.file_first_convention, ".ai-workflow/HANDOFF_FILES.md");
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

test("Technical Operator handoff/result preserve external Controller authority", async () => {
  const handoff = await read(".ai-workflow/templates/TECHNICAL_OPERATOR_HANDOFF.md");
  const result = await read(".ai-workflow/templates/TECHNICAL_OPERATOR_RESULT.md");
  for (const field of ["controller_snapshot_ref", "pinned_controller_digest", "approved_base_sha", "requested_operation"]) {
    assert.ok(handoff.includes(field), field);
  }
  assert.match(handoff, /never reconstruct/i);
  for (const field of ["starting_controller_digest", "resulting_controller_digest", "clean_baseline_proven", "Recommendation"]) {
    assert.ok(result.includes(field), field);
  }
  assert.match(result, /Controller must independently verify/i);
});

test("file-first convention preserves authority and gives every actor a named return file", async () => {
  const convention = await read(".ai-workflow/HANDOFF_FILES.md");
  const reviewerHandoff = await read(".ai-workflow/templates/QUALIFIED_REVIEW_HANDOFF.md");
  const review = await read(".ai-workflow/templates/QUALIFIED_REVIEW.md");
  const reviewerPrompt = await read(".ai-workflow/prompts/REVIEWER_BOOTSTRAP.md");
  for (const filename of [
    "TASK-<id>-technical-operator-handoff.md",
    "TASK-<id>-technical-operator-result.md",
    "TASK-<id>-implementer-handoff.md",
    "TASK-<id>-implementer-result.md",
    "TASK-<id>-qualified-review-handoff.md",
    "TASK-<id>-qualified-review.md",
  ]) assert.ok(convention.includes(filename), filename);
  assert.match(convention, /does not grant authority/i);
  assert.match(convention, /Issue.*concise authority/i);
  assert.match(reviewerHandoff, /candidate_sha/);
  assert.match(review, /RECOMMEND_PASS.*NEEDS_FIX.*BLOCKED/s);
  assert.match(reviewerPrompt, /fresh independent context/i);
});

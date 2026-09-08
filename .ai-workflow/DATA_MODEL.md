# Local packets
Templates define qq.workflow.task.v10, profile.v10 and review.v10.
Task contract: task_id, revision, base_sha, goal, acceptance_criteria, gates,
user_visible, risk, complexity. Each gate has unique id, argv, timeout_seconds.
Freeze writes <task.json>.lock.json exclusively; task.contract_sha256 copies its hash.
The lock also carries effective_risk_floor, initialized from contract risk and allowed
only to rise to ELEVATED. task.effective_risk is initialized at freeze and may never
be lower than that persisted floor within the same revision.
Lead records candidate_head, all implementer session IDs, repair counts and
owner_acceptance {head, contract_sha256, accepted, source}.
No shared-secret or credential field is permitted.

Verification: exact task_id/revision/base/head/contract_sha256, local scope, gates.
Each result contains argv, timeout_seconds, code, timed_out, redacted output.
Secret-like gate IDs or arguments block freeze/verification before packet writes or
gate execution. Verification emits no new evidence for these invalid inputs; keep
credentials in the account environment. Only declared gate fields enter evidence.
Evidence effective_risk must equal the task's persisted effective_risk.
Review: same task identity/head/hash, reviewer_session, independent, verdict,
material_findings (array), summary. Verdict is PASS, NEEDS_FIX or BLOCKED.
A failed or missing field cannot become READY_FOR_OWNER.
Local JSON and session IDs are operator-supplied; these are consistency checks.

Elevated-risk review additionally requires risk_checks_completed=true and describes the checks in summary.

Lead preserves effective_risk across attempts. The verifier persists observed escalation
in both task state and the monotonic lock floor; contract risk is the intake floor.
These local files are trusted, not tamper-resistant.

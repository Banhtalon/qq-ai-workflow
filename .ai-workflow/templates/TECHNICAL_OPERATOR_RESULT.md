# TECHNICAL_OPERATOR_RESULT

Return this packet to the Controller. Do not include secrets, tokens, cookies,
passwords, raw browser state, or student PII.

- task_id: `TASK-...`
- scope_revision: `...`
- requested_operation: `...`
- starting_controller_digest: `sha256:...`
- resulting_controller_digest: `sha256:... | unchanged | n/a`
- resulting_state: `...`
- attempt_number: `... | n/a`
- clean_baseline_proven: `true|false|n/a`
- branch_or_worktree: `... | n/a`

## Checks / commands executed

- `sanitized command or operation` -> `PASS|FAIL|BLOCKED`

## Authoritative evidence updated

- Issue/controller-store reference: `... | none`

## Unresolved blockers / recovery markers

- none | ...

## Scope / risk observations

- none | ...

## Recommendation

`READY_FOR_CONTROLLER` | `NEEDS_TECHNICAL_RECOVERY` | `BLOCKED`

The Technical Operator does not declare implementation completion, Owner-ready,
review approval, or merge readiness. The Controller must independently verify the
returned authority/state before issuing the next handoff.

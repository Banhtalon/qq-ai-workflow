# TECHNICAL_OPERATOR_HANDOFF

This packet is created by the Controller when the next valid technical/controller
transaction requires a trusted execution environment outside the current
Controller session. Do not include secrets, tokens, cookies, passwords, raw
browser state, or student PII.

Save the filled packet as `TASK-<id>-technical-operator-handoff.md` for
transfer, attaching the exact external Controller snapshot separately when it
is required by the authorized operation.

- task_id: `TASK-...`
- scope_revision: `...`
- controller_state: `READY|IMPLEMENTING|ESCALATED_TECHNICAL|...`
- requested_operation: `RESERVE_ATTEMPT|RECOVER_CONTROLLER_TRANSACTION|INSPECT_RISK|VERIFY_TASK|PROVIDER_OPERATION|OTHER_AUTHORIZED_TECHNICAL_ACTION`
- controller_snapshot_ref: `exact external file/reference; never reconstruct`
- pinned_controller_digest: `sha256:...`
- approved_base_sha: `...`
- frozen_manifest_digest: `sha256:...`
- trusted_tool_checkout: `...`
- target_repository: `owner/repo`

## Exact requested action

- ...

## Transaction parameters when applicable

- destination_worktree: `... | n/a`
- branch: `... | n/a`
- candidate_head: `... | n/a`
- evidence_output: `external path/ref | n/a`

## Explicitly out of scope

- product implementation or product-code patches;
- scope/risk/manifest changes not already authorized;
- normal GitHub branch creation as a substitute for a required Controller transaction;
- secret disclosure or copying sensitive state into chat/evidence;
- bypassing deterministic gates or recovery markers.

## Required preflight

- exact task/revision/base/digests match authoritative Issue;
- supplied Controller snapshot exists with exact bytes/reference;
- trusted tool checkout is valid;
- requested destination/branch is clean and unique when required;
- no unresolved `.busy` / `.pending` marker or stale transaction;
- no secret/PII exposure is required.

## Stop conditions

Return `BLOCKED` without guessing if any authority input is missing, stale,
ambiguous, mismatched, or if the action would exceed the authorized scope.

## Required return format

Return `TASK-<id>-technical-operator-result.md` following
`.ai-workflow/templates/TECHNICAL_OPERATOR_RESULT.md` exactly, then stop.

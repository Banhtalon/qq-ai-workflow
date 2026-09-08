# IMPLEMENTER_HANDOFF

This packet is created by the Controller only after a valid attempt is reserved.
Save the filled packet as `TASK-<id>-implementer-handoff.md` for transfer.
Do not include secrets, tokens, cookies, passwords, raw browser state, or student PII.

- task_id: `TASK-...`
- scope_revision: `...`
- attempt_number: `...`
- base_sha: `...`
- assigned_branch_or_worktree: `...`
- controller_state: `IMPLEMENTING`
- effective_risk: `GREEN|YELLOW|RED`
- complexity: `S|M|L|XL`

## Exact in-scope work

- ...

## Explicitly out of scope

- ...

## Acceptance criteria relevant to this attempt

- ...

## Focused / affected checks to run

- ...

## Stop conditions

- missing/invalid reservation or wrong branch/worktree;
- scope ambiguity or request to alter frozen verification criteria;
- newly observed auth/permission/secret/migration/production-write risk outside the authorized disposition;
- need to expose credentials, tokens, cookies, raw browser state, or PII;
- any requirement to bypass a deterministic gate or Owner-approved scope.

## Required return format

Return `TASK-<id>-implementer-result.md` following
`.ai-workflow/templates/IMPLEMENTER_RESULT.md` exactly, then stop.

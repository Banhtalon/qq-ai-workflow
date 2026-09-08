# QUALIFIED_REVIEW_HANDOFF

This file is created by the Controller when an independent qualified review is
required. Do not include secrets, tokens, cookies, passwords, raw browser
state, or PII.

- task_id: `TASK-...`
- scope_revision: `...`
- effective_risk: `YELLOW|RED`
- base_sha: `...`
- candidate_sha: `40-character SHA`
- branch_or_worktree: `...`
- frozen_manifest_digest: `sha256:...`
- controller_digest: `sha256:...`
- authoritative_issue_ref: `...`

## Review focus

- ...

## Required evidence to inspect

- ...

## Explicitly out of scope

- implementation or patching;
- scope, manifest, risk, state, or attempt changes;
- waiving deterministic gates;
- secrets, raw browser state, or PII.

## Required return format

Return a file following `.ai-workflow/templates/QUALIFIED_REVIEW.md` and stop.

# QUALIFIED_REVIEW

Return this file to the Controller. Do not include secrets, tokens, cookies,
passwords, raw browser state, or PII.

- task_id: `TASK-...`
- scope_revision: `...`
- reviewed_base_sha: `...`
- reviewed_candidate_sha: `40-character SHA`
- frozen_manifest_digest: `sha256:...`
- controller_digest: `sha256:...`
- reviewer_independence: `confirmed|blocked`

## Findings

- `P0|P1|P2|P3|none`: ...

## Evidence gaps

- none | ...

## Disposition

`RECOMMEND_PASS` | `NEEDS_FIX` | `BLOCKED`

This is an exact-head review recommendation, not a Controller state transition,
gate waiver, Owner acceptance, or merge authorization. A materially changed
candidate requires a fresh review when policy requires Qualified Review.

# Changelog
## 10.0.0-rc.2
Normalize v10 execution identity so workflow role, provider, CLI, requested model,
observed model, session and provider-reported usage remain distinct.
Document Antigravity CLI as the current Google worker interface and remove the
legacy Gemini CLI implication from v10 supporting guidance. Keep `GEMINI_FIRST_V1`
as the v10 policy identifier for schema compatibility; it is a policy name, not a
statement about which Google CLI is installed.
Clarify that model identity in Owner reporting must come from observed provider/CLI
metadata when available, not from configuration alone.

## 10.0.0-rc.1
Breaking workflow redesign for personal local projects, explicitly authorized by Owner.
Consolidate Lead operations and implementation; keep independent feature review.
Replace mandatory clean-slate repair/worktree and Issue digest transactions with
feature-branch repairs, bounded budgets, local packets and exact-head evidence.
Archive v9.1.2 unchanged; do not carry its PASS evidence forward.
Add local contract/evidence tooling and synthetic pilots.
Subscription model routing is specified; CLI bridge and Windows/account validation
remain the next stage. No downstream adoption or merge performed.

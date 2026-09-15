# Changelog
## 10.1.0-rc.1 — 2026-09-15
Add Controlled Delegation V2 for subscription-based local projects:
- Route Lead work through GPT-5.6 Sol Medium, with Gemini 3.8 Flash High as the
  primary worker and GPT-5.6 Luna Max as the standby worker.
- Add exact GPT-5.6 Terra Xhigh ordinary review and independent GPT-5.6 Sol Medium
  senior/elevated review bindings.
- Add sequential Gemini-to-Luna handoff, shared four-round repair accounting,
  failed-invocation history, durable checkpoints and conservative resume handling.
- Extend assignment/execution receipts and reports with requested-versus-observed
  model identity, session, provider usage, fallback state and tamper checks.
- Extend quota-drill and activation validation to bind V2 pilot state for the
  LOCAL_AUTO stage; the synthetic pilot remains local and does not call a real provider.
- Keep `CONTROLLED_DELEGATION_V1` as the `workflow.mjs init` and shipped-template
  default. `GEMINI_FIRST_V1` remains available for legacy task compatibility.
- Keep `gpt-6-astra` in the V1 senior/elevated binding; V2 uses GPT-5.6 Sol instead.

Validation for this release: `npm test`, `npm run workflow:check`, `npm run pilot`,
and the merged GitHub CI checks passed.

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

# New Project Adoption Standard

Status: `READY_AFTER_PILOT_PASS`

Use this repository as the default starting template only when `npm test` and
`npm run pilot` both pass on the exact template commit.

## Required initialization

1. Replace `PROJECT_PROFILE.example.json` with `PROJECT_PROFILE.json` and fill
   project-specific actor bindings and evidence tiers.
2. Keep `routing_mode` as `MANUAL`; the v9.1 bootstrap layer does not auto-route
   or auto-invoke models.
3. Extend `RISK_RULES.json` with the project's auth, data, deployment, privacy,
   production-write, and destructive-operation paths.
4. Define deterministic baseline gates; do not copy irrelevant gates.
5. Record the Owner-visible product scope and actions the Owner must never be
   asked to perform.
6. Confirm the Controller and Implementer bootstrap prompts point to the role
   files and shared authoritative task state.
7. Run a project-local GREEN, YELLOW, and RED/escalation tripwire check.
8. Run role-isolation tests: Controller must not implement product code;
   Implementer must not reserve attempts, change task authority, edit frozen
   verification to make work pass, or merge; Reviewer must remain independent.

## Existing project migration

Inventory all workflow instructions, prompts, CI gates, issue templates,
scheduled workers, and setup guides. For every conflicting artifact, choose one
of:

- replace with v9/v9.1 bootstrap;
- retain only as history and add an explicit `SUPERSEDED BY v9` notice;
- remove if dead and unreferenced.

Do not delete product requirements, evidence, or unrelated CI. Record the
inventory and disposition as migration evidence.

## Adoption acceptance

- canonical v9 artifacts remain the only workflow authority;
- v9.1 bootstrap files only reduce copy-paste and do not weaken v9 boundaries;
- Owner guidance is plain language and does not delegate technical review;
- manifest lock, risk monotonicity, clean-slate attempt, role isolation, and
  redaction tests pass;
- three project-local pilot scenarios pass;
- the migration does not claim product, hosted, live, or production acceptance;
- automated model routing remains absent.

# New Project Adoption Standard
- automated model routing remains absent.
- automated model routing remains absent.
Status: `READY_AFTER_PILOT_PASS`

Use this repository as the default starting template only when `npm test` and
`npm run pilot` both pass on the exact template commit.

## Required initialization

1. Replace `PROJECT_PROFILE.example.json` with `PROJECT_PROFILE.json` and fill
   project-specific actor bindings and evidence tiers.
2. Extend `RISK_RULES.json` with the project's auth, data, deployment, privacy,
   production-write, and destructive-operation paths.
3. Define deterministic baseline gates; do not copy irrelevant gates.
4. Record the Owner-visible product scope and actions the Owner must never be
   asked to perform.
5. Keep routing mode `MANUAL` until a separately approved automation phase.
6. Run a project-local GREEN, YELLOW, and RED/escalation tripwire check.

## Existing project migration

Inventory all workflow instructions, prompts, CI gates, issue templates,
scheduled workers, and setup guides. For every conflicting artifact, choose one
of:

- replace with v9;
- retain only as history and add an explicit `SUPERSEDED BY v9` notice;
- remove if dead and unreferenced.

Do not delete product requirements, evidence, or unrelated CI. Record the
inventory and disposition as migration evidence.

## Adoption acceptance

- canonical v9 artifacts are the only active workflow authority;
- Owner guidance is plain language and does not delegate technical review;
- manifest lock, risk monotonicity, clean-slate attempt, and redaction tests pass;
- three project-local pilot scenarios pass;
- the migration does not claim product, hosted, live, or production acceptance;
- automated model routing remains absent.

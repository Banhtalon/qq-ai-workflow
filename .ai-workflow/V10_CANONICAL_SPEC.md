# QQ AI Workflow v10 — canonical local contract
Version 10.0.0-rc.1. This revision intentionally replaces v9 for adopted v10 tasks.
Scope: one Owner, local personal projects, subscription access. Not a production
or adversarial agent isolation framework. CLI connection is a separate stage.

## Authority and scope
Explicit Owner intent > this spec > agreed task contract > project profile >
task/evidence > agent suggestions. Changes to product scope require Owner input.
Lead may choose implementation details and strengthen tests without Owner involvement.
Any contract change starts a new revision, records why, invalidates evidence/review;
never silently weaken gates. A task uses one workflow version throughout a revision.
Legacy v9 rules apply only to explicitly unconverted host tasks.

## Responsibilities
Owner: describe behavior, decide product tradeoffs, account-only actions,
functional acceptance, final merge approval. No code, logs, SQL or CI judgment.
LEAD: single contact; reads current files/state, plans briefly, classifies risk,
chooses implementer, operates tools, may code, collects evidence, coordinates repair.
IMPLEMENTER: one bounded feature; no self-approval, no scope/gate changes.
REVIEWER: fresh independent session, not involved in any implementation of the
feature; assess contract, diff, tests and risk against exact head and contract hash.
Different provider preferred; a fresh separate session on the same model is allowed
when competent. Identity is recorded, not authenticated by this local kit.

## Per-feature loop
1. Read host task state; protect uncommitted work. Create one feature branch/checkpoint.
2. Write a short contract: behavior, exclusions, base SHA, acceptance criteria, gates,
   user_visible and risk/complexity. Freeze before implementation.
3. Use one writer. Lead works or hands off via shared files and available tools.
4. Run relevant checks during development. No mandatory full suite for every tiny edit.
5. At feature completion, commit code, inspect actual diff, run agreed final gates.
6. Reviewer checks that head. Material issues go directly to implementer.
7. Rerun affected checks; refresh final evidence and review for the final head.
8. Present a local build with 3–5 ordinary user actions. Record Owner acceptance.
9. Completion requires evidence, independent PASS, and acceptance if user-visible.
   Merge/publish remains a separate explicitly authorized action.

## Routing and budgets
Risk LOW/ELEVATED is potential harm; complexity SIMPLE/COMPLEX is reasoning effort.
Auth, permissions, migrations, data destruction, privacy, credential handling or
deployment changes elevate risk even if one line. Lead inspects content and behavior;
path heuristics alone cannot certify safety. Risk cannot decrease within a revision.
Simple low-risk work: configured fast implementer, normally Gemini Flash.
Complex or elevated work: configured senior-capable agent; independent competent
reviewer. Model IDs/effort must be discovered and tested on the Owner's account.
Two repair rounds at the initial tier, then at most one senior implementation pass.
Any unresolved material failure after that => BLOCKED_TECHNICAL, preserved checkpoint.
A reviewer finding causes repair, not a debate loop. A new scope revision must not
be invented to reset the budget. Quota/auth failure pauses, never counts as success,
never triggers paid API fallback. Switching eligible providers preserves counters.
Reviewer runs have no recursive delegation. Default one concurrent writer.

## State and evidence
Local JSON packets are the working state; GitHub records meaningful milestones only.
Contract digest detects accidental edits; it is not a secure external authority store.
Verification records base/head/hash, actual argv, exit codes, timeouts and redacted
output. A process exit 0 alone is not product acceptance. Review and Owner acceptance
bind to the same head/hash. A later edit invalidates them.
Fresh-context review is organizational independence, not OS-level isolation.
The packet checker cannot prove a human/model identity, detect fabricated JSON,
or enforce all transitions. Lead must retain genuine execution/review records.

## Safety and operational boundaries
Keep credentials in official account stores; never copy them into task files.
Run gates only from a trusted local project. Tools are not a sandbox.
Local auth/database code may be implemented/tested with synthetic data and elevated
review. Existing live writes, migration execution, deletion and publishing restrictions
remain in force. Confirm exact target and existing authorization before external writes.
Owner approves intent/consequences, never technical waivers. If safe resolution is
unavailable, stop with a plain-language blocker and keep the working version.
No hosted, production, or live acceptance claim from local tests.

## Stage boundary
ASSISTED is the default. Lead can execute locally and use already available
independent sessions/tools; missing capability is WAITING_CAPABILITY.
LOCAL_AUTO is a future bridge contract. It requires installation, actual account/model
probes and a successful handoff/repair/quota pilot on Windows. Merely editing a config
field is not sufficient; no bridge runner ships in this stage.

# Policy
the Owner to make a technical judgment.
the Owner to make a technical judgment.
## Mandatory rules

- Work only from an explicit task revision and approved baseline.
- Freeze verification before implementation.
- Treat the lock hash, acceptance criteria, risk floor, and scope revision as
  protected controls.
- Reinspect risk from the actual diff.
- Never lower effective risk within the same revision.
- Keep risk and complexity independent.
- Start every attempt in a new clean worktree.
- Limit the attempt ladder to four; the fifth request is a Technical Operator
  escalation, not another agent retry.
- Use deterministic gates as completion authority.
- Require an independent qualified reviewer where risk rules say so.
- Redact subprocess output before display or persistence.
- Stop on missing, contradictory, unverifiable, or stale evidence.
- Distinguish local/hermetic, CI, hosted, live, and production evidence.
- Keep v9 model routing manual.

## Prohibited actions

- no secret in chat, task data, command arguments, logs, evidence, or commits;
- no silent scope expansion;
- no edit to a frozen verification manifest;
- no test/gate weakening to obtain PASS;
- no reuse of a failed attempt's dirty filesystem;
- no implementer self-review as the required independent review;
- no claim that model output is deterministic verification;
- no claim that local/synthetic evidence proves hosted/live acceptance;
- no automatic merge, production write, deployment, migration, or destructive
  data action unless a separate task explicitly authorizes it and its RED
  controls are satisfied.

## Fail-closed conditions

Route to `BLOCKED_OWNER`, `BLOCKED_EXTERNAL`, or `ESCALATED_TECHNICAL` when the
required authority, credentials, environment, reviewer, operator, exact target,
or evidence is unavailable. Do not guess, retry an ambiguous mutation, or ask
the Owner to make a technical judgment.

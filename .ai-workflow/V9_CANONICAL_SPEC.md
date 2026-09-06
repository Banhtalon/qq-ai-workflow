# QQ Evidence-Gated Workflow v9 — Canonical Specification

Status: **CANONICAL**
Version: **9.0.0**
Routing mode: **MANUAL**

## 1. Purpose

v9 lets a non-technical Owner state product intent, answer business questions,
and perform functional acceptance while engineering agents and operators own
implementation, verification, risk handling, review, and technical recovery.

## 2. Authority order

When artifacts conflict, authority is:

1. explicit Owner product decision and approved scope revision;
2. this canonical v9 specification;
3. frozen verification manifest for the current task revision;
4. project profile and risk rules;
5. task state and evidence;
6. agent recommendations.

The project profile declares the authoritative task-control store (for example,
a protected GitHub issue or a controller-owned file). Repository task JSON is
the portable schema and evidence snapshot. If it is not the declared control
store, it cannot override that store.

Machine evidence can invalidate an agent recommendation. An agent
recommendation cannot waive a required machine gate.

## 3. Owner contract

The Owner does only four things:

1. describes the desired product behavior in ordinary language;
2. answers material business questions;
3. tests the product when presented with an Owner-ready build;
4. performs account-only actions in the provider's official UI without sharing
   secrets with an agent.

Code review, CI repair, schema/security judgment, secrets handling, model
selection, and technical debugging are not Owner duties. Those are routed to a
Controller, qualified reviewer, or Technical Operator.

## 4. Two independent classification axes

`risk` is the possible harm if the change is wrong. It determines safeguards,
review, approval, and stop conditions.

`complexity` is the effort or reasoning difficulty. It informs manual staffing
and planning only.

A task may be GREEN/XL or RED/S. Neither field may be derived from the other.

Risk levels are ordered `GREEN < YELLOW < RED`. Effective risk is the maximum
of declared risk, prior effective risk in the same revision, and observed
tripwires. It cannot decrease within a revision.

## 5. Immutable verification

Before implementation, the Controller writes a verification manifest covering
acceptance criteria and required deterministic gates. `freeze-manifest.mjs`
stores a SHA-256 lock. The Controller records that digest in the authoritative
task-control store before implementation. Any byte change or digest mismatch
makes verification fail closed.

Changing criteria requires a new scope revision and explicit Owner approval.
Agents must never weaken tests, delete gates, or rewrite expected evidence to
make an implementation pass.

## 6. Clean-slate attempts

Every implementation attempt starts in a new Git worktree at the same approved
base SHA. The next attempt may read the prior failure summary and frozen
requirements, but it must not inherit the prior attempt's filesystem changes.

The default bounded ladder is:

1. default implementer, attempt 1;
2. default implementer, attempt 2 from clean baseline;
3. senior implementer/planner, attempt 3 from clean baseline;
4. final escalation implementer, attempt 4 from clean baseline;
5. stop and route to Technical Operator.

The Controller records each attempt. Routing remains a manual decision in v9.

## 7. Diff-time risk tripwire

Risk is classified at intake and inspected again from the actual diff before
review/verification. Auth, permissions, secrets, production writes, destructive
data operations, migrations, privacy/PII, deployment controls, and equivalent
project-specific paths can raise risk immediately.

A RED observation blocks implementation or continuation until the required
qualified reviewer/Technical Operator disposition exists. Missing or ambiguous
evidence also fails closed.

## 8. Secret boundary

Secrets are entered only in official provider secret stores by an authorized
human. They are never placed in prompts, task manifests, CLI arguments,
committed files, logs, or evidence.

All verification subprocess output passes through the redaction boundary. The
boundary masks secret-like environment values, bearer tokens, provider token
formats, JWTs, credential URLs, cookies, and secret assignments before output
is displayed or persisted. Ambiguous secret-like CLI arguments are rejected.

## 9. Review and completion

YELLOW and RED routing is defined by project risk rules. A qualified reviewer
must be independent of the implementation attempt and bind the review to the
exact revision/head. RED work may additionally require a Technical Operator.

`DONE` requires all of:

- correct authoritative state and unchanged scope revision;
- frozen manifest hash valid;
- effective-risk controls satisfied;
- required gates PASS on the exact candidate revision;
- required independent review PASS with no material unresolved finding;
- Owner functional acceptance when product behavior is user-visible;
- evidence stored without secrets.

Local/hermetic evidence must be labeled as such and never presented as
hosted/live/production acceptance.

## 10. Model routing boundary

v9 contains actor capabilities and a manual attempt ladder, but no scheduler,
background worker, automatic model selection, or automatic retry invocation.
Automation may be designed only after v9 pilot acceptance and separate Owner
approval.

## 11. Adoption gate

The template is ready for new projects only after the canonical tests and all
three hermetic pilots pass:

- GREEN: allowed with deterministic gates;
- YELLOW: allowed with extra review requirement while complexity stays
  independently classified;
- escalation: RED tripwire stops execution and routes to qualified humans.

Pilot PASS proves the workflow controls, not the host project's product or
production readiness.

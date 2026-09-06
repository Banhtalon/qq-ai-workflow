# Actor Registry
runtime router or a claim about current vendor model availability.
runtime router or a claim about current vendor model availability.
Actor names describe responsibilities. Project profiles may bind a person or
model manually; the workflow does not auto-route models.

## Owner

Owns product intent, material business decisions, scope-revision approval,
functional acceptance, and account-only actions in official provider UIs.

Does not review code, CI, schemas, security, or decide technical waivers.

## Controller

Owns authoritative state transitions, risk floor, attempt count, exact baseline
and head binding, evidence completeness, and stop/escalation decisions. Does not
silently implement or waive gates while acting as Controller.

## Planner / Architect

Clarifies requirements, records trade-offs, defines acceptance criteria, and
creates plans for complex or architecture-affecting work. Escalates business
choices to Owner and technical ambiguity to Technical Operator.

## Implementer

Implements one bounded attempt from a clean baseline. Produces tests and a
failure summary. Cannot change scope, risk floor, verification manifest, or
self-declare completion.

## Deterministic Verifier

Validates the manifest lock and runs the exact required gates through the
redaction boundary. Reports PASS/FAIL/BLOCKED; does not interpret business
intent or waive failures.

## Qualified Reviewer

Reviews from fresh context, independent of the implementation attempt, and
binds findings/verdict to the exact revision/head. Reviews spec compliance,
edge cases, regression, privacy, security, data integrity, and relevant domain
hazards. Returns `RECOMMEND_PASS`, `NEEDS_FIX`, or `BLOCKED`.

## Technical Operator

A technically qualified human or separately authorized operator who handles
credentials/configuration, infrastructure, recovery, migrations, destructive
operations, provider failures, and exhausted retry ladders. The role receives
sanitized diagnostics, never secrets in chat/evidence.

## Suggested manual capability bindings

Projects may record bindings such as Gemini Flash for default implementation,
Sol for planning/senior implementation, Astra for final escalation, and Terra
for qualified review. These are project labels supplied by the Owner, not a
runtime router or a claim about current vendor model availability.

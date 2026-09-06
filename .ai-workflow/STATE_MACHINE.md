# State Machine
revision remains immutable historical evidence.
revision remains immutable historical evidence.
```text
INTAKE
  -> NEEDS_CLARIFICATION -> INTAKE
  -> READY

READY
  -> IMPLEMENTING
  -> BLOCKED_OWNER | BLOCKED_EXTERNAL | ESCALATED_TECHNICAL

IMPLEMENTING
  -> VERIFYING
  -> NEEDS_FIX
  -> BLOCKED_OWNER | BLOCKED_EXTERNAL | ESCALATED_TECHNICAL

VERIFYING
  -> REVIEW
  -> NEEDS_FIX
  -> BLOCKED_OWNER | BLOCKED_EXTERNAL | ESCALATED_TECHNICAL

REVIEW
  -> OWNER_ACCEPTANCE
  -> NEEDS_FIX
  -> BLOCKED_OWNER | BLOCKED_EXTERNAL | ESCALATED_TECHNICAL

OWNER_ACCEPTANCE
  -> DONE
  -> NEEDS_FIX
  -> BLOCKED_OWNER

NEEDS_FIX
  -> IMPLEMENTING (next clean-slate attempt, only while attempts < 4)
  -> ESCALATED_TECHNICAL (attempt ladder exhausted)

BLOCKED_* / ESCALATED_TECHNICAL
  -> READY only after the named authority records a disposition
```

## Transition authority

Only the Controller records transitions. An implementer or reviewer recommends
a transition but does not mutate authoritative state.

## Invariants

- `scope_revision` is a positive integer.
- `attempt_number` is `0..4` and only increases inside a revision.
- every new attempt has the same approved `base_sha` and a new clean worktree;
- `effective_risk` is monotonic inside a revision;
- `complexity` may be refined but cannot lower risk or waive controls;
- `VERIFYING` requires a valid frozen manifest lock;
- `DONE` requires the completion conditions in the canonical spec;
- any ambiguity or stale head binding transitions to a blocked state.

## Scope revision

Material requirement or verification changes require explicit Owner approval,
an incremented scope revision, a new manifest revision, and a new lock. The old
revision remains immutable historical evidence.

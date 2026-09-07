# QQ Evidence-Gated Workflow v9
Read these files before changing the project:

1. `.ai-workflow/V9_CANONICAL_SPEC.md`
2. `.ai-workflow/POLICY.md`
3. `.ai-workflow/PROJECT_PROFILE.json`
4. the current task and its frozen verification manifest
5. `.ai-workflow/CONTROLLER_OPERATIONS.md`

Rules:

- Owner defines product intent and performs functional acceptance; Owner does
  not review code, tests, schemas, CI, or security controls.
- Model routing is manual in v9.
- Risk and complexity are independent.
- Risk may rise after diff inspection and never falls within a scope revision.
- Do not implement until the verification manifest is frozen.
- Do not edit a frozen verification manifest. Create a new scope revision with
  explicit Owner approval instead.
- Each implementation attempt starts from the approved base SHA in a new clean
  worktree. Do not continue from a failed attempt's filesystem.
- Do not self-declare success. Required deterministic gates must pass.
- Send all command output through the redaction boundary.
- Missing, conflicting, stale, or unprovable control state fails closed.
- RED tripwires stop implementation and route to the named qualified reviewer
  and/or Technical Operator.
- Never request or record secrets, tokens, cookies, JWTs, passwords, or raw
  authenticated browser state in chat, tasks, logs, or evidence.

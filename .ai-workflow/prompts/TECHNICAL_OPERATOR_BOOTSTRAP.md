# Technical Operator Bootstrap Prompt

Read `.ai-workflow/BOOTSTRAP.md` and take role `TECHNICAL_OPERATOR` for the
current Controller-authorized technical handoff.

Then read the canonical v9 spec, `CONTROLLER_OPERATIONS.md`, actor registry,
project profile, authoritative task/Issue, and the supplied
`TECHNICAL_OPERATOR_HANDOFF` packet.

Use only the trusted execution environment and exact authority inputs named in
the handoff. Execute only the requested technical/controller transaction. Do not
implement product code, broaden scope, weaken gates, reconstruct missing
Controller snapshots/digests, or expose secrets.

If any pinned digest, snapshot reference, base, branch/destination, recovery
marker, or authority input is stale/missing/ambiguous, return `BLOCKED` instead
of guessing.

Return only `.ai-workflow/templates/TECHNICAL_OPERATOR_RESULT.md` and stop.

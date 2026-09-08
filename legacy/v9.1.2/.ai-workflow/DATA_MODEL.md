# Data Model
status, and final verdict. A lower tier cannot satisfy a higher-tier criterion.
status, and final verdict. A lower tier cannot satisfy a higher-tier criterion.
All JSON files are UTF-8. Unknown required-control fields fail closed.

## Task

Required fields:

```json
{
  "schema_version": "qq.workflow.task.v9",
  "task_id": "TASK-001",
  "title": "Plain-language title",
  "scope_revision": 1,
  "state": "INTAKE",
  "base_sha": "40-character commit SHA",
  "risk": {
    "declared": "GREEN",
    "prior_effective": "GREEN",
    "effective": "GREEN",
    "observations": []
  },
  "complexity": {
    "level": "S",
    "drivers": []
  },
  "scope": { "in": [], "out": [] },
  "owner_acceptance": [],
  "attempt": { "number": 0, "max": 4 },
  "assignments": {
    "controller": null,
    "planner": null,
    "implementer": null,
    "qualified_reviewer": null,
    "technical_operator": null
  },
  "verification_manifest": "relative/path/verification-manifest.json",
  "evidence": []
}
```

Risk values: `GREEN`, `YELLOW`, `RED`. Complexity values: `S`, `M`, `L`, `XL`.
They are deliberately different enums and have no implicit mapping.

## Verification manifest and lock

The manifest contains `task_id`, `scope_revision`, `base_sha`, acceptance
criteria, and ordered gates. Each gate uses an `argv` array; shell strings are
not accepted. The lock contains the exact-file SHA-256 and freeze timestamp.

```json
{
  "schema_version": "qq.workflow.verification-lock.v9",
  "task_id": "TASK-001",
  "scope_revision": 1,
  "base_sha": "...",
  "manifest_sha256": "sha256:...",
  "frozen_at": "ISO-8601 UTC"
}
```

## Risk decision

The risk inspector returns declared, prior, observed, and effective risk plus
matched tripwires, required roles, action, and the independently supplied
complexity. A RED decision uses action `STOP_AND_ESCALATE`.

## Evidence record

Each record identifies evidence tier (`LOCAL_HERMETIC`, `CI`, `HOSTED`, `LIVE`,
or `PRODUCTION`), exact revision/head, manifest hash, gate results, redaction
status, and final verdict. A lower tier cannot satisfy a higher-tier criterion.

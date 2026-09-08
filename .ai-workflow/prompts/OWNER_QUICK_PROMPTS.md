# Owner Quick Prompts

Use these prompts as-is. The repository and authoritative task carry the detailed context.

## ChatGPT — Controller + Planner

```text
Read .ai-workflow/prompts/CONTROLLER_BOOTSTRAP.md and take CONTROLLER role for the current authoritative task. Read the repo and authoritative Issue/state first, continue from the current state, and handle all technical coordination yourself. Emit every handoff and review packet as the downloadable file named in .ai-workflow/HANDOFF_FILES.md; keep the GitHub Issue to concise state, digest, SHA, and file-reference checkpoints. If the next valid step requires a trusted Git/provider/recovery environment that this chat cannot execute, route it through a TECHNICAL_OPERATOR_HANDOFF file instead of stopping or asking me to run commands. Only ask me as Owner for product/business decisions, account-only provider actions, functional acceptance, or final merge.
```

## Antigravity / Gemini — Implementer

```text
Read .ai-workflow/prompts/IMPLEMENTER_BOOTSTRAP.md and take IMPLEMENTER role for the attached Controller-authorized handoff file. Read the repo and authoritative task first, execute only the assigned attempt/scope, run the requested focused checks, commit the candidate, and return only a downloadable TASK-<id>-implementer-result.md following .ai-workflow/templates/IMPLEMENTER_RESULT.md. Do not reserve attempts, change scope/state/manifest, merge, or declare DONE.
```

## File handoff rule

Normal implementation:

Controller -> Implementer: attach `TASK-<id>-implementer-handoff.md`.

Implementer -> Controller: attach `TASK-<id>-implementer-result.md`.

Technical execution fallback when required:

Controller -> Technical Operator/Work: attach `TASK-<id>-technical-operator-handoff.md`.

Technical Operator/Work -> Controller: attach `TASK-<id>-technical-operator-result.md`.

Controller -> Reviewer: attach `TASK-<id>-qualified-review-handoff.md`.

Reviewer -> Controller: attach `TASK-<id>-qualified-review.md`.

Do not copy full chat histories, packet bodies, or secrets between tools. Use
the Issue only for concise checkpoints defined in `HANDOFF_FILES.md`.

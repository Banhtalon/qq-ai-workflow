# Owner Quick Prompts

Use these prompts as-is. The repository and authoritative task carry the detailed context.

## ChatGPT — Controller + Planner

```text
Read .ai-workflow/prompts/CONTROLLER_BOOTSTRAP.md and take CONTROLLER role for the current authoritative task. Read the repo and authoritative Issue/state first, continue from the current state, and handle all technical coordination yourself. If the next valid step requires a trusted Git/provider/recovery environment that this chat cannot execute, route it through a TECHNICAL_OPERATOR_HANDOFF instead of stopping or asking me to run commands. Only ask me as Owner for product/business decisions, account-only provider actions, functional acceptance, or final merge.
```

## Antigravity / Gemini — Implementer

```text
Read .ai-workflow/prompts/IMPLEMENTER_BOOTSTRAP.md and take IMPLEMENTER role for the current Controller-authorized handoff. Read the repo and authoritative task first, execute only the assigned attempt/scope, run the requested focused checks, commit the candidate, and return IMPLEMENTER_RESULT. Do not reserve attempts, change scope/state/manifest, merge, or declare DONE.
```

## Copy-back rule

Normal implementation:

Controller -> Implementer: copy only the `IMPLEMENTER_HANDOFF` packet.

Implementer -> Controller: copy only the `IMPLEMENTER_RESULT` packet.

Technical execution fallback when required:

Controller -> Technical Operator/Work: copy only the `TECHNICAL_OPERATOR_HANDOFF` packet.

Technical Operator/Work -> Controller: copy only the `TECHNICAL_OPERATOR_RESULT` packet.

Do not copy full chat histories or secrets between tools.

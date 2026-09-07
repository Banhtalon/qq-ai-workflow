# Multi-AI Bootstrap

Template release: **9.1.0**  
Canonical control core: **QQ AI Workflow v9.0.0**  
Routing mode: **MANUAL**

This layer reduces Owner copy-paste without changing the v9 authority model.
The repository and authoritative task store remain the shared source of truth.
No model is auto-selected or auto-invoked.

## Startup contract

Every AI session must:

1. read `.ai-workflow/V9_CANONICAL_SPEC.md` and `.ai-workflow/ACTOR_REGISTRY.md`;
2. read `.ai-workflow/PROJECT_PROFILE.json` (or the example during template setup);
3. receive an explicit role from the bootstrap prompt;
4. read the matching file under `.ai-workflow/roles/`;
5. read the current authoritative task/Issue and current evidence before acting;
6. obey the frozen manifest, risk floor, scope revision, attempt state, and stop conditions;
7. keep model routing manual and keep secrets out of prompts, chat, repo, logs, and evidence.

If the explicit role conflicts with the authoritative task state or project profile,
stop with `BLOCKED_ROLE_MISMATCH`. Never silently assume a more privileged role.

## Supported roles

- `CONTROLLER` -> `.ai-workflow/roles/CONTROLLER.md`
- `IMPLEMENTER` -> `.ai-workflow/roles/IMPLEMENTER.md`
- `REVIEWER` -> `.ai-workflow/roles/REVIEWER.md`
- `TECHNICAL_OPERATOR` -> `.ai-workflow/roles/TECHNICAL_OPERATOR.md`

Planner responsibilities may be performed by the Controller when the project
profile binds the same capability, but Controller authority and Implementer
execution remain separate.

## Owner boundary

The Owner should only be asked for:

- product intent or material business decisions;
- approval of a material scope revision;
- functional acceptance of an Owner-ready build;
- account-only actions in official provider UIs;
- final merge when the Controller reports readiness.

Do not ask the Owner to inspect code, CI logs, schemas, SQL safety, security
controls, or technical diagnostics.

## Minimal cross-AI exchange

The Controller sends only an `IMPLEMENTER_HANDOFF` packet. The Implementer
returns only an `IMPLEMENTER_RESULT` packet. Both sides must independently read
the repository and authoritative task instead of relying on copied chat history.

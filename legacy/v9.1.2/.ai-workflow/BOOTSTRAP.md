# Multi-AI Bootstrap

Template release: **9.1.2**
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

## Controller execution-environment fallback

A Controller tool limitation is not an Owner blocker. When the next canonical
operation requires a trusted networked Git checkout, provider console, migration
tool, or recovery environment that the current Controller session cannot use,
the Controller must route that exact operation to the Technical Operator using
`.ai-workflow/templates/TECHNICAL_OPERATOR_HANDOFF.md`.

The Controller must not invent a reservation, create a normal branch as a
substitute for a Controller transaction, or issue an `IMPLEMENTER_HANDOFF` before
the required transaction succeeds. It also must not ask the Owner to run CLI,
inspect logs, or diagnose the technical gap. If the only missing step is opening
or authorizing an account-bound execution environment, the Owner may be asked
only for that account action; the Technical Operator still performs the commands.

After a `TECHNICAL_OPERATOR_RESULT` returns, the Controller independently checks
the authoritative Issue, exact digest/state, and any required clean-baseline
proof before continuing.

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

Use file-first exchanges: the Controller emits a downloadable handoff file and
the receiving actor returns a downloadable result file. Do not paste long
packets or full chat histories. The contents still follow the matching template
and are not authoritative by themselves; see `HANDOFF_FILES.md`.

Normal implementation flow:

- Controller -> Implementer: `TASK-<id>-implementer-handoff.md`;
- Implementer -> Controller: `TASK-<id>-implementer-result.md`.

Technical execution fallback when needed:

- Controller -> Technical Operator: `TASK-<id>-technical-operator-handoff.md`;
- Technical Operator -> Controller: `TASK-<id>-technical-operator-result.md`;
- Controller verifies the returned authority/state before issuing any
  `IMPLEMENTER_HANDOFF`.

Required qualified review flow:

- Controller -> Reviewer: `TASK-<id>-qualified-review-handoff.md`;
- Reviewer -> Controller: `TASK-<id>-qualified-review.md`.

All actors independently read the repository and authoritative task instead of
relying on copied chat history.

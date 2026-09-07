# QQ AI Workflow v9.1 — Multi-AI Bootstrap

Template release: **9.1.0**  
Canonical control core: **QQ AI Workflow v9.0.0**  
Routing mode: **MANUAL**

Reusable, evidence-gated workflow kit for projects whose Owner should not need
to read code or operate the engineering control plane. v9.1 adds a thin
multi-AI bootstrap/handoff layer; it does not change v9 authority, risk,
verification, clean-attempt, review, or secret boundaries.

The canonical specification is `.ai-workflow/V9_CANONICAL_SPEC.md`.

## Owner quick start — two prompts

Use these short prompts repeatedly; each AI reads the repository and current
authoritative task instead of receiving a copied chat history.

**ChatGPT / Controller**

`Read .ai-workflow/prompts/CONTROLLER_BOOTSTRAP.md and take CONTROLLER role for the current authoritative task. Continue from current state.`

**Antigravity / Gemini / Implementer**

`Read .ai-workflow/prompts/IMPLEMENTER_BOOTSTRAP.md and take IMPLEMENTER role for the current Controller-authorized handoff. Execute only that attempt.`

The Controller copies only an `IMPLEMENTER_HANDOFF` packet to the Implementer;
the Implementer returns only an `IMPLEMENTER_RESULT` packet. The repository +
authoritative task/Issue remain the shared source of truth.

## Start a new project

1. Create a repository from this template or copy the kit into an existing repo.
2. Fill `.ai-workflow/PROJECT_PROFILE.json` from the example, including manual
   role bindings.
3. Read `.ai-workflow/BOOTSTRAP.md` and keep routing mode `MANUAL`.
4. Create a task and its verification manifest from `.ai-workflow/templates/`.
5. Freeze verification before implementation:

   `npm run workflow:freeze -- path/to/verification-manifest.json`

6. Follow `.ai-workflow/CONTROLLER_OPERATIONS.md` to create an external
   Controller snapshot and publish its digest in the task issue. Run tools from
   a trusted checkout, with the candidate directory as working directory.

   `node <trusted-kit>/scripts/prepare-attempt.mjs <control.json> <pinned-digest> <new-path> <new-branch>`

7. Commit the candidate, bind its head and inspect the actual Git diff, then
   publish the returned Controller digest before running frozen gates:

   `node <trusted-kit>/scripts/inspect-risk.mjs <control.json> <pinned-digest> <candidate-head>`

   `node <trusted-kit>/scripts/verify-task.mjs <manifest.json> <control.json> <new-pinned-digest> <external-evidence.json>`

8. Generate the plain-language Owner handoff:

   `npm run workflow:owner-status -- path/to/task.json`

Run `npm test` to validate the kit and role isolation, and `npm run pilot` to
execute the three hermetic GREEN, YELLOW, and escalation pilots.

## Safety properties

- deterministic evidence outranks model opinion;
- verification criteria are hash-locked before implementation;
- risk can increase after diff inspection and cannot decrease within a revision;
- risk and complexity are separate fields;
- every retry uses a clean worktree from the same approved baseline;
- Controller and Implementer permissions remain separated;
- secrets are redacted at the command-output boundary;
- high-risk work stops for a qualified reviewer and/or Technical Operator;
- no unattended model routing is included in v9.1.

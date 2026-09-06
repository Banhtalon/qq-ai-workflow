# QQ AI Workflow v9
- no unattended model routing is included in v9.
- no unattended model routing is included in v9.
Reusable, evidence-gated workflow kit for small projects whose Owner should not
need to read code or operate the engineering control plane.

The canonical specification is `.ai-workflow/V9_CANONICAL_SPEC.md`. The kit is
self-contained, dependency-free, and intentionally keeps model routing manual.

## Start a new project

1. Create a repository from this template or copy the kit into an existing repo.
2. Fill `.ai-workflow/PROJECT_PROFILE.json` from the example.
3. Create a task and its verification manifest from `.ai-workflow/templates/`.
4. Freeze verification before implementation:

   `npm run workflow:freeze -- path/to/verification-manifest.json`

5. Start every implementation attempt from the approved base SHA:

   `npm run workflow:attempt -- --task TASK-001 --attempt 1 --base <sha> --destination <path> --branch <branch>`

6. Inspect changed paths, then run the frozen gates:

   `npm run workflow:risk -- --paths <changed paths>`

   `npm run workflow:verify -- path/to/verification-manifest.json`

7. Generate the plain-language Owner handoff:

   `npm run workflow:owner-status -- path/to/task.json`

Run `npm test` to validate the kit and `npm run pilot` to execute the three
hermetic GREEN, YELLOW, and escalation pilots.

## Safety properties

- deterministic evidence outranks model opinion;
- verification criteria are hash-locked before implementation;
- risk can increase after diff inspection and cannot decrease within a revision;
- risk and complexity are separate fields;
- every retry uses a clean worktree from the same approved baseline;
- secrets are redacted at the command-output boundary;
- high-risk work stops for a qualified reviewer and/or Technical Operator;
- no unattended model routing is included in v9.

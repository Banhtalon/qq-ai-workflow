# Qualified Reviewer Bootstrap Prompt

Read `.ai-workflow/BOOTSTRAP.md` and take role `REVIEWER` for the attached
Controller-authorized qualified-review handoff file.

Then read the canonical v9 spec, actor registry, project profile, authoritative
Issue/task state, frozen manifest references, and exact candidate head. Review
only that exact head from fresh independent context; do not implement a fix or
change task authority.

Return only a downloadable `TASK-<id>-qualified-review.md` following
`.ai-workflow/templates/QUALIFIED_REVIEW.md`, with exactly one disposition:
`RECOMMEND_PASS`, `NEEDS_FIX`, or `BLOCKED`. Do not waive deterministic gates,
declare Owner acceptance, or authorize a merge.

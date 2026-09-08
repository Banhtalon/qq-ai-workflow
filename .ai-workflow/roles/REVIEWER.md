# Role: REVIEWER

The Qualified Reviewer is independent of the implementation attempt and reviews
the exact candidate head from fresh context.

## Responsibilities

- bind the review to task id, scope revision, and exact candidate SHA;
- check specification compliance, regressions, edge cases, privacy, security,
  data integrity, and relevant domain hazards;
- inspect deterministic evidence without substituting opinion for machine gates;
- return exactly one disposition: `RECOMMEND_PASS`, `NEEDS_FIX`, or `BLOCKED`;
- list unresolved findings by severity and identify evidence gaps.
- return a downloadable file named by `HANDOFF_FILES.md` following
  `.ai-workflow/templates/QUALIFIED_REVIEW.md`.

## Forbidden

The Reviewer must not:

- review a different head and treat it as current;
- waive required deterministic gates;
- silently implement fixes while claiming independent review;
- change scope, manifest, risk floor, or attempt history;
- expose/request secrets in review evidence.

If the candidate changes materially after review, a fresh exact-head review is
required whenever project policy requires Qualified Review.

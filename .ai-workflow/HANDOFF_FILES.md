# File-first handoff convention

Template release 9.1.2 changes transport, not v9 authority. The Controller
creates a downloadable handoff file; the receiving actor returns a downloadable
result file using the matching template. The Owner transfers files between AI
tools and never needs to copy a long packet or chat history.

## Required filenames

Replace `<id>` with the exact task id, preserving its case.

| Direction | Filename | Required template |
| --- | --- | --- |
| Controller -> Technical Operator | `TASK-<id>-technical-operator-handoff.md` | `templates/TECHNICAL_OPERATOR_HANDOFF.md` |
| Technical Operator -> Controller | `TASK-<id>-technical-operator-result.md` | `templates/TECHNICAL_OPERATOR_RESULT.md` |
| Controller -> Implementer | `TASK-<id>-implementer-handoff.md` | `templates/IMPLEMENTER_HANDOFF.md` |
| Implementer -> Controller | `TASK-<id>-implementer-result.md` | `templates/IMPLEMENTER_RESULT.md` |
| Controller -> Qualified Reviewer | `TASK-<id>-qualified-review-handoff.md` | `templates/QUALIFIED_REVIEW_HANDOFF.md` |
| Qualified Reviewer -> Controller | `TASK-<id>-qualified-review.md` | `templates/QUALIFIED_REVIEW.md` |

The attached exact external Controller snapshot remains a separate authority
file when a Technical Operator transaction needs it. Do not rewrite, infer, or
substitute its bytes or digest.

## Controller file checklist

1. Fill the matching template completely, using only sanitized task evidence.
2. Save it under the required filename and make it downloadable/attachable.
3. Attach the handoff file to the receiving actor with the corresponding short
   quick prompt; do not paste the body into chat.
4. Read the returned result file and independently verify its claims against
   the authoritative Issue, digest, state, exact head, and required evidence.

## Issue checkpoints

The GitHub Issue is the concise authority/audit index, not packet storage. At
each material checkpoint, record only:

- task id and scope revision;
- state and exact base/candidate SHA when applicable;
- controller/manifest digest when applicable;
- named handoff or result file reference and its SHA-256 if available;
- short disposition or blocker.

Do not paste a packet body into the Issue unless a specific audit requires it.
Never put secrets, tokens, cookies, raw browser state, or PII in a file,
attachment, Issue, or chat. A file transport does not grant authority, waive a
gate, or replace the canonical external snapshot and Issue-pinned digest.

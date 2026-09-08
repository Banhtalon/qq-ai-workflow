# Controller operation contract (revision 2)

This is a manually operated workflow. The Controller is the trusted invoker.
The candidate repository is not authoritative for manifests, risk rules, prior
risk, attempt history, or candidate identity.

## Authority boundary

Keep a Controller JSON file outside every candidate checkout. The Controller
pins its SHA-256 digest in the authoritative GitHub issue, including author,
task, revision, baseline and time. Read the current issue before invoking a
command; pass the digest from that issue, never one suggested by candidate code.
A changed file requires a new explicitly recorded Controller transition and
digest. A stale digest fails closed. GitHub issue snapshots remain the audit
record; the local file is the execution copy.

Run the verifier and Controller commands from a separately reviewed, immutable
tool checkout. Pass the candidate as the working directory. In a real deployment,
the Controller store and trusted tooling must be inaccessible to candidate gate
processes (separate OS identity or read-only isolated runner). This kit does not
create an OS sandbox, credentials, signed service, or unattended router. Running
untrusted gates under the Controller's own OS account cannot provide protection
against malicious filesystem writes; such a run is hermetic testing only.

The snapshot schema is qq.workflow.controller.v9:
- task_id, scope_revision, base_sha, manifest_sha256;
- rules (frozen full risk rules), effective_risk, complexity;
- state, candidate_head, attempt_number, attempts;
- attempts contains consecutive number, base_sha, unique destination, unique
  branch, reserved_at and clean_baseline_proven;
- optional red_disposition_head: Technical Operator authorization bound to
  one exact RED candidate, recorded in the issue before verification.

The Controller creates the initial READY snapshot with attempt_number 0 and an
empty attempts array. Publish its digest before the first attempt. Candidate
agents have no write authority over it.

## Commands (Controller only)

1. prepare-attempt.mjs <control.json> <pinned-digest> <new-directory> <new-branch>
   takes an exclusive transaction lock, rejects stale state, reserves a unique
   attempt before Git runs, and creates a clean worktree at the frozen base.
   It returns the new digest; publish the reservation/start in the issue.
2. After implementation is committed, inspect-risk.mjs <control.json>
   <pinned-digest> <candidate-head> derives the entire diff, including both sides
   of renames. It persists monotonic risk and binds the head. Publish the new
   digest. RED transitions to ESCALATED_TECHNICAL.
3. verify-task.mjs <manifest.json> <control.json> <pinned-digest> <evidence.json>
   checks external authority, active attempt, exact clean head and risk before
   running the frozen gates. It rechecks head/cleanliness/control/manifest after
   gates. Save evidence outside the tracked candidate; otherwise evidence itself
   changes the reviewed candidate.

Never recompute and accept a stale pin automatically. A failed worktree creation
after RESERVED consumes that attempt. The Controller records a sanitized failure
summary and NEEDS_FIX disposition before another attempt. Four reservations
exhaust the revision. On crash, a .busy or .pending file blocks continuation;
Technical Operator inspects the audit trail and reconciles the interrupted
transaction, rather than deleting files blindly or retrying Git.

## Acceptance

Unit/pilot PASS is only a test result. Adoption additionally requires fresh
independent review at the candidate head and the Controller readiness decision.
Owner functional acceptance applies when product behavior changes.

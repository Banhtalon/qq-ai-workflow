# v10 validation scope
Candidate 10.0.0-rc.1: local workflow kit.
Original author validation environment: Linux, Node.js v24.19.0, temporary Git repositories.
Commands: node --test test/workflow.test.mjs test/pilots.test.mjs;
node scripts/check-kit.mjs; git diff --check.
Tests cover contract mutation, stale/missing/self review, failed gates, candidate
mutation, timeout, output redaction, model capability/quota waiting, bounded routing,
monotonic effective-risk state, evidence/risk binding, and simulated Windows command selection.
Synthetic pilots do not invoke AI models. Independent review of head
bc58d3ab9f6001083736bce4390116cd04dfeb9a found material issues; the repair head
requires a fresh independent re-review before approval. No Windows CLI bridge, live
subscription/account or downstream migration has been tested. v9 evidence remains historical only.

# v10 validation scope
Candidate 10.0.0-rc.1: local workflow kit.
Test environment: Linux, Node.js v24.19.0, temporary Git repositories.
Commands: node --test test/workflow.test.mjs test/pilots.test.mjs;
node scripts/check-kit.mjs; git diff --check.
Tests cover contract mutation, stale/missing/self review, failed gates, candidate
mutation, timeout, output redaction, model capability/quota waiting and bounded routing.
Synthetic pilots do not invoke AI models. No independent reviewer has approved this
candidate. No Windows CLI bridge, live subscription/account or downstream migration
has been tested. v9 evidence remains historical only.

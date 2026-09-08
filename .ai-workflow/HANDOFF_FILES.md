# Shared file handoffs
Use .workflow-local/current-task.json, implementer-result.md, evidence.json,
review.json and owner-status.md. This directory is ignored by Git.
Lead and workers read files in the same project; Owner does not upload/download
them between every turn. Use absolute local paths in tool calls.
A handoff includes task/revision, repo/branch/base, contract hash, scope, current
head, session identity, permitted actions, timeout and required result path.
A result includes changed head, checks, remaining failures and concise next action.
Only Lead updates counters and status. File changes are not a substitute for actually
invoking another AI. If no invocation capability exists, record WAITING_CAPABILITY.

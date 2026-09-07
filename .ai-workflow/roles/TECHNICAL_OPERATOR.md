# Role: TECHNICAL_OPERATOR

The Technical Operator handles privileged or recovery work that should not be
delegated to the Owner or ordinary Implementer.

## Responsibilities

- provider/account configuration that requires technical judgment;
- migrations, Auth/permission changes, infrastructure, deployment controls, and
  other RED-risk operations authorized by the task;
- secret-store setup through official provider mechanisms without disclosing
  secret values into prompts, chat, repository, logs, or evidence;
- recovery after provider failures, interrupted Controller transactions, or
  exhausted retry ladders;
- record a sanitized disposition bound to the relevant task/revision/head.

## Forbidden

The Technical Operator must not:

- expand product scope without Owner-approved revision;
- bypass safety controls or deterministic gates;
- place credentials or sensitive browser state in evidence;
- turn a privileged workaround into an undocumented permanent path.

When the RED condition is resolved, return control to the Controller with a
sanitized status and any remaining constraints.

# State machine v10
DRAFT -> READY -> IMPLEMENTING -> VERIFYING -> REVIEWING -> READY_FOR_OWNER -> DONE.
Invisible maintenance may move REVIEWING -> DONE when all technical evidence passes.
Failed checks/review -> NEEDS_FIX -> IMPLEMENTING within the repair budget.
Missing login/model/reviewer -> WAITING_CAPABILITY; quota -> WAITING_QUOTA.
Exhausted repair budget -> BLOCKED_TECHNICAL.
Material product choice -> BLOCKED_OWNER (never a request to inspect code).

Resume after waiting rechecks branch/head, contract and capabilities; preserve counters.
Changing head invalidates verification, review and Owner acceptance.
Changing contract increments revision, records a reason, and invalidates all evidence.
The CLI evaluates readiness; it does not run a stateful background controller.
DONE denotes accepted feature completion, not permission to merge or publish.

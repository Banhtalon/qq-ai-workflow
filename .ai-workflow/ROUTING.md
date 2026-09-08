# Routing policy
Model choices are project configuration, not hardcoded claims about access.
FAST: small low-risk work; SENIOR: complex/elevated work or exhausted fast repairs.
REVIEW: independent competent session after each feature. Review sensitive behavior
in depth; style-only suggestions do not force another repair unless in requirements.
Record provider/model/effort in the project profile; record the actual implementation
and review session IDs in task/review packets and keep the routing reason in the handoff/result.
Do not copy full chat history. Carry the short contract, relevant files, diff, failures and prior decisions.

Default: two repairs at initial tier, one senior pass, then stop. Preserve all counters
across quota waits, provider swaps and session changes. One writer; no worker fan-out.
A fresh reviewer may use the same model but never an implementation session.
No quota => WAITING_QUOTA, no eligible model => WAITING_CAPABILITY.
The route command recommends a role/tier; it never launches a CLI.
ASSISTED is the only executable stage of this kit; LOCAL_AUTO requires the later bridge.

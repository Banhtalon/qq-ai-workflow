# Sequential Windows CLI bridge

This is the PR 1 bridge, governed by [the canonical spec](V10_CANONICAL_SPEC.md).
It has no scheduler, dashboard, API billing fallback or parallel writers.
The existing `workflow.mjs route` remains an ASSISTED proposal tool. The bridge
uses a separate [configuration](BRIDGE_CONFIG.example.json); profile examples
are not account verification or automatic-mode activation.

## Lead setup

Use Node 20+, Git, the official Codex CLI and official Antigravity CLI. Read their
installed `--help` and `--version`; CLI flags may change. On Windows configure
an executable (`codex.exe`, `agy.exe`). The optional older `cli: "gemini"` adapter
uses `node` plus the Gemini JS entry point from its package's `bin` field, but Google
no longer serves individual subscriptions through that client. Never spawn a `.cmd`
shim or a shell command string.
Keep account installation outside the repository and configuration in
`.workflow-local/`. Do not copy authentication files or tokens into packets.

Owner signs in using official `codex login` (ChatGPT) and interactive `agy`
(Sign in with Google using the AI Pro account). The bridge does not handle login
screens. It removes API credentials/provider environment overrides from child
processes and forces ChatGPT authentication for Codex. Antigravity must have
`useG1Credits: false` and no `modelProvider` override in its non-secret settings;
Lead sets/checks these preferences without reading account stores. This prevents
automatic AI-credit fallback as well as API billing. Discover Google model slugs
with `agy models`, then probe the chosen model through the actual account.
Antigravity removes default-valued settings on exit; if the credit preference is
omitted, the bridge explicitly writes it as false again before invocation. An
enabled preference or API provider selection blocks the run for Lead inspection.
The older Gemini adapter enforces `oauth-personal`; Codex ignores user configuration.
Existing CLI account stores remain managed by the provider, never read by this kit.
Google CLI settings and approved tools remain within the trusted local
operator boundary; this is not an adversarial OS isolation system.

Freeze a task before running, with a feature branch, clean working tree and fixed
gates. Configure exact relative `write_paths` for this one feature. The bridge
rejects edits to instructions, workflow packets, package manifests, test directories,
gate script paths and explicit `gate_paths`, files outside that list, symlinks,
binary files and secret-like content before committing. Lead lists indirect gate
dependencies (custom runners, fixtures and gate configuration outside standard test
directories) in `gate_paths` before the run. This list is bound into the checkpoint
config digest and cannot change on resume.
For Antigravity, Lead preconfigures scoped `permissions.allow` rules for
`read_file(<absolute-repo>)` and `write_file(<absolute-allowed-file>)` in its settings.
Do not use `--dangerously-skip-permissions`. A headless soft-denial can exit 0 with
an empty response; the bridge records its session and denied action names as
`WAITING_CAPABILITY`, never as PASS. Inspect any partial edits before recovery.
Worker code is committed on that feature branch only; the Lead must have task-level
authorization to create those checkpoints. No push or merge occurs in the runner.
Packets must live outside tracked source, normally in ignored `.workflow-local/`.

```text
node scripts/bridge.mjs doctor <bridge-config.json> <repo> <doctor-packets> --probe
node scripts/bridge.mjs pilot <bridge-config.json> <frozen-task.json> <repo> <run-packets>
node scripts/bridge.mjs status <run-packets>
node scripts/bridge.mjs resume <bridge-config.json> <frozen-task.json> <repo> <run-packets> --pilot
```

`doctor` without `--probe` checks CLI availability and Codex login status; it does
not certify a model. With `--probe`, each configured role must return a structured
response through its actual account. A requested model is recorded separately from
model names reported by the protocol; Codex JSONL may not report an observed model.
No model catalog is guessed from an account name or subscription label.

## Loop and durable stop

The runner holds an exclusive lock in the Git common directory, including across
linked worktrees. It invokes one worker, commits the allowed changes, runs the frozen
gates, then invokes a fresh Codex reviewer with read-only permissions. Antigravity
is worker-only: its `plan` mode is a prompt convention, not a write prohibition.
Capability probes use a no-tools prompt and clean-tree checking.
The reviewer
receives actual evidence and base/head/contract; it never shares a worker session.
Findings are automatically passed to the next worker. Two repair rounds at the
initial tier are followed by at most one senior pass. Counters survive pause/resume.
Any remaining material failure is `BLOCKED_TECHNICAL`. Readiness uses existing
exact-head evidence/review validation and does not authorize merge.

Every operation has an atomic, flushed in-flight checkpoint before invocation.
Records contain actual argv, process times/exit, session ID, requested/reported
models, head and parsed result. Raw provider transcripts are bounded in memory and
not persisted by the bridge. Selected persisted text is redacted. Official CLIs
may retain their own local sessions under their normal account policies.

Quota during read-only capability probes gives `WAITING_QUOTA`; `resume` probes
again without resetting counters. No purchase/reset/API fallback is attempted.
After a worker/reviewer failure, invalid output, timeout or interruption, effects
may be uncertain. The bridge preserves code and the in-flight marker and refuses
automatic replay. The Lead inspects processes, diff, packet integrity and the saved
session before deciding recovery. There is deliberately no `--force`, automatic
lock stealing, automatic reset or generic retry button. If the parent was killed,
the lock also survives: verify both parent and any child process have stopped before
manually reconciling the checkpoint. Recovery is a Lead operation, not Owner packet
transport. A crash between task and run-counter writes fails closed on mismatch.

## LOCAL_AUTO acceptance

The `pilot` command is an explicit supervised integration run while mode stays
ASSISTED. Fake-process tests exercise failure modes but cannot justify acceptance.
To activate automatic runs, the recorded Windows pilot must include both actual
subscription providers, fresh review, at least one reviewer/gate repair, completed
final evidence, and a real observed quota pause at preflight followed by safe resume.
Do not deliberately exhaust a subscription to create this record; keep ASSISTED
until genuine quota behavior has been observed. Unknown worker effects require Lead
reconciliation and cannot be converted into a successful quota pilot automatically.

```text
node scripts/bridge.mjs activate <bridge-config.json> <accepted-pilot-packets> <target-run-packets>
```

Only after that succeeds set the bridge config mode to `LOCAL_AUTO` and use `run`.
Activation binds the configuration, bridge source digest and pilot checkpoint;
changing these invalidates it. It is a local evidence check, not cryptographic
proof of account identity or protection against an operator fabricating JSON.
Owner functional acceptance and merge approval remain separate.

## Sources checked for this implementation

- [Codex non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Gemini authentication](https://geminicli.com/docs/get-started/authentication/)
- [Gemini headless execution](https://geminicli.com/docs/cli/headless/)
- [Google's individual-account CLI transition](https://github.com/google-gemini/gemini-cli/discussions/28017)
- [Antigravity installation and account authentication](https://antigravity.google/docs/cli/install/)
- [Antigravity headless JSON protocol](https://antigravity.google/docs/cli/headless/)
- [Antigravity execution modes](https://antigravity.google/docs/cli/modes/)
- [Antigravity credit settings](https://antigravity.google/docs/cli/settings)

Installed-version checks and probe outcomes belong in local evidence, not in this
template as a claim that another laptop is ready. `mindx-review-bot` is out of scope.

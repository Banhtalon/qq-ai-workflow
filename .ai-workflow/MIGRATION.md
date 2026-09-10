# Adoption and migration

## Template release

This branch implements the Owner-authorized v10 redesign. Archive provenance:
annotated tag `v9.1.2` resolves to `c68750f80d276534867287ffe02689f346be8b8d`.
Default entry points, scripts and tests target v10. Archived instructions are inactive.
The release is a candidate pending independent review, not a Windows bridge claim.

## New project

Lead copies active .ai-workflow/, AGENTS.md, GEMINI.md and scripts/ to an unused
workflow namespace if scripts already exist. Merge instruction/package/gitignore
entries intentionally; do not overwrite host files. Configure gates for that project,
not this template's tests. Add .workflow-local/ to the host ignore file.
Copy PROJECT_PROFILE.example.json to PROJECT_PROFILE.json and replace placeholders
after actual account/capability checks. Create/freeze a real task and feature branch.

## Existing project

Inventory instructions, prompts, package scripts, CI gates and current task authority.
Checkpoint working code/branch; preserve uncommitted files, requirements and evidence.
Record a cutover entry: old version/task/revision/head, new version/revision/head,
reason, retained scope/gates/live-write boundaries, and applicable Owner authorization.
End/suspend the old task revision explicitly; never reuse its review as v10 evidence.
Remove/supersede conflicting active prompts and commands together. Archive old rules.
Recreate the v10 contract at the chosen baseline; review the migration independently.
Do not weaken host product/security gates merely because workflow machinery changes.

## Khôi phục v9

Tag `v9.1.2` là bản lưu v9 đã được xác minh. Để xem hoặc phục hồi mà không ghi đè
checkout đang làm việc, tạo một working directory riêng:

```text
git worktree add ..\qq-ai-workflow-v9 v9.1.2
```

Sau đó thực hiện chuyển đổi có kiểm soát từ thư mục riêng này: dừng worker, giữ feature
branch và task state hiện có, rồi ghi lại migration mới. Không reset product code hoặc
ghi đè task đang hoạt động tự động. Các script v9 không dùng với packet v10.

## Windows bridge, later

Implement official-CLI invocation with model discovery, subscription auth,
timeouts, one writer, result files, bounded retries and no API fallback.
Probe real handoff, review/repair and quota interruption before LOCAL_AUTO.
No such probe has run in this template-only stage.
mindx-review-bot and its TASK-11 are not modified by this release.

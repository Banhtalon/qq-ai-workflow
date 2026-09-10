# Adoption and migration

[Quy tắc workflow v10](V10_CANONICAL_SPEC.md) là nguồn điều phối cho dự án đã chuyển đổi.

## Template release

Tag chú thích `v9.1.2` trỏ tới `c68750f80d276534867287ffe02689f346be8b8d`. Entry point, scripts và tests ở checkout hiện tại dùng v10.

## New project

Copy `.ai-workflow/`, `AGENTS.md`, `GEMINI.md` và `scripts/` vào namespace workflow trống. Cấu hình gates theo dự án nhận, thêm `.workflow-local/` vào ignore file, rồi tạo project profile và task v10.

## Existing project

Ghi lại task/version/head tại thời điểm chuyển đổi, requirements hiện có, gates và live-write boundaries. Tạo contract v10 tại baseline đã chọn và lưu evidence mới theo canonical spec.

## Khôi phục v9

Tag `v9.1.2` giữ bản lưu v9. Tạo working directory riêng để xem hoặc phục hồi:

```text
git worktree add ..\qq-ai-workflow-v9 v9.1.2
```

Working directory này giữ checkout hiện tại nguyên vẹn. Việc chuyển đổi sau đó dùng task và evidence mới.

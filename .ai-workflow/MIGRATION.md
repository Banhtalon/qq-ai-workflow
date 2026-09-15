# Adoption and migration

[Quy tắc workflow v10](V10_CANONICAL_SPEC.md) là nguồn điều phối cho dự án đã chuyển đổi.

## Template release

Tag chú thích `v9.1.2` trỏ tới `c68750f80d276534867287ffe02689f346be8b8d`. Entry point, scripts và tests ở checkout hiện tại dùng v10.

## v10.1.0-rc.1

Checkout hiện tại đã có Controlled Delegation V2 và cầu nối CLI tuần tự. Task v10 cũ
tiếp tục dùng policy đã đóng băng; task mới khởi tạo từ template hoặc `workflow.mjs init`
dùng `CONTROLLED_DELEGATION_V1`. Khi task contract chọn V2, bridge configuration cần có
worker Gemini, fallback Luna và các binding reviewer/senior tương ứng. Packet đang chạy
giữ nguyên policy; thay đổi phạm vi hoặc contract tạo revision mới.

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

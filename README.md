# QQ AI Workflow v10 — Personal Local
Version: **10.0.0-rc.1** · Stage: **sequential CLI bridge; real Windows acceptance required**

Một Codex nhận yêu cầu, tự làm hoặc giao Gemini, kiểm thử, gọi reviewer độc lập,
sửa lỗi và đưa bản dùng thử cho Owner. Dành cho một người dùng, dự án nhỏ trên
Windows. ChatGPT web là nơi bàn ý tưởng tùy chọn.

## Bắt đầu
Đọc [hướng dẫn Owner](.ai-workflow/OWNER_GUIDE.md), sau đó giao yêu cầu trong Codex:
“Đọc AGENTS.md và .ai-workflow/BOOTSTRAP.md. Tiếp tục công việc hiện tại theo v10.”

[Spec](.ai-workflow/V10_CANONICAL_SPEC.md) là luật duy nhất cho task đã chuyển sang v10.
[Migration](.ai-workflow/MIGRATION.md) hướng dẫn chuyển dự án cũ; không tự chuyển
TASK-11 của mindx-review-bot.

## Có gì ở bản này
- Lead gộp điều phối, thao tác kỹ thuật và có thể implement.
- Quy tắc chọn model theo độ khó và rủi ro; review theo tính năng.
- Contract yêu cầu/kiểm thử được chốt trước code; evidence gắn đúng commit.
- Công cụ local: chốt contract, chạy gates có che thông tin nhạy cảm,
  kiểm tra gói kết quả, đề xuất route và báo trạng thái.
- [Cầu nối CLI tuần tự](.ai-workflow/CLI_BRIDGE.md): worker → kiểm thử → reviewer → sửa,
  có checkpoint và giới hạn sửa. Mặc định ASSISTED; chỉ bật LOCAL_AUTO sau pilot thật.
  Không tự đăng nhập, không tự mua credit, không có scheduler nền.
- [Luồng Nhanh bằng máy](.ai-workflow/FAST_LANE.md): chỉ định tuyến thay đổi tài liệu
  thuộc allowlist cố định; mọi trường hợp không chứng minh được đều quay về Luồng Tính năng.

Không có reviewer hoặc kết nối thì Lead lưu việc đang chờ; không giả lập review
thành công và không yêu cầu Owner chuyển từng gói kỹ thuật.

## Kiểm tra bộ template
Node.js 20+; không có npm dependency.
```text
npm test
npm run workflow:check
npm run pilot
```
Pilot dùng Git repo tạm và chương trình test giả lập; không gọi model hoặc dịch vụ thật.

Công cụ cho Lead (Owner không cần chạy):
```text
node scripts/workflow.mjs freeze <task.json>
node scripts/workflow.mjs route <task.json> <profile.json>
node scripts/workflow.mjs verify <task.json> <repo-directory> <evidence.json>
node scripts/workflow.mjs status <task.json> <evidence.json> <review.json> <repo-directory>
```
Các file task/evidence đặt trong .workflow-local/ đã gitignore; profile example là
mẫu, không chứng minh tài khoản đã sẵn sàng.

## Lưu trữ
[legacy/v9.1.2](legacy/v9.1.2/README.md) giữ nguyên bộ v9 để đối chiếu/rollback.
Không đọc luật legacy như chỉ dẫn đang hoạt động. Bộ v10 không cung cấp mức
cách ly quyền Controller/Implementer hoặc kiểm chứng chống sửa giả của v9.
Xem [giới hạn](.ai-workflow/V10_CANONICAL_SPEC.md).

Route chấp nhận --needs-repair khi xử lý lỗi và --quota-exhausted khi hết hạn mức.
CLI `workflow.mjs` đề xuất quyết định. `bridge.mjs` thực thi vòng tuần tự riêng,
lưu counter thực tế và dừng khi kết quả thao tác chưa rõ.

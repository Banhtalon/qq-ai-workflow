# Sequential Windows CLI bridge

[Quy tắc workflow v10](V10_CANONICAL_SPEC.md) định nghĩa vai trò, ngân sách sửa, trạng thái và điều kiện `LOCAL_AUTO`. Trang này mô tả lệnh cầu nối CLI và các packet nó lưu.

## Chuẩn bị

Cầu nối dùng Node 20+, Git, Codex CLI và Antigravity CLI đã có trên máy Windows. Cấu hình chạy nằm trong `.workflow-local/`; tài khoản tiếp tục do CLI chính thức quản lý. `doctor --probe` tạo capability packet có kết quả dạng cấu trúc.

## Lệnh

```text
node scripts/bridge.mjs doctor <bridge-config.json> <repo> <doctor-packets> --probe
node scripts/bridge.mjs pilot <bridge-config.json> <frozen-task.json> <repo> <run-packets>
node scripts/bridge.mjs status <run-packets>
node scripts/bridge.mjs resume <bridge-config.json> <frozen-task.json> <repo> <run-packets> --pilot
node scripts/bridge.mjs quota-drill <bridge-config.json> <accepted-pilot-packets> <activation-packets>
node scripts/bridge.mjs activate <bridge-config.json> <accepted-pilot-packets> <target-run-packets>
```

`workflow.mjs route` trả đề xuất trong chế độ ASSISTED. Bridge ghi argv, thời gian, session, model báo cáo, head, kết quả đã redaction và checkpoint vào run packets. `quota-drill` không gọi AI: nó kiểm tra cầu nối xử lý `WAITING_QUOTA` (hết hạn mức) và resume (tiếp tục) an toàn trên bản sao trạng thái. Dùng thư mục activation tách khỏi packet pilot đã chấp nhận. `activate` chỉ nhận pilot và biên nhận quota drill cùng khớp với canonical spec.

## Khôi phục

Khi tiến trình kết thúc bất thường, run packet giữ in-flight marker, session và diff để Lead đối chiếu trước lần thao tác tiếp theo. `status` đọc checkpoint hiện có. Danh sách tham số và cấu hình mẫu ở [BRIDGE_CONFIG.example.json](BRIDGE_CONFIG.example.json).

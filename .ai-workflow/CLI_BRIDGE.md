# Sequential Windows CLI bridge

[Quy tắc workflow v10](V10_CANONICAL_SPEC.md) định nghĩa vai trò, ngân sách sửa, trạng thái và điều kiện `LOCAL_AUTO`. Trang này mô tả lệnh cầu nối CLI và các packet nó lưu.

## Chuẩn bị

Cầu nối dùng Node 20+, Git, Codex CLI và Antigravity CLI đã có trên máy Windows. Cấu hình chạy nằm trong `.workflow-local/`; tài khoản tiếp tục do CLI chính thức quản lý. `doctor --probe` tạo capability packet có kết quả dạng cấu trúc.

Task mới dùng Controlled Delegation và có cấu hình mẫu tại
`BRIDGE_CONFIG.controlled.example.json`. `BRIDGE_CONFIG.example.json` được giữ để
tương thích các task v10/GEMINI_FIRST cũ.

## Lệnh

```text
node scripts/bridge.mjs doctor <bridge-config.json> <repo> <doctor-packets> --probe
node scripts/bridge.mjs pilot <bridge-config.json> <frozen-task.json> <repo> <run-packets>
node scripts/bridge.mjs status <run-packets>
node scripts/bridge.mjs report <run-packets>
node scripts/bridge.mjs report <run-packets> --audience lead --format json
node scripts/bridge.mjs resume <bridge-config.json> <frozen-task.json> <repo> <run-packets> --pilot
node scripts/bridge.mjs quota-drill <bridge-config.json> <accepted-pilot-packets> <activation-packets>
node scripts/bridge.mjs activate <bridge-config.json> <accepted-pilot-packets> <target-run-packets>
```

`workflow.mjs route` trả đề xuất trong chế độ ASSISTED. Bridge ghi argv, thời gian, session, model báo cáo, head, kết quả đã redaction và checkpoint vào run packets. `quota-drill` không gọi AI: nó kiểm tra cầu nối xử lý `WAITING_QUOTA` (hết hạn mức) và resume (tiếp tục) an toàn trên bản sao trạng thái. Dùng thư mục activation tách khỏi packet pilot đã chấp nhận. `activate` chỉ nhận pilot và biên nhận quota drill cùng khớp với canonical spec.

Mỗi lượt thực thi phân biệt `role`, `provider`, `cli`, `requested_model`, `observed_models` và `session_id`. Antigravity là CLI worker hiện tại cho provider Google; Codex là CLI hiện tại cho các vai trò review/senior. Model thực tế lấy từ probe hoặc metadata do CLI/provider báo cáo, không suy đoán từ tên CLI.

## Ngữ cảnh review và dữ liệu test

`review_context_paths` trong config liệt kê file hoặc thư mục bổ sung cho reviewer,
ví dụ model, form và template nền mà thay đổi đang sử dụng. Packet riêng của mỗi
lượt review có `review-source.json`: diff, nội dung đã kiểm tra và hash base/head.
`source_sha256` trong lịch sử liên kết với packet này.

`synthetic_source_approvals` có dạng
`[{"path":"notes/tests.py","sha256":"<SHA-256 nội dung UTF-8 chính xác>","kind":"synthetic-test-data","reason":"Lead đã đọc và xác nhận dữ liệu thử"}]`.
Đây là ghi nhận kiểm tra nguồn của Lead trước khi bắt đầu checkpoint, tách khỏi
cấu hình tự phát hiện dữ liệu giả. File test mới hoặc thay đổi nội dung cần được
kiểm tra lại; config thay đổi không thể tiếp tục checkpoint cũ. Chuỗi giống khóa
truy cập thật vẫn bị chặn. Các chi tiết giới hạn nằm trong canonical spec.

Task Google-worker-first ghi `execution.source_approvals_sha256` bằng SHA-256 của
`JSON.stringify(config.synthetic_source_approvals)` trước khi freeze.

## Báo cáo gọn cho dự án nhỏ

`report` đọc hồ sơ hiện có, xuất stdout và không gọi provider hoặc ghi packet.
Mặc định là Markdown cho Owner; `--audience lead` thêm thông tin kỹ thuật,
`--format json` dùng cho công cụ. Đầu ra tối đa 8 KiB UTF-8, có thông báo khi
rút gọn và tham chiếu hồ sơ đầy đủ. Đây là bản tóm tắt dữ liệu đã lưu, tách
biệt với kết quả kiểm chứng readiness và bằng chứng mới.

Sol/Lead chạy lệnh và gửi bản Markdown mặc định cho Owner tại mốc cần quyết
định hoặc thử sản phẩm. Owner không cần chạy CLI hay đọc packet. Script tạo
báo cáo từ hồ sơ đã lưu, không gọi Gemini/Codex; báo cáo ghi rõ ai thực hiện
bước tiếp theo. Bản Lead/JSON dành cho Sol hoặc tác nhân điều phối kỹ thuật.

Theo [spec](V10_CANONICAL_SPEC.md#small-project-execution-and-reporting), Gemini
thực hiện vòng code–test–sửa khi routing hiện hành cho phép. Lead đọc bản báo
cáo tại mốc hoàn thành hoặc khi có blocker; reviewer tiếp tục nhận source và
bằng chứng đầy đủ. Test tập trung dùng trong lúc sửa, bộ gate đã chốt dùng
ở cuối tính năng. Bộ test nội bộ V10 dành cho việc kiểm tra bộ công cụ này.

Usage lấy từ receipt của provider; unavailable biểu thị thiếu dữ liệu. Kích
thước báo cáo đo lượng văn bản, không quy đổi thành token hoặc quota. Chênh
lệch token thực tế cần một pilot riêng dùng tài khoản thật.

## Tiếp tục từ hồ sơ

Lệnh trạng thái cho packet Google-worker-first: `node scripts/workflow.mjs status <task> <evidence> <review> <repo> <bridge-config>`. Tham số cuối cung cấp cấu hình reviewer kỳ vọng cho cùng phép kiểm tra readiness được bridge sử dụng.

Khi tiến trình kết thúc bất thường, run packet giữ in-flight marker, session và diff để Lead đối chiếu trước lần thao tác tiếp theo. `status` đọc checkpoint hiện có. Task mới dùng cấu hình mẫu [BRIDGE_CONFIG.controlled.example.json](BRIDGE_CONFIG.controlled.example.json); `BRIDGE_CONFIG.example.json` chỉ còn phục vụ compatibility với task legacy.

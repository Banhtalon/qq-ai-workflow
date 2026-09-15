# QQ AI Workflow v10 — Personal Local
Version: **10.1.0-rc.1** · Stage: **sequential CLI bridge; LOCAL_AUTO requires quota-drill activation**

Một Codex nhận yêu cầu, tự làm hoặc giao worker Google qua Antigravity CLI, kiểm thử,
gọi reviewer độc lập, sửa lỗi và đưa bản dùng thử cho Owner. Dành cho một người dùng,
dự án nhỏ trên Windows. ChatGPT web là nơi bàn ý tưởng tùy chọn.

## Bắt đầu
Đọc [hướng dẫn Owner](.ai-workflow/OWNER_GUIDE.md), sau đó giao yêu cầu trong Codex:
“Đọc AGENTS.md và .ai-workflow/BOOTSTRAP.md. Tiếp tục công việc hiện tại theo v10.”

[Spec](.ai-workflow/V10_CANONICAL_SPEC.md) là luật duy nhất cho task đã chuyển sang v10.
[Migration](.ai-workflow/MIGRATION.md) hướng dẫn chuyển dự án cũ; không tự chuyển
TASK-11 của mindx-review-bot.
Xem [CHANGELOG](CHANGELOG.md) để theo dõi các mốc release.

**Dự án mới → Controlled Delegation. `GEMINI_FIRST_V1` chỉ dùng cho task legacy.**
Task mới được khởi tạo với `CONTROLLED_DELEGATION_V1`; `CONTROLLED_DELEGATION_V2`
là lựa chọn tiết kiệm lượt Codex với tuyến Gemini → Luna khi task contract chọn rõ.
Task mới dùng `.ai-workflow/templates/task.json` hoặc lệnh `workflow.mjs init`; cấu hình
bridge mẫu tương ứng là [.ai-workflow/BRIDGE_CONFIG.controlled.example.json](.ai-workflow/BRIDGE_CONFIG.controlled.example.json).

## Có gì ở bản này
- Lead gộp điều phối, thao tác kỹ thuật và có thể implement.
- Quy tắc chọn model theo độ khó và rủi ro; review theo tính năng.
- Contract yêu cầu/kiểm thử được chốt trước code; evidence gắn đúng commit.
- Công cụ local: chốt contract, chạy gates có che thông tin nhạy cảm,
  kiểm tra gói kết quả, đề xuất route và báo trạng thái.
- [Cầu nối CLI tuần tự](.ai-workflow/CLI_BRIDGE.md): worker Google qua Antigravity CLI → kiểm thử → reviewer Codex → sửa,
  có checkpoint và giới hạn sửa. Mặc định ASSISTED; chỉ bật LOCAL_AUTO sau pilot thật
  và quota drill kiểm tra dừng/tiếp tục khi hết hạn mức.
  Không tự đăng nhập, không tự mua credit, không có scheduler nền.
- Execution identity được ghi tách biệt theo role, provider, CLI, requested model,
  observed model, session và provider-reported usage; không suy đoán model thực tế từ config.
- [Luồng Nhanh bằng máy](.ai-workflow/FAST_LANE.md): chỉ định tuyến thay đổi tài liệu
  thuộc allowlist cố định; mọi trường hợp không chứng minh được đều quay về Luồng Tính năng.

### Binding `CONTROLLED_DELEGATION_V2`

| Vai trò | Model và effort |
| --- | --- |
| LEAD | `gpt-5.6-sol` · `medium` |
| Khảo sát, triển khai, test, sửa | `gemini-3.8-flash-high` qua Antigravity CLI (`agy`) |
| Worker dự phòng | `gpt-5.6-luna` · `max` |
| Reviewer thông thường | `gpt-5.6-terra` · `xhigh` |
| Senior và reviewer rủi ro cao | `gpt-5.6-sol` · `medium`, phiên độc lập |

Model yêu cầu và model provider báo cáo được ghi riêng trong receipt. `gpt-6-terra`
không thuộc binding của bản này; `gpt-5.6-terra` là binding reviewer của V2.

Không có reviewer hoặc kết nối thì Lead lưu việc đang chờ; không giả lập review
thành công và không yêu cầu Owner chuyển từng gói kỹ thuật.

## Kiểm tra bộ template
Node.js 20+; không có npm dependency.
```text
npm test
npm run test:v2
npm run workflow:check
npm run pilot
```
Pilot dùng Git repo tạm và chương trình test giả lập; không gọi model hoặc dịch vụ thật.

Công cụ cho Lead (Owner không cần chạy):
```text
node scripts/workflow.mjs init TASK-123
node scripts/workflow.mjs freeze <task.json>
node scripts/bridge.mjs doctor <controlled-config.json> <repo> <doctor-packets> --probe
node scripts/bridge.mjs pilot <controlled-config.json> <frozen-task.json> <repo> <run-packets>
node scripts/bridge.mjs resume <controlled-config.json> <frozen-task.json> <repo> <run-packets> --pilot
node scripts/bridge.mjs status <run-packets>
node scripts/bridge.mjs report <run-packets> --audience owner --format md
node scripts/bridge.mjs quota-drill <controlled-config.json> <accepted-pilot-packets> <activation-packets>
node scripts/bridge.mjs activate <controlled-config.json> <accepted-pilot-packets> <activation-packets>
```
`init` tạo `.workflow-local/TASK-123.json` từ HEAD hiện tại và không freeze hay ghi đè
task đã có. Lead chỉnh goal, scope, gates và Product Check trước khi freeze. Các file
task/evidence trong `.workflow-local/` đã gitignore; profile example là mẫu, không
chứng minh tài khoản đã sẵn sàng.

Kiểm tra nhanh CLI trên Windows:

```text
agy --version
agy models
codex --version
codex login status
```

Tài khoản tiếp tục do CLI chính thức quản lý; thông tin đăng nhập không nằm trong packet.

Với task có giao diện, `product_check.command` là phần cấu hình theo từng dự án trước
khi chạy. File config mẫu không bịa runner dùng chung; nếu thiếu runner, Controlled
Delegation dừng ở bước chờ Product Check thay vì tự ghi PASS.

Các lệnh `workflow.mjs route`, `verify` và `status` được giữ cho task v10/GEMINI_FIRST
legacy; flow Controlled mới thực thi và resume qua `bridge.mjs`.

## Khôi phục v9

Tag chú thích `v9.1.2` giữ bản v9 tại commit
`c68750f80d276534867287ffe02689f346be8b8d`. Để xem hoặc phục hồi mà không
ghi đè checkout hiện tại, tạo thư mục làm việc riêng:

```text
git worktree add ..\qq-ai-workflow-v9 v9.1.2
```

Xem [hướng dẫn khôi phục](.ai-workflow/MIGRATION.md#khôi-phục-v9). Bộ v10 không
cung cấp mức cách ly quyền Controller/Implementer hoặc kiểm chứng chống sửa giả
của v9. Xem [giới hạn](.ai-workflow/V10_CANONICAL_SPEC.md).

Route legacy chấp nhận --needs-repair khi xử lý lỗi và --quota-exhausted khi hết hạn mức.
`bridge.mjs` thực thi flow Controlled tuần tự, lưu counter thực tế và dừng khi kết quả
thao tác chưa rõ.

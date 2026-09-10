# QQ AI Workflow v10

Quy trình AI cục bộ cho một người làm dự án nhỏ trên Windows. Bạn mô tả tính năng;
Lead điều phối phần kỹ thuật; worker triển khai; các kiểm tra tự động và reviewer độc
lập xem lại kết quả trước khi bạn dùng thử.

**Phiên bản:** `10.0.0-rc.1` · **Môi trường:** Windows, Node.js 20+, tài khoản CLI theo gói thuê bao.

## QQ AI Workflow giải quyết gì?

QQ AI Workflow giúp biến một yêu cầu sản phẩm thành vòng làm việc có điểm dừng rõ ràng:

```text
Owner nêu nhu cầu → Lead chốt phạm vi → worker thực hiện
     → kiểm tra tự động → reviewer độc lập → Owner dùng thử
```

- **Owner** quyết định hành vi sản phẩm, đăng nhập khi cần và xác nhận bản dùng thử.
- **Lead** là đầu mối kỹ thuật: đọc trạng thái dự án, điều phối và báo tiến độ ngắn gọn.
- **Worker** xử lý một phần việc đã xác định; **reviewer** kiểm tra lại ở một phiên độc lập.

Quy trình này phù hợp với dự án cá nhân hoặc nhóm rất nhỏ cần làm việc có checkpoint
(mốc lưu trạng thái để tiếp tục an toàn), không phù hợp để thay thế hệ thống vận hành production.

## Bắt đầu nhanh

Clone repo, mở Codex tại thư mục dự án, rồi chạy các kiểm tra template:

```text
node --version
npm test
npm run workflow:check
npm run pilot
```

Không có npm dependency. `pilot` dùng Git repo tạm và dữ liệu mô phỏng; lệnh này không gọi model hay dịch vụ bên ngoài.

Khi muốn bắt đầu một công việc, Owner có thể gửi cho Codex:

> Đọc `AGENTS.md` và `.ai-workflow/BOOTSTRAP.md`. Tiếp tục công việc hiện tại theo v10.

Xem [Hướng dẫn Owner](.ai-workflow/OWNER_GUIDE.md) để biết các trạng thái thường gặp
như `WAITING_QUOTA` (hết hạn mức), `WAITING_CAPABILITY` (thiếu công cụ hoặc đăng nhập)
và `READY_FOR_OWNER` (đã sẵn sàng dùng thử).

## Chọn cách vận hành

| Cách vận hành | Dùng khi | Ý nghĩa ngắn gọn |
| --- | --- | --- |
| `ASSISTED` | Mới bắt đầu hoặc cần Lead giám sát | Lead điều phối từng bước và lưu checkpoint. |
| `LOCAL_AUTO` | Bridge đã có pilot Windows và activation record | Cầu nối CLI tuần tự hỗ trợ worker → kiểm tra → review → sửa. |

`LOCAL_AUTO` không thể suy ra từ một lần chạy test. Điều kiện và giới hạn hiện hành
nằm trong [V10 canonical spec](.ai-workflow/V10_CANONICAL_SPEC.md#stage-boundary).

## Phạm vi an toàn

- Thiết kế không bao gồm mua API credit, tự đăng nhập tài khoản hay scheduler nền.
- Khi thiếu hạn mức, quyền hoặc kết quả thao tác chưa rõ, checkpoint được giữ để Lead đối chiếu trước bước tiếp theo.
- Kết quả local là bằng chứng cho môi trường local; nó không tự xác nhận hosted, production hoặc dữ liệu thật.

## Tài liệu theo nhu cầu

| Bạn cần làm gì? | Đọc tài liệu |
| --- | --- |
| Hiểu vai trò Owner và cách nghiệm thu | [OWNER_GUIDE.md](.ai-workflow/OWNER_GUIDE.md) |
| Xem quy tắc v10 và giới hạn quy trình | [V10_CANONICAL_SPEC.md](.ai-workflow/V10_CANONICAL_SPEC.md) |
| Chạy hoặc khôi phục cầu nối CLI trên Windows | [CLI_BRIDGE.md](.ai-workflow/CLI_BRIDGE.md) |
| Xem lệnh workflow cơ bản | [BOOTSTRAP.md](.ai-workflow/BOOTSTRAP.md) |
| Định tuyến thay đổi tài liệu | [FAST_LANE.md](.ai-workflow/FAST_LANE.md) |
| Chuyển dự án cũ hoặc xem lại v9 | [MIGRATION.md](.ai-workflow/MIGRATION.md) |
| Dùng prompt mẫu cho Owner | [OWNER_QUICK_PROMPTS.md](.ai-workflow/prompts/OWNER_QUICK_PROMPTS.md) |

## Lệnh cho Lead

Các file task, evidence và checkpoint nằm trong `.workflow-local/` và không theo Git.

```text
node scripts/workflow.mjs freeze <task.json>
node scripts/workflow.mjs route <task.json> <profile.json>
node scripts/workflow.mjs verify <task.json> <repo-directory> <evidence.json>
node scripts/workflow.mjs status <task.json> <evidence.json> <review.json> <repo-directory>
```

Chi tiết lệnh bridge, packet review và quy trình tiếp tục sau gián đoạn nằm ở
[CLI_BRIDGE.md](.ai-workflow/CLI_BRIDGE.md).

## Xem lại v9.1.2

Tag `v9.1.2` lưu bản v9 tại commit `c68750f80d276534867287ffe02689f346be8b8d`.
Tạo working directory riêng để xem lại mà không động vào checkout hiện tại:

```text
git worktree add ..\qq-ai-workflow-v9 v9.1.2
```

Xem [hướng dẫn migration và khôi phục](.ai-workflow/MIGRATION.md#khôi-phục-v9) trước khi dùng lại nội dung v9.

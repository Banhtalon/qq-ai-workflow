# Routing v10

Định tuyến model, giới hạn sửa và trạng thái chờ được định nghĩa tại [quy tắc workflow v10](V10_CANONICAL_SPEC.md#routing-and-budgets).
`node scripts/workflow.mjs route` là lệnh xem đề xuất định tuyến. Trang này không bổ sung quy tắc workflow.

Hai mã chính sách hiện có là `CONTROLLED_DELEGATION_V1` và `CONTROLLED_DELEGATION_V2`. Binding, effort, ngân sách và điều kiện fallback chỉ được định nghĩa trong canonical spec.

Task mới mặc định dùng V1 và file mẫu `BRIDGE_CONFIG.controlled.example.json` tương ứng
với tuyến V1. Task chọn V2 cần policy và bridge configuration cùng khớp.

Binding đọc nhanh của V2:

| Vai trò | Model | Effort |
| --- | --- | --- |
| Lead | `gpt-5.6-sol` | `medium` |
| Worker chính | `gemini-3.8-flash-high` | — |
| Worker dự phòng | `gpt-5.6-luna` | `max` |
| Reviewer thông thường | `gpt-5.6-terra` | `xhigh` |
| Senior | `gpt-5.6-sol` | `medium` |
| Reviewer rủi ro cao | `gpt-5.6-sol` | `medium` |

Model `gpt-6-astra` thuộc binding V1; `gpt-6-terra` không nằm trong danh sách V2.

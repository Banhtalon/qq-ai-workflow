# Local packet schema

Các JSON packet dùng các schema `qq.workflow.task.v10`, `qq.workflow.profile.v10`, `qq.workflow.evidence.v10` và `qq.workflow.review.v10`.

`task.json` lưu ID task, revision, base SHA, mục tiêu, tiêu chí, gates, mức rủi ro, độ phức tạp, head ứng viên, session, bộ đếm và nghiệm thu.
`execution` tùy chọn lưu policy `GEMINI_FIRST_V1` (tên schema tương thích v10; không có nghĩa là dùng Gemini CLI), prepared, local_synthetic, rationale, design_sessions và browser_required. `ui_evidence` lưu head, contract_sha256, URL local, status và checks gồm action/observed/passed. Config bridge có elevated_reviewer; profile có elevated_review. Trường usage trong lượt CLI chứa số liệu provider hoặc null.

Execution identity phải được hiểu theo các trường độc lập: `role` là trách nhiệm workflow; `provider` là dịch vụ/tài khoản; `cli` là executable thực tế; `requested_model` là model được yêu cầu; `observed_models` là model do provider/CLI báo cáo; `session_id` là phiên thực thi; `usage` là số liệu provider hoặc null. Không được suy ra observed model từ requested model.

`task.json.lock.json` lưu hash contract và risk floor. `evidence.json` lưu head, hash, lệnh gate, timeout, mã thoát và output đã redaction. `review.json` lưu session reviewer, verdict, finding, summary và kết quả kiểm tra rủi ro.

`node scripts/workflow.mjs` đọc và kiểm tra các packet này. Quy tắc workflow, trạng thái và điều kiện review nằm tại [V10 canonical spec](V10_CANONICAL_SPEC.md).

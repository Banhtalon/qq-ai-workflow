# Local packet schema

Các JSON packet dùng các schema `qq.workflow.task.v10`, `qq.workflow.profile.v10`, `qq.workflow.evidence.v10` và `qq.workflow.review.v10`.

`task.json` lưu ID task, revision, base SHA, mục tiêu, tiêu chí, gates, mức rủi ro, độ phức tạp, head ứng viên, session, bộ đếm và nghiệm thu.
`execution` tùy chọn lưu policy `CONTROLLED_DELEGATION_V1`, `CONTROLLED_DELEGATION_V2`
hoặc `GEMINI_FIRST_V1` (tên schema tương thích v10; không có nghĩa là dùng Gemini CLI),
prepared, local_synthetic, rationale, design_sessions và browser_required. `ui_evidence`
lưu head, contract_sha256, URL local, status và checks gồm action/observed/passed. Config
bridge có `fallback_worker` cho V2 và `elevated_reviewer`; profile có `elevated_review`.
Trường usage trong lượt CLI chứa số liệu provider hoặc null.

Execution identity được biểu diễn bằng các trường độc lập: `role` là trách nhiệm workflow; `provider` là dịch vụ/tài khoản; `cli` là executable thực tế; `requested_model` là model được yêu cầu; `observed_models` là model do provider/CLI báo cáo; `session_id` là phiên thực thi; `usage` là số liệu provider hoặc null. Giá trị observed model được lấy từ dữ liệu provider/CLI, tách khỏi requested model.

`task.json.lock.json` lưu hash contract và risk floor. `evidence.json` lưu head, hash, lệnh gate, timeout, mã thoát và output đã redaction. `review.json` lưu session reviewer, verdict, finding, summary và kết quả kiểm tra rủi ro.

Ngân sách thực thi dùng schema `qq.workflow.budget.v1` hoặc `qq.workflow.budget.v2`. Schema
V2 bổ sung `active_worker`, `fallback_occurred`, `fallback_reason`, `failed_invocations`
và `handoff_history`; các trường này liên kết trạng thái worker, nguyên nhân chuyển tuyến,
lịch sử gọi lỗi và checkpoint handoff. Giới hạn và ý nghĩa chuẩn của chúng nằm trong
canonical spec.

Mỗi invocation Controlled có assignment receipt trước khi gọi và execution receipt trên
mọi đường kết thúc. Receipt giữ riêng `requested_model`, `observed_models`, `session_id`
và `usage`; report tổng hợp thêm bảng requested-versus-observed mà không suy đoán dữ liệu
provider còn thiếu.

`node scripts/workflow.mjs` đọc và kiểm tra các packet này. Quy tắc workflow, trạng thái và điều kiện review nằm tại [V10 canonical spec](V10_CANONICAL_SPEC.md).

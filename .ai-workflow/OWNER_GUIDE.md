# Hướng dẫn Owner

Bạn mở Codex trong thư mục dự án và mô tả tính năng mong muốn. AI đọc task hiện tại, xử lý phần kỹ thuật và báo khi có bản dùng thử.

Khi nhận `WAITING_QUOTA` (hết hạn mức) hoặc `WAITING_CAPABILITY` (thiếu công cụ hoặc đăng nhập), báo cáo nêu checkpoint đang giữ và bước tiếp theo. Khi nhận `BLOCKED_TECHNICAL` (vướng kỹ thuật), báo cáo nêu lỗi còn lại và phạm vi cần làm rõ. `READY_FOR_OWNER` kèm các bước dùng thử; `DONE` ghi nhận nghiệm thu.

Ví dụ yêu cầu: “Thêm bộ lọc nhận xét theo lớp; đổi lớp vẫn giữ ghi chú chưa lưu.”

Bạn quyết định cách ứng dụng hoạt động, đăng nhập khi cần, dùng thử và duyệt merge. [V10 canonical spec](V10_CANONICAL_SPEC.md) là nguồn quy tắc workflow duy nhất; [Owner status](OWNER_STATUS.md) có mẫu báo cáo ngắn.

## Luồng hiện tại

Bản `10.1.0-rc.1` có cầu nối CLI tuần tự cho worker Google qua Antigravity (`agy`) và
reviewer/senior qua Codex CLI. Task mới dùng Controlled Delegation V1 theo mặc định; V2
là tuyến tùy chọn với worker Gemini, Luna dự phòng, receipt requested-versus-observed và
báo cáo trạng thái fallback.

Owner thường chỉ cần mô tả tính năng, đăng nhập khi CLI yêu cầu, dùng thử bản Lead đưa ra
và phản hồi kết quả. Owner không cần tự đọc packet hoặc chạy bộ test nội bộ của workflow.

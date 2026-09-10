# Owner status

Trạng thái và bằng chứng gốc nằm tại [V10 canonical spec](V10_CANONICAL_SPEC.md#state-and-evidence).
Báo cáo cho Owner nên ngắn: đã làm gì, đã kiểm tra gì, còn vướng gì, cách dùng thử và quyết định cần có.

## Ví dụ trạng thái chờ

`WAITING_QUOTA` (hết hạn mức): “Cầu nối đã dừng sau lượt reviewer vì hết hạn mức. Bản đang giữ ở commit `abc123`; chưa chạy lại thao tác có kết quả chưa rõ. Khi hạn mức trở lại, Lead sẽ kiểm tra checkpoint rồi tiếp tục.”

`BLOCKED_TECHNICAL` (vướng kỹ thuật): “Đã dùng hết số lượt sửa trong task này nhưng kiểm thử `npm test` còn lỗi X. Bản và bằng chứng vẫn giữ ở commit `abc123`. Cần một quyết định phạm vi mới hoặc hướng kỹ thuật mới trước khi tạo revision khác.”

`READY_FOR_OWNER`: nêu 3–5 bước dùng thử, build/head đang được kiểm tra và hành vi mong đợi.

`DONE`: ghi nhận nghiệm thu; việc merge được xử lý riêng theo [V10 canonical spec](V10_CANONICAL_SPEC.md).

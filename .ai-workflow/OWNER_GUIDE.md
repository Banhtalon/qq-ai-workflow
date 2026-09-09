# Cách làm việc với v10
Bạn mở Codex trong thư mục dự án và nói tính năng muốn làm.
Codex đọc tiến độ, tự xử lý kỹ thuật và báo khi có bản dùng thử.
ChatGPT web chỉ cần dùng khi muốn bàn ý tưởng dài; chuyển bản yêu cầu đã chốt một lần.

Ví dụ: “Thêm bộ lọc nhận xét theo lớp; đổi lớp không được mất ghi chú chưa lưu.”
Lead ghi tiêu chí, giao phần phù hợp, chạy kiểm tra; reviewer xem lại tính năng.
Có lỗi thì hai AI chuyển sửa bằng file/công cụ. Bạn nhận hướng dẫn thử:
chọn lớp A, nhập ghi chú, chuyển lớp B, quay lại A và kiểm tra nội dung còn nguyên.

Bạn quyết định cách ứng dụng hoạt động, đăng nhập khi cần, dùng thử và duyệt merge.
Bạn không đọc diff, CI, SQL hay lựa chọn model từng lượt.
Nếu bị kẹt, AI phải báo đang giữ bản nào, vướng gì, và phương án tiếp theo.

Template hiện đã có cầu nối CLI tuần tự cho Windows. Ở chế độ ASSISTED, Lead có thể
chạy worker → gates → fresh reviewer → repair bằng Codex CLI và Antigravity CLI,
không cần Owner chuyển từng gói kỹ thuật giữa hai AI. Bridge không tự đăng nhập,
không tự mua credit và không tự fallback sang API trả phí.

LOCAL_AUTO vẫn tắt mặc định. Chỉ bật sau khi đã có pilot thật đáp ứng điều kiện trong
CLI_BRIDGE.md, gồm probe account/model hợp lệ, repair/review hoàn chỉnh và một lần
quota pause → resume an toàn khi tình huống đó xảy ra tự nhiên. Nếu thiếu CLI,
reviewer, quyền hoặc quota, Lead giữ checkpoint và báo trạng thái chờ; không được
coi task là đã review hoặc DONE khi bằng chứng cuối chưa hợp lệ.

# V10 cho dự án nhỏ: Gemini thực hiện, Codex kiểm chứng

## Mục tiêu và phạm vi

Giảm log và lịch sử lặp mà Codex phải đọc, giữ nguyên điều kiện nghiệm thu.
Owner mô tả nhu cầu, quyết định sản phẩm và thử bản local. Sol/Lead điều phối
theo mốc; Gemini code, test, sửa khi routing hiện hành cho phép; reviewer
Codex độc lập kiểm tra bản cuối. Senior/elevated reviewer theo luật hiện có.

Checkout: `F:\MINDX_project test\qq_ai_workflow`, base quan sát `5572037`.
Bảo toàn phần đồng bộ phiên bản và docs đang sửa dở. Không tích hợp MAC,
SQLite, scheduler, nhiều writer, API trả phí hoặc tự bật LOCAL_AUTO.

## Các phần triển khai

1. Bổ sung nguyên tắc thực hiện theo mốc trong spec chính, không tạo routing mới.
2. Thêm `node scripts/bridge.mjs report <packets> --audience owner|lead --format json|md`.
   Mặc định owner/md; chỉ đọc, stdout, tối đa 8192 byte UTF-8. Rút gọn có
   thông báo và tham chiếu, giữ dấu hiệu blocker. Báo cáo không chứng nhận PASS.
3. Owner nhận mục tiêu, trạng thái, blocker và bước tiếp theo. Lead nhận thêm
   identity task/head, lịch sử đã xác nhận, gate, ngân sách và receipt usage.
   Chỉ hiển thị URL/thao tác local có evidence khớp; không suy đoán observed model.
4. Dùng checkpoint/resume hiện có. Thao tác chưa rõ cần đối soát; không tự chạy
   lại hoặc hứa khôi phục trí nhớ model. Không ghi lại packet lịch sử.
5. Test theo ảnh hưởng khi sửa; cuối tính năng chạy các gate đã chốt. Reviewer
   giữ source đầy đủ. Byte và token không được quy đổi cho nhau; usage thiếu
   giữ unavailable. Pilot model thật thuộc task tiếp theo.

## Kiểm thử và bàn giao

Kiểm tra report cho trạng thái hoàn thành/thiếu evidence/lỗi gate/review yêu
cầu sửa/chờ quota/in-flight chưa rõ; redaction, giới hạn byte, usage thiếu,
identity, tính chỉ đọc và tương thích CLI. Fixture chứng minh dữ liệu tóm
tắt nhỏ hơn hồ sơ đầy đủ, không suy ra phần trăm tiết kiệm token.

Chạy test tập trung khi phát triển; trên bản cuối chạy npm test,
npm run workflow:check, npm run pilot, git diff --check và review độc lập.
Review bản chưa commit gắn fingerprint các file thay đổi và base HEAD;
không trình bày nó là nghiệm thu một commit đã phát hành.

Không tăng phiên bản, commit, push, merge, release hoặc triển khai sang host.
Giữ ngân sách sửa, Product Check, Owner acceptance và quyền publish hiện có.

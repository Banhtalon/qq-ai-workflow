# Luồng Nhanh bằng máy

Luồng Nhanh chỉ định tuyến thay đổi tài liệu có rủi ro thấp. Nó không thay thế
Luồng Tính năng và không nhận diện thay đổi chỉ có comment.

## Điều kiện

Chạy bộ phân loại từ checkout sạch, với remote origin có nhánh main. Công cụ lấy
commit gốc, allowlist và mã bộ phân loại trực tiếp từ origin/main. Vì vậy một
candidate không thể tự sửa allowlist hay bộ phân loại rồi dùng chúng để tự cấp
Luồng Nhanh.

Hai nhóm đường dẫn duy nhất được phép là:

- docs/user-guide/**/*.md
- docs/tutorials/**/*.md

Mọi thay đổi tới allowlist, bộ phân loại, fixture, AGENTS.md, GEMINI.md, file
nhị phân, symlink, thay đổi quyền thực thi, hoặc bất kỳ đường dẫn nào khác đều
được định tuyến về Luồng Tính năng. Khi đổi tên, cả đường dẫn cũ và mới phải
thuộc allowlist.

## Dùng công cụ

Tạo kết quả trong thư mục .workflow-local đã bị Git bỏ qua:

    node scripts/fast-lane.mjs classify . .workflow-local/fast-lane-result.json

Kết quả chứa base, head, hash allowlist, hash bộ phân loại và decision hash.
Trước khi dùng kết quả để định tuyến, kiểm tra lại:

    node scripts/fast-lane.mjs route . .workflow-local/fast-lane-result.json

Nếu HEAD, origin/main hoặc decision hash đã thay đổi, lệnh route trả về
FEATURE_FLOW với lý do STALE_DECISION_RECHECK_REQUIRED. Hãy phân loại lại hoặc
đi theo Luồng Tính năng.

Không có PASS khi không thể xác minh remote main, commit gốc, checkout sạch,
hoặc nguồn phân loại tin cậy. Các trường hợp đó phải đi Luồng Tính năng.

# Điều chỉnh phân công model để tiết kiệm token Codex

## 1. Mục tiêu và đầu ra

Giữ chất lượng kiểm tra, giao Gemini toàn bộ vòng triển khai/test/sửa; chỉ dùng Codex dự phòng, điều phối và review theo mốc.

| Vai trò | Model |
|---|---|
| LEAD | GPT-5.6 Sol · Medium |
| Khảo sát, triển khai, test và sửa | Gemini 3.8 Flash High · effort `null` |
| Worker dự phòng | GPT-5.6 Luna · Max |
| Reviewer thông thường | GPT-5.6 Terra · Xhigh |
| Senior | GPT-5.6 Sol · Medium |
| Reviewer rủi ro cao | GPT-5.6 Sol · Medium, phiên độc lập |
| Chạy lệnh và tổng hợp bằng chứng | Node/scripts, không dùng model |

Model và reasoning phải được kiểm tra qua CLI thực tế; không tự thay model khi cấu hình yêu cầu không được hỗ trợ.

## 2. Chính sách thực thi đã chốt

- Worker có **một lượt triển khai ban đầu + bốn vòng sửa**, dùng chung giữa Gemini và Luna.
- Chuyển Gemini sang Luna khi lỗi gọi model hoặc lỗi thực thi của provider: không khả dụng, quota, kết nối, timeout hoặc kết quả không hợp lệ theo giao thức hiện có. Không chuyển chỉ vì test thất bại hoặc reviewer yêu cầu sửa mã.
- Lỗi phạm vi, phân quyền, hợp đồng hay bằng chứng không được dùng làm lý do chuyển model để vượt kiểm soát.
- Trước chuyển giao, phải xác nhận lượt Gemini đã kết thúc, đối soát thay đổi và checkpoint. Trạng thái chưa rõ thì dừng để đối soát; không khởi chạy Luna song song.
- Sau khi chuyển, Luna tiếp tục làm worker cho phần còn lại của task. Không tự chuyển qua lại Gemini/Luna.
- Lỗi gọi/thực thi không tiêu hao vòng sửa hoàn tất; phải lưu lịch sử lần gọi lỗi. Không đặt lại ngân sách khi đổi model, khởi động lại hoặc đổi revision.
- Luna không khả dụng thì lưu trạng thái WAIT/BLOCKED theo nguyên nhân; không tự chuyển senior vì lỗi hạ tầng và không dùng API trả phí.
- Sau bốn vòng sửa còn lỗi quan trọng, Sol senior có tối đa **hai lượt**: một lượt xử lý và một lượt sửa tiếp theo. Task đủ điều kiện đi senior ngay từ đầu cũng chỉ có hai lượt senior, không cộng thêm ngân sách worker.
- Hết ngân sách vẫn còn lỗi thì dừng và báo blocker.
- Reviewer rủi ro cao là phiên Sol riêng, không tham gia thiết kế hay triển khai tính năng. LEAD hoặc senior đã tham gia không được tự review.
- Giữ nguyên điều kiện FAST, Product Check và nghiệm thu Owner.

## 3. Thay đổi kỹ thuật

### Chính sách và tương thích

- Bổ sung `CONTROLLED_DELEGATION_V2` cho task mới; giữ nguyên hành vi và cách xác thực hồ sơ V1.
- Cập nhật canonical spec trước, rồi đồng bộ bộ chọn policy, validation, runner, receipt, report và tài liệu. Không thay toàn cục các hằng Astra của V1.
- Task V2 đóng băng cấu hình worker, `fallback_worker`, reviewer, senior, elevated reviewer và ngân sách trong hợp đồng/configuration digest.
- Dùng budget schema V2 để biểu diễn worker ban đầu, bốn vòng sửa dùng chung, hai lượt senior và worker đang hoạt động. Lưu nguyên nhân chuyển giao cùng tham chiếu lần gọi nguồn/đích.
- Hồ sơ thực thi phải xác thực model/effort theo policy của task; phân biệt model yêu cầu với model provider thực sự báo cáo.
- Không chuyển đổi packet đang chạy hoặc nâng ngân sách task V1. Không sửa cấu hình tài khoản đang hoạt động, tự bật LOCAL_AUTO hay thay bộ kiểm tra CI.

### Runner và khôi phục

- Thực hiện chuyển giao dưới cơ chế một writer và checkpoint hiện có.
- Chỉ kiểm tra khả năng Luna khi cần fallback; Luna không khả dụng không được chặn một lượt Gemini khỏe.
- Lưu chuyển giao trước khi gọi Luna; resume phải tiếp tục đúng worker và bộ đếm, không gọi lại lượt có trạng thái chưa rõ.
- Việc xác thực checkpoint phải phát hiện chỉnh sửa bộ đếm, model, effort, policy hoặc lịch sử chuyển giao.

### Giảm nội dung Codex phải xử lý

- Worker tự đọc log và xử lý vòng test/sửa trong ngân sách.
- LEAD nhận báo cáo khi hoàn thành, blocker, chuyển worker hoặc hết ngân sách; không hỏi tiến độ liên tục.
- Mở rộng báo cáo hiện có bằng worker đang hoạt động, nguyên nhân fallback, vòng sửa đã dùng/còn lại, lượt senior và bước tiếp theo.
- Giữ giới hạn báo cáo 8 KiB; log đầy đủ lưu bằng chứng và chỉ mở khi cần. Reviewer vẫn được cung cấp nguồn và bằng chứng cần thiết.
- Usage thiếu phải ghi unavailable; không quy đổi byte báo cáo thành token hoặc phần trăm quota.

## 4. Kiểm thử và nghiệm thu

- V1 vẫn dùng ngân sách/model cũ; V2 dùng đúng bảng phân công mới.
- Test thất bại không kích hoạt fallback; lỗi gọi/thực thi Gemini kích hoạt Luna sau đối soát.
- Lỗi phạm vi hoặc bằng chứng bị chỉnh sửa phải dừng, không chuyển model.
- Chuyển ở lượt đầu hoặc giữa vòng sửa đều giữ bộ đếm; lượt sửa thứ năm bị chặn và chuyển senior đúng điều kiện.
- Sol không vượt hai lượt; reviewer Sol không được trùng phiên thiết kế/triển khai.
- Kiểm tra khởi động lại tại các điểm trước/sau ghi chuyển giao và trước/sau gọi Luna; không tạo hai writer hoặc thực thi lặp.
- Kiểm tra model/effort sai, cả hai worker không khả dụng, quota, output không hợp lệ và packet bị sửa.
- Kiểm tra báo cáo không làm mất blocker, không lộ dữ liệu nhạy cảm và không tự chứng nhận PASS.
- Chạy test liên quan trong từng bước; trên bản cuối chạy `npm test`, `npm run workflow:check`, `npm run pilot`, `git diff --check` và review độc lập.
- Thực hiện pilot Windows riêng với task mẫu và lỗi Gemini có kiểm soát để chứng minh Luna nhận việc thật. Kiểm thử mô phỏng không thay bằng chứng khả năng tài khoản.
- Chỉ báo mức tiết kiệm token khi có số liệu thực tế; kết quả kỹ thuật không đồng nghĩa đã chứng minh tiết kiệm quota.

## 5. Trình tự và giới hạn triển khai

1. Kiểm tra lại HEAD, trạng thái Git và hướng dẫn repo; bảo toàn `docs/superpowers/` đang untracked cùng mọi thay đổi phát sinh.
2. Lưu file kế hoạch, cập nhật hợp đồng V2 và viết test cho routing/ngân sách trước khi sửa runner.
3. Triển khai lần lượt policy → validation/receipt → fallback/resume → report/tài liệu bằng một writer.
4. Chạy kiểm tra cuối, review độc lập, rồi pilot tài khoản thật nếu công cụ sẵn sàng; thiếu khả năng thì ghi blocker cụ thể.
5. Bàn giao diff, kết quả kiểm tra, bằng chứng pilot và hướng dẫn dùng V2 cho task mới.

Không commit, push, merge, release, thay `.env`, sửa packet cũ hoặc triển khai sang dự án khác trong phạm vi kế hoạch này.

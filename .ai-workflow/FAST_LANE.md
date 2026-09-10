# Luồng Nhanh bằng máy

[Quy tắc Fast Lane](V10_CANONICAL_SPEC.md#machine-fast-lane) nằm trong V10 canonical spec. Trang này mô tả lệnh tạo và dùng decision packet.

```text
node scripts/fast-lane.mjs classify . .workflow-local/fast-lane-result.json
node scripts/fast-lane.mjs route . .workflow-local/fast-lane-result.json
```

`classify` ghi base, head, hash allowlist, hash classifier và decision hash vào `.workflow-local/fast-lane-result.json`. `route` đọc packet này và trả route hiện tại.

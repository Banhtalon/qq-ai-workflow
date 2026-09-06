import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const taskArg = process.argv[2];
if (!taskArg) {
  console.error("Usage: node scripts/owner-status.mjs <task.json> [output.md]");
  process.exit(64);
}

const task = JSON.parse(await readFile(path.resolve(taskArg), "utf8"));
const mappings = {
  DONE: "DONE",
  OWNER_ACCEPTANCE: "READY_FOR_OWNER_TEST",
  BLOCKED_OWNER: "WAITING_FOR_OWNER",
  BLOCKED_EXTERNAL: "BLOCKED",
  ESCALATED_TECHNICAL: "BLOCKED",
};
const status = mappings[task.state] ?? "BLOCKED";
const ownerAction = task.owner_action || (status === "READY_FOR_OWNER_TEST" ? "Thử các hành vi trong mục owner_acceptance." : "NONE");
const text = `# Owner Status\n\nSTATUS: ${status}\n\nBạn yêu cầu:\n${task.title}\n\nHệ thống đã xác nhận:\n${task.owner_summary ?? "Chưa có đủ evidence để xác nhận hoàn thành."}\n\nBạn cần làm:\n${ownerAction}\n\nKhông cần bạn làm:\nĐọc code, kiểm tra CI/SQL/security, chọn model, debug kỹ thuật hoặc gửi secret.\n\nGiới hạn hiện tại:\n${task.current_limit ?? "Evidence hiện tại chỉ có giá trị ở tier đã ghi trong task."}\n`;
if (process.argv[3]) await writeFile(path.resolve(process.argv[3]), text, "utf8");
process.stdout.write(text);

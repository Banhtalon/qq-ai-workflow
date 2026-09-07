import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const targetIndex = process.argv.indexOf("--target");
const targetArg = targetIndex >= 0 ? process.argv[targetIndex + 1] : null;
if (!targetArg) {
  console.error("Usage: node scripts/install.mjs --target <existing-project-directory>");
  process.exit(64);
}
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = path.resolve(targetArg);
await access(targetRoot);
for (const protectedPath of [".ai-workflow", "AGENTS.md", "scripts/qq-ai-workflow"]) {
  try {
    await access(path.join(targetRoot, protectedPath));
    console.error(`BLOCKED: ${protectedPath} already exists; inventory and migrate it explicitly`);
    process.exit(73);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
await mkdir(path.join(targetRoot, "scripts"), { recursive: true });
await cp(path.join(sourceRoot, ".ai-workflow"), path.join(targetRoot, ".ai-workflow"), { recursive: true });
await cp(path.join(sourceRoot, "scripts"), path.join(targetRoot, "scripts", "qq-ai-workflow"), { recursive: true });
await cp(path.join(sourceRoot, "AGENTS.md"), path.join(targetRoot, "AGENTS.md"));
console.log(JSON.stringify({ status: "INSTALLED", target: targetRoot, routing_mode: "MANUAL" }, null, 2));

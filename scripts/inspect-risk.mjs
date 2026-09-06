import { readFile } from "node:fs/promises";
import path from "node:path";
import { classifyRisk, readJson, writeJson } from "./lib/workflow.mjs";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function listAfter(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return [];
  const values = [];
  for (let cursor = index + 1; cursor < process.argv.length && !process.argv[cursor].startsWith("--"); cursor += 1) {
    values.push(process.argv[cursor]);
  }
  return values;
}

const rulesPath = path.resolve(option("--rules", ".ai-workflow/RISK_RULES.json"));
const diffFile = option("--diff-file", null);
const decision = classifyRisk({
  paths: listAfter("--paths"),
  diffText: diffFile ? await readFile(path.resolve(diffFile), "utf8") : "",
  declared: option("--declared", "GREEN"),
  priorEffective: option("--prior", "GREEN"),
  complexity: option("--complexity", "S"),
  rules: await readJson(rulesPath),
});
const output = option("--output", null);
if (output) await writeJson(path.resolve(output), decision);
console.log(JSON.stringify(decision, null, 2));
if (decision.action === "STOP_AND_ESCALATE") process.exitCode = 20;

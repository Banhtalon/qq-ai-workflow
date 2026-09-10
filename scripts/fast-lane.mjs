#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  classifyCandidate,
  decisionJson,
  resultPathInsideIgnoredWorkspace,
  routeCandidate
} from "./lib/fast-lane.mjs";

function usage() {
  return [
    "Usage:",
    "  node scripts/fast-lane.mjs classify <repo> <ignored-result.json>",
    "  node scripts/fast-lane.mjs route <repo> <result.json>"
  ].join("\n");
}

function main(argv) {
  const [command, repoArgument, resultArgument] = argv;
  if (!command || !repoArgument || !resultArgument ||
      (command !== "classify" && command !== "route")) {
    throw new Error(usage());
  }
  const cwd = resolve(repoArgument);
  if (command === "classify") {
    const target = resultPathInsideIgnoredWorkspace(cwd, resultArgument);
    const result = classifyCandidate(cwd);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, decisionJson(result), "utf8");
    process.stdout.write(decisionJson(result));
    return;
  }
  const saved = JSON.parse(readFileSync(resolve(cwd, resultArgument), "utf8"));
  process.stdout.write(decisionJson(routeCandidate(cwd, saved)));
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write("FEATURE_FLOW: " + error.message + "\n");
  process.exitCode = 1;
}

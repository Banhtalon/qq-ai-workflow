import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export const ALLOWLIST_PATH = ".ai-workflow/fast-lane.allowlist.json";
export const CLASSIFIER_PATHS = [
  "scripts/fast-lane.mjs",
  "scripts/lib/fast-lane.mjs"
];
export const CONTROL_PATHS = new Set([
  ALLOWLIST_PATH,
  ...CLASSIFIER_PATHS,
  "test/fast-lane.test.mjs"
]);
export const REQUIRED_ALLOWLIST_PATHS = [
  "docs/user-guide/**/*.md",
  "docs/tutorials/**/*.md"
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBytes(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function gitText(cwd, args) {
  return gitBytes(cwd, args).toString("utf8").trim();
}

function gitSucceeds(cwd, args) {
  try {
    gitBytes(cwd, args);
    return true;
  } catch {
    return false;
  }
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function isPathAllowed(candidatePath) {
  return /^docs\/(?:user-guide|tutorials)\/(?:[^/]+\/)*[^/]+\.md$/u.test(candidatePath);
}

function isControlPath(candidatePath) {
  return CONTROL_PATHS.has(candidatePath) ||
    candidatePath.startsWith(".ai-workflow/fast-lane.fixtures/") ||
    candidatePath.startsWith("test/fixtures/");
}

function isInstructionPath(candidatePath) {
  const name = candidatePath.split("/").at(-1);
  return name === "AGENTS.md" || name === "GEMINI.md";
}

function isRegularFile(mode) {
  return mode === "000000" || mode.startsWith("100");
}

function executable(mode) {
  return (Number.parseInt(mode, 8) & 0o111) !== 0;
}

function parseRawDiff(raw) {
  const tokens = raw.toString("utf8").split("\0");
  tokens.pop();
  const entries = [];

  for (let index = 0; index < tokens.length;) {
    const header = tokens[index++];
    const match = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])([0-9]*)$/u.exec(header);
    if (!match) {
      throw new Error("Unable to parse Git raw diff header.");
    }
    const [, oldMode, newMode, oldObject, newObject, status, score] = match;
    const oldPath = tokens[index++];
    const newPath = status === "R" || status === "C" ? tokens[index++] : oldPath;
    if (oldPath === undefined || newPath === undefined) {
      throw new Error("Git raw diff ended before a path was provided.");
    }
    entries.push({
      kind: status + score,
      old_mode: oldMode,
      new_mode: newMode,
      old_object: oldObject,
      new_object: newObject,
      old_path: oldPath,
      new_path: newPath
    });
  }
  return entries;
}

function acceptedRemoteMain(cwd) {
  const lines = gitText(cwd, ["ls-remote", "--exit-code", "origin", "refs/heads/main"])
    .split(/\r?\n/u)
    .filter(Boolean);
  if (lines.length !== 1) {
    throw new Error("origin/main could not be resolved uniquely.");
  }
  const fields = lines[0].split(/\s+/u);
  if (!/^[0-9a-f]{40,64}$/u.test(fields[0]) || fields[1] !== "refs/heads/main") {
    throw new Error("origin/main returned an invalid reference.");
  }
  const base = fields[0].toLowerCase();
  if (!gitSucceeds(cwd, ["cat-file", "-e", base + "^{commit}"])) {
    throw new Error("The accepted origin/main commit is not available locally.");
  }
  return base;
}

function ensureCleanCandidate(cwd) {
  if (gitBytes(cwd, ["status", "--porcelain=v1", "-z"]).length !== 0) {
    throw new Error("Candidate checkout is not clean.");
  }
  return gitText(cwd, ["rev-parse", "HEAD"]).toLowerCase();
}

function readBaseBlob(cwd, base, repoPath) {
  return gitBytes(cwd, ["show", base + ":" + repoPath]);
}

function validateBaseAllowlist(bytes) {
  let allowlist;
  try {
    allowlist = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Accepted base allowlist is not valid JSON.");
  }
  const paths = allowlist?.paths;
  if (allowlist?.schema_version !== "qq.workflow.fast-lane.allowlist.v1" ||
      !Array.isArray(paths) ||
      paths.length !== REQUIRED_ALLOWLIST_PATHS.length ||
      paths.some((entry, index) => entry !== REQUIRED_ALLOWLIST_PATHS[index])) {
    throw new Error("Accepted base allowlist is not the fixed Fast Lane allowlist.");
  }
  return allowlist;
}

function assertTrustedClassifier(cwd, base) {
  for (const repoPath of CLASSIFIER_PATHS) {
    const acceptedBytes = readBaseBlob(cwd, base, repoPath);
    const candidateBytes = readFileSync(resolve(cwd, repoPath));
    if (!acceptedBytes.equals(candidateBytes)) {
      throw new Error("Candidate changes the Fast Lane classifier: " + repoPath);
    }
  }
}

function pushReason(reasons, reason) {
  reasons.add(reason);
}

function inspectObject(cwd, objectId, mode, reasons) {
  if (mode === "000000" || mode === "120000") {
    return;
  }
  try {
    const size = Number.parseInt(gitText(cwd, ["cat-file", "-s", objectId]), 10);
    if (!Number.isSafeInteger(size) || size > 1024 * 1024) {
      pushReason(reasons, "BLOB_TOO_LARGE");
      return;
    }
    const content = gitBytes(cwd, ["cat-file", "-p", objectId]);
    if (content.includes(0)) {
      pushReason(reasons, "BINARY_CONTENT");
      return;
    }
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(content);
      if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/u.test(decoded)) {
        pushReason(reasons, "BINARY_CONTENT");
      }
    } catch {
      pushReason(reasons, "BINARY_CONTENT");
    }
  } catch {
    pushReason(reasons, "OBJECT_UNREADABLE");
  }
}

function inspectChange(cwd, change, reasons) {
  const paths = [change.old_path, change.new_path];
  for (const candidatePath of paths) {
    if (candidatePath.includes("\ufffd") || candidatePath.includes("\\") || candidatePath.startsWith("/")) {
      pushReason(reasons, "UNSAFE_PATH");
    }
    if (isInstructionPath(candidatePath)) {
      pushReason(reasons, "INSTRUCTION_PATH");
    }
    if (isControlPath(candidatePath)) {
      pushReason(reasons, "CONTROL_PATH");
    }
    if (!isPathAllowed(candidatePath)) {
      pushReason(reasons, "PATH_OUTSIDE_ALLOWLIST");
    }
  }

  if (!isRegularFile(change.old_mode) || !isRegularFile(change.new_mode)) {
    pushReason(reasons, "NON_REGULAR_FILE");
  }
  if (change.old_mode === "120000" || change.new_mode === "120000") {
    pushReason(reasons, "SYMLINK");
  }
  if (change.old_mode !== "000000" && change.new_mode !== "000000" &&
      executable(change.old_mode) !== executable(change.new_mode)) {
    pushReason(reasons, "EXECUTABLE_MODE_CHANGED");
  }
  inspectObject(cwd, change.old_object, change.old_mode, reasons);
  inspectObject(cwd, change.new_object, change.new_mode, reasons);
}

function canonicalDecisionPayload(decision) {
  const { decision_sha256, ...payload } = decision;
  return JSON.stringify(payload);
}

export function classifyCandidate(cwd) {
  const base = acceptedRemoteMain(cwd);
  const head = ensureCleanCandidate(cwd);
  if (!gitSucceeds(cwd, ["merge-base", "--is-ancestor", base, head])) {
    throw new Error("Candidate HEAD does not descend from accepted origin/main.");
  }

  const allowlistBytes = readBaseBlob(cwd, base, ALLOWLIST_PATH);
  validateBaseAllowlist(allowlistBytes);
  assertTrustedClassifier(cwd, base);

  const changes = parseRawDiff(gitBytes(cwd, [
    "diff", "--raw", "-z", "-M", "--no-ext-diff", "--no-textconv", base, head
  ]));
  const reasons = new Set();
  if (changes.length === 0) {
    reasons.add("NO_CHANGES");
  }
  for (const change of changes) {
    inspectChange(cwd, change, reasons);
  }

  const decision = {
    schema_version: "qq.workflow.fast-lane.result.v1",
    base,
    head,
    allowlist_sha256: sha256(allowlistBytes),
    classifier_sha256: sha256(readBaseBlob(cwd, base, "scripts/lib/fast-lane.mjs")),
    runner_sha256: sha256(readBaseBlob(cwd, base, "scripts/fast-lane.mjs")),
    comment_only_supported: false,
    status: reasons.size === 0 ? "FAST_LANE" : "FEATURE_FLOW",
    fast_lane: reasons.size === 0,
    reasons: sortedUnique(reasons),
    changes: changes.map(({ kind, old_mode, new_mode, old_path, new_path }) => ({
      kind,
      old_mode,
      new_mode,
      old_path,
      new_path
    }))
  };
  decision.decision_sha256 = sha256(canonicalDecisionPayload(decision));
  return decision;
}

export function routeCandidate(cwd, savedDecision) {
  const currentBase = acceptedRemoteMain(cwd);
  const currentHead = ensureCleanCandidate(cwd);
  if (savedDecision?.base !== currentBase || savedDecision?.head !== currentHead) {
    return {
      schema_version: "qq.workflow.fast-lane.route.v1",
      base: currentBase,
      head: currentHead,
      route: "FEATURE_FLOW",
      fast_lane: false,
      reasons: ["STALE_DECISION_RECHECK_REQUIRED"]
    };
  }

  const fresh = classifyCandidate(cwd);
  if (savedDecision.decision_sha256 !== fresh.decision_sha256) {
    return {
      schema_version: "qq.workflow.fast-lane.route.v1",
      base: currentBase,
      head: currentHead,
      route: "FEATURE_FLOW",
      fast_lane: false,
      reasons: ["STALE_DECISION_RECHECK_REQUIRED"]
    };
  }
  return {
    schema_version: "qq.workflow.fast-lane.route.v1",
    base: currentBase,
    head: currentHead,
    route: fresh.fast_lane ? "FAST_LANE" : "FEATURE_FLOW",
    fast_lane: fresh.fast_lane,
    reasons: fresh.reasons
  };
}

export function resultPathInsideIgnoredWorkspace(cwd, candidatePath) {
  const root = resolve(cwd);
  const target = resolve(root, candidatePath);
  const relativePath = relative(root, target);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(".." + sep)) {
    throw new Error("Result path must be a file inside the repository.");
  }
  const gitPath = relativePath.split(sep).join("/");
  if (!gitSucceeds(root, ["check-ignore", "-q", "--no-index", gitPath])) {
    throw new Error("Result path must be ignored by Git.");
  }
  return target;
}

export function decisionJson(decision) {
  return JSON.stringify(decision, null, 2) + "\n";
}

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyCandidate, routeCandidate } from "../scripts/lib/fast-lane.mjs";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runnerPath = join(workspace, "scripts", "fast-lane.mjs");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function writeRepoFile(repo, repoPath, contents) {
  const target = join(repo, ...repoPath.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function commitAll(repo, message) {
  git(repo, ["add", "--all"]);
  git(repo, ["commit", "-m", message]);
}

function commitFile(repo, repoPath, contents, message = "candidate change") {
  writeRepoFile(repo, repoPath, contents);
  git(repo, ["add", "--", repoPath]);
  git(repo, ["commit", "-m", message]);
}

function clean(repo) {
  assert.equal(git(repo, ["status", "--porcelain"]), "");
}

function createRepo() {
  const root = mkdtempSync(join(tmpdir(), "qq-fast-lane-"));
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  mkdirSync(repo);
  git(repo, ["init"]);
  git(repo, ["checkout", "-b", "main"]);
  git(repo, ["config", "user.name", "Fast Lane Test"]);
  git(repo, ["config", "user.email", "fast-lane@example.test"]);
  git(repo, ["config", "core.filemode", "false"]);
  git(repo, ["config", "core.symlinks", "false"]);

  writeRepoFile(repo, ".gitignore", ".workflow-local/\n");
  writeRepoFile(repo, ".ai-workflow/fast-lane.allowlist.json", JSON.stringify({
    schema_version: "qq.workflow.fast-lane.allowlist.v1",
    paths: [
      "docs/user-guide/**/*.md",
      "docs/tutorials/**/*.md"
    ]
  }, null, 2) + "\n");
  writeRepoFile(repo, "scripts/fast-lane.mjs", readFileSync(runnerPath));
  writeRepoFile(repo, "scripts/lib/fast-lane.mjs",
    readFileSync(join(workspace, "scripts", "lib", "fast-lane.mjs")));
  writeRepoFile(repo, "docs/user-guide/start.md", "# Start\n");
  writeRepoFile(repo, "docs/tutorials/start.md", "# Tutorial\n");
  writeRepoFile(repo, "src/app.mjs", "export const app = true;\n");
  writeRepoFile(repo, "test/fixtures/fast-lane/sample.txt", "fixture\n");
  commitAll(repo, "accepted base");

  git(root, ["init", "--bare", remote]);
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["push", "-u", "origin", "main"]);
  clean(repo);
  return { root, repo };
}

function withRepo(callback) {
  const fixture = createRepo();
  try {
    callback(fixture.repo);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

test("accepts only the fixed docs paths and binds result to base and head", () => {
  withRepo((repo) => {
    commitFile(repo, "docs/user-guide/guide.md", "# Guide\n");
    const result = classifyCandidate(repo);

    assert.equal(result.status, "FAST_LANE");
    assert.equal(result.fast_lane, true);
    assert.equal(result.base, git(repo, ["rev-parse", "origin/main"]));
    assert.equal(result.head, git(repo, ["rev-parse", "HEAD"]));
    assert.equal(result.comment_only_supported, false);
    assert.match(result.allowlist_sha256, /^[0-9a-f]{64}$/u);
    assert.match(result.classifier_sha256, /^[0-9a-f]{64}$/u);
    assert.match(result.decision_sha256, /^[0-9a-f]{64}$/u);
  });
});

test("the CLI writes structured output only to a Git-ignored result path", () => {
  withRepo((repo) => {
    commitFile(repo, "docs/tutorials/new.md", "# New\n");
    const classified = spawnSync(process.execPath, [
      runnerPath, "classify", repo, ".workflow-local/fast-lane-result.json"
    ], { encoding: "utf8" });

    assert.equal(classified.status, 0, classified.stderr);
    const saved = JSON.parse(readFileSync(join(repo, ".workflow-local/fast-lane-result.json"), "utf8"));
    assert.equal(saved.status, "FAST_LANE");
    assert.deepEqual(JSON.parse(classified.stdout), saved);

    const routed = spawnSync(process.execPath, [
      runnerPath, "route", repo, ".workflow-local/fast-lane-result.json"
    ], { encoding: "utf8" });
    assert.equal(routed.status, 0, routed.stderr);
    assert.equal(JSON.parse(routed.stdout).route, "FAST_LANE");

    const refused = spawnSync(process.execPath, [
      runnerPath, "classify", repo, "fast-lane-result.json"
    ], { encoding: "utf8" });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Result path must be ignored/u);
  });
});

test("checks both old and new paths of a rename", () => {
  withRepo((repo) => {
    git(repo, ["mv", "docs/user-guide/start.md", "docs/tutorials/renamed.md"]);
    git(repo, ["commit", "-m", "rename inside allowlist"]);
    assert.equal(classifyCandidate(repo).status, "FAST_LANE");
  });

  withRepo((repo) => {
    git(repo, ["mv", "docs/user-guide/start.md", "README.md"]);
    git(repo, ["commit", "-m", "rename outside allowlist"]);
    const result = classifyCandidate(repo);
    assert.equal(result.status, "FEATURE_FLOW");
    assert.ok(result.reasons.includes("PATH_OUTSIDE_ALLOWLIST"));
  });
});

test("routes code, allowlist, fixture and instruction changes to Feature Flow", () => {
  const cases = [
    ["src/app.mjs", "export const app = false;\n", "PATH_OUTSIDE_ALLOWLIST"],
    [".ai-workflow/fast-lane.allowlist.json", "{\"paths\":[]}\n", "CONTROL_PATH"],
    ["test/fixtures/fast-lane/sample.txt", "changed\n", "CONTROL_PATH"],
    ["docs/user-guide/AGENTS.md", "# Instructions\n", "INSTRUCTION_PATH"],
    ["docs/tutorials/GEMINI.md", "# Instructions\n", "INSTRUCTION_PATH"]
  ];
  for (const [repoPath, contents, expectedReason] of cases) {
    withRepo((repo) => {
      commitFile(repo, repoPath, contents);
      const result = classifyCandidate(repo);
      assert.equal(result.status, "FEATURE_FLOW", repoPath);
      assert.ok(result.reasons.includes(expectedReason), repoPath);
    });
  }
});

test("does not trust a candidate that changes the classifier", () => {
  withRepo((repo) => {
    commitFile(repo, "scripts/lib/fast-lane.mjs", "export const bypass = true;\n");
    assert.throws(
      () => classifyCandidate(repo),
      /Candidate changes the Fast Lane classifier/u
    );
  });
});

test("rejects binary content, symlinks and executable permission changes", () => {
  withRepo((repo) => {
    commitFile(repo, "docs/user-guide/start.md", Buffer.from([0x61, 0x00, 0x62]));
    assert.ok(classifyCandidate(repo).reasons.includes("BINARY_CONTENT"));
  });

  withRepo((repo) => {
    commitFile(repo, "docs/tutorials/start.md", Buffer.from([0xc3, 0x28]));
    assert.ok(classifyCandidate(repo).reasons.includes("BINARY_CONTENT"));
  });

  withRepo((repo) => {
    const path = join(repo, "docs", "user-guide", "link.md");
    writeFileSync(path, "target.md\n");
    const objectId = git(repo, ["hash-object", "-w", "--", path]);
    git(repo, ["update-index", "--add", "--cacheinfo", "120000," + objectId + ",docs/user-guide/link.md"]);
    git(repo, ["commit", "-m", "add symlink entry"]);
    clean(repo);
    assert.ok(classifyCandidate(repo).reasons.includes("SYMLINK"));
  });

  withRepo((repo) => {
    git(repo, ["update-index", "--chmod=+x", "docs/user-guide/start.md"]);
    git(repo, ["commit", "-m", "make guide executable"]);
    clean(repo);
    assert.ok(classifyCandidate(repo).reasons.includes("EXECUTABLE_MODE_CHANGED"));
  });
});

test("a saved decision becomes unusable after the candidate changes", () => {
  withRepo((repo) => {
    commitFile(repo, "docs/user-guide/one.md", "# One\n");
    const first = classifyCandidate(repo);
    assert.equal(routeCandidate(repo, first).route, "FAST_LANE");

    commitFile(repo, "docs/user-guide/two.md", "# Two\n");
    const stale = routeCandidate(repo, first);
    assert.equal(stale.route, "FEATURE_FLOW");
    assert.deepEqual(stale.reasons, ["STALE_DECISION_RECHECK_REQUIRED"]);
  });
});

test("a tampered saved decision cannot be routed as Fast Lane", () => {
  withRepo((repo) => {
    commitFile(repo, "docs/tutorials/one.md", "# One\n");
    const saved = classifyCandidate(repo);
    saved.decision_sha256 = "0".repeat(64);

    const routed = routeCandidate(repo, saved);
    assert.equal(routed.route, "FEATURE_FLOW");
    assert.deepEqual(routed.reasons, ["STALE_DECISION_RECHECK_REQUIRED"]);
  });
});

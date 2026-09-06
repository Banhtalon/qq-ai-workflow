import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const RISK_LEVELS = Object.freeze({ GREEN: 0, YELLOW: 1, RED: 2 });
export const COMPLEXITY_LEVELS = Object.freeze(["S", "M", "L", "XL"]);

export function assertRisk(value, field = "risk") {
  if (!(value in RISK_LEVELS)) {
    throw new Error(`${field} must be GREEN, YELLOW, or RED`);
  }
  return value;
}

export function assertComplexity(value) {
  if (!COMPLEXITY_LEVELS.includes(value)) {
    throw new Error("complexity must be S, M, L, or XL");
  }
  return value;
}

export function maxRisk(...values) {
  return values.map((value) => assertRisk(value)).reduce(
    (highest, current) =>
      RISK_LEVELS[current] > RISK_LEVELS[highest] ? current : highest,
    "GREEN",
  );
}

function globToRegExp(glob) {
  const normalized = glob.replaceAll("\\", "/");
  let source = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  source = source.replaceAll("**", "\u0000");
  source = source.replaceAll("*", "[^/]*");
  source = source.replaceAll("?", "[^/]");
  source = source.replaceAll("\u0000", ".*");
  return new RegExp(`^${source}$`, "i");
}

export function matchesGlob(filePath, glob) {
  return globToRegExp(glob).test(filePath.replaceAll("\\", "/"));
}

export function classifyRisk({
  paths = [],
  diffText = "",
  declared = "GREEN",
  priorEffective = "GREEN",
  complexity = "S",
  rules,
}) {
  assertRisk(declared, "declared risk");
  assertRisk(priorEffective, "prior effective risk");
  assertComplexity(complexity);
  if (!rules || !Array.isArray(rules.rules)) {
    throw new Error("risk rules must contain a rules array");
  }

  const matches = [];
  for (const rule of rules.rules) {
    assertRisk(rule.risk, `rule ${rule.id} risk`);
    const matchedPaths = paths.filter((candidate) =>
      (rule.path_globs ?? []).some((glob) => matchesGlob(candidate, glob)),
    );
    const matchedPatterns = (rule.diff_patterns ?? []).filter((pattern) =>
      new RegExp(pattern, "i").test(diffText),
    );
    if (matchedPaths.length || matchedPatterns.length) {
      matches.push({
        id: rule.id,
        risk: rule.risk,
        reason: rule.reason,
        matched_paths: matchedPaths,
        matched_patterns: matchedPatterns,
        required_roles: rule.required_roles ?? [],
      });
    }
  }

  const observed = matches.length
    ? maxRisk(...matches.map((match) => match.risk))
    : assertRisk(rules.default_risk ?? "GREEN", "default risk");
  const effective = maxRisk(declared, priorEffective, observed);
  const levelRoles = rules.level_controls?.[effective]?.required_roles ?? [];
  const requiredRoles = [...new Set([...levelRoles, ...matches.flatMap((match) => match.required_roles)])].sort();

  return {
    schema_version: "qq.workflow.risk-decision.v9",
    declared,
    prior_effective: priorEffective,
    observed,
    effective,
    complexity,
    matches,
    required_roles: requiredRoles,
    action: effective === "RED" ? "STOP_AND_ESCALATE" : "CONTINUE_WITH_CONTROLS",
  };
}

export async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function defaultLockPath(manifestPath) {
  return manifestPath.endsWith(".json")
    ? manifestPath.slice(0, -5) + ".lock.json"
    : manifestPath + ".lock.json";
}

export function validateManifest(manifest) {
  if (manifest.schema_version !== "qq.workflow.verification-manifest.v9") {
    throw new Error("unsupported verification manifest schema");
  }
  if (!/^TASK-[A-Z0-9][A-Z0-9_-]*$/i.test(manifest.task_id ?? "")) {
    throw new Error("manifest task_id is invalid");
  }
  if (!Number.isInteger(manifest.scope_revision) || manifest.scope_revision < 1) {
    throw new Error("manifest scope_revision must be a positive integer");
  }
  if (!/^[0-9a-f]{40}$/i.test(manifest.base_sha ?? "")) {
    throw new Error("manifest base_sha must be a full 40-character commit SHA");
  }
  if (!Array.isArray(manifest.acceptance_criteria) || !manifest.acceptance_criteria.length) {
    throw new Error("manifest requires acceptance criteria");
  }
  if (!Array.isArray(manifest.gates) || !manifest.gates.length) {
    throw new Error("manifest requires gates");
  }
  for (const gate of manifest.gates) {
    if (!gate.id || !Array.isArray(gate.argv) || !gate.argv.length) {
      throw new Error("each gate requires id and non-empty argv");
    }
    if (gate.argv.some((part) => typeof part !== "string" || part.length === 0)) {
      throw new Error(`gate ${gate.id} argv must contain non-empty strings`);
    }
    if (!Number.isInteger(gate.timeout_seconds) || gate.timeout_seconds < 1 || gate.timeout_seconds > 3600) {
      throw new Error(`gate ${gate.id} timeout_seconds must be 1..3600`);
    }
    if (gate.required !== true) {
      throw new Error(`gate ${gate.id} must be explicitly required`);
    }
  }
  return manifest;
}

export function secretEnvironmentValues(env = process.env) {
  const namePattern = /(SECRET|TOKEN|PASSWORD|PASSWD|COOKIE|JWT|PRIVATE_KEY|API_KEY|ACCESS_KEY)/i;
  return Object.entries(env)
    .filter(([name, value]) => namePattern.test(name) && typeof value === "string" && value.length >= 8)
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length);
}

export function looksLikeSecretArgument(value) {
  const patterns = [
    /(?:^|[=:])(ghp_|github_pat_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}/i,
    /(?:password|passwd|secret|token|cookie|api[_-]?key|private[_-]?key)\s*[=:]\s*\S{4,}/i,
    /Bearer\s+\S+/i,
    /^[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}$/,
  ];
  return patterns.some((pattern) => pattern.test(value));
}

export function redactText(input, env = process.env) {
  let output = String(input);
  for (const value of secretEnvironmentValues(env)) {
    output = output.split(value).join("[REDACTED_ENV_SECRET]");
  }
  const replacements = [
    [/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]"],
    [/(?:ghp_|github_pat_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}/gi, "[REDACTED_TOKEN]"],
    [/\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_JWT]"],
    [/(https?:\/\/)([^\s:@/]+):([^\s@/]+)@/gi, "$1[REDACTED_CREDENTIALS]@"],
    [/\b(password|passwd|secret|token|cookie|api[_-]?key|private[_-]?key)\s*([=:])\s*([^\s,;]+)/gi, "$1$2[REDACTED]"],
  ];
  for (const [pattern, replacement] of replacements) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

function argvForPlatform(argv) {
  if (process.platform === "win32" && ["npm", "npx"].includes(argv[0])) {
    const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", `${argv[0]}-cli.js`);
    if (existsSync(cli)) return [process.execPath, cli, ...argv.slice(1)];
  }
  if (process.platform === "win32" && ["npm", "npx", "pnpm", "yarn"].includes(argv[0])) {
    return [`${argv[0]}.cmd`, ...argv.slice(1)];
  }
  return argv;
}

export async function runRedacted(argv, { cwd = process.cwd(), timeoutSeconds = 300, env = process.env } = {}) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error("argv must be a non-empty array");
  }
  if (argv.some((part) => looksLikeSecretArgument(part))) {
    return {
      code: 78,
      timed_out: false,
      stdout: "",
      stderr: "BLOCKED: secret-like command argument rejected\n",
      redaction_applied: true,
    };
  }

  return await new Promise((resolve, reject) => {
    const platformArgv = argvForPlatform(argv);
    const child = spawn(platformArgv[0], platformArgv.slice(1), {
      cwd,
      env,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutSeconds * 1000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: timedOut ? 124 : (code ?? 1),
        timed_out: timedOut,
        stdout: redactText(stdout, env).slice(-32768),
        stderr: redactText(stderr, env).slice(-32768),
        redaction_applied: true,
      });
    });
  });
}

export async function verifyManifest(manifestPath, { lockPath = defaultLockPath(manifestPath), cwd } = {}) {
  const manifest = validateManifest(await readJson(manifestPath));
  const lock = await readJson(lockPath);
  const actualHash = await sha256File(manifestPath);
  if (lock.schema_version !== "qq.workflow.verification-lock.v9") {
    throw new Error("unsupported verification lock schema");
  }
  for (const field of ["task_id", "scope_revision", "base_sha"]) {
    if (lock[field] !== manifest[field]) {
      throw new Error(`verification lock ${field} mismatch`);
    }
  }
  if (lock.manifest_sha256 !== actualHash) {
    throw new Error("verification manifest changed after freeze");
  }

  const startedAt = new Date();
  const gateResults = [];
  for (const gate of manifest.gates) {
    const gateStarted = Date.now();
    const result = await runRedacted(gate.argv, {
      cwd: cwd ?? process.cwd(),
      timeoutSeconds: gate.timeout_seconds,
    });
    gateResults.push({
      id: gate.id,
      argv_display: [gate.argv[0], ...gate.argv.slice(1).map(() => "<arg>")],
      exit_code: result.code,
      timed_out: result.timed_out,
      duration_ms: Date.now() - gateStarted,
      stdout: result.stdout,
      stderr: result.stderr,
      redaction_applied: result.redaction_applied,
      verdict: result.code === 0 ? "PASS" : "FAIL",
    });
    if (gate.required && result.code !== 0) break;
  }

  const pass = gateResults.length === manifest.gates.length && gateResults.every((gate) => gate.verdict === "PASS");
  return {
    schema_version: "qq.workflow.verification-evidence.v9",
    task_id: manifest.task_id,
    scope_revision: manifest.scope_revision,
    base_sha: manifest.base_sha,
    evidence_tier: manifest.evidence_tier,
    manifest_sha256: actualHash,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    gate_results: gateResults,
    verdict: pass ? "PASS" : "FAIL",
  };
}

export function resolveFrom(base, candidate) {
  return path.resolve(base, candidate);
}

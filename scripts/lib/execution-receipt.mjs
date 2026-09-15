import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const RECEIPT_SCHEMA = 'qq.workflow.execution-receipt.v1';
export const MANIFEST_SCHEMA = 'qq.workflow.manifest.v1';
export const FROZEN_RECORD_SCHEMA = 'qq.workflow.lock.v10';
export const INVOCATION_RECORD_SCHEMA = 'qq.workflow.invocation.v1';
export const POLICY_V1 = 'CONTROLLED_DELEGATION_V1';
export const POLICY_V2 = 'CONTROLLED_DELEGATION_V2';
export const POLICY_DISCRIMINATOR = POLICY_V1;
export const POLICIES = Object.freeze([POLICY_V1, POLICY_V2]);

export const GEMINI_MODEL = 'gemini-3.8-flash-high';
export const ASTRA_MODEL = 'gpt-6-astra';
export const ASTRA_EFFORT = 'low';

export const LUNA_MODEL = 'gpt-5.6-luna';
export const LUNA_EFFORT = 'max';
export const SOL_MODEL = 'gpt-5.6-sol';
export const SOL_EFFORT = 'medium';
export const TERRA_MODEL = 'gpt-5.6-terra';
export const TERRA_EFFORT = 'xhigh';

export const FAILURE_CODES = Object.freeze({
  CONTRACT_MISMATCH: 'CONTRACT_MISMATCH',
  EXECUTION_MISMATCH: 'EXECUTION_MISMATCH',
  CONTENT_MISMATCH: 'CONTENT_MISMATCH',
  SCOPE_VIOLATION: 'SCOPE_VIOLATION'
});

const FORBIDDEN_REPORTED_OVERRIDES = new Set([
  'provider',
  'requested_model',
  'requested_effort',
  'redacted_invocation',
  'invocation',
  'started_at',
  'finished_at',
  'termination_status',
  'timeout',
  'input_packet_hash',
  'output_hash',
  'bridge_run_id',
  'task_id',
  'revision',
  'contract_sha256',
  'config_sha256',
  'bridge_source_sha256',
  'base_sha',
  'head_before',
  'manifest',
  'manifest_sha256',
  'expected_tree'
]);

/**
 * Integration requirement for .workflow-local/ and node_modules baseline:
 * In environments with legitimate pre-existing ignored files (such as node_modules/,
 * .workflow-local/), the pre-invocation runner must capture a trusted pre-invocation baseline
 * of authorized ignored exact file paths and hashes prior to worker execution and bind them into
 * the invocation record and receipt.
 * Directory prefixes are prohibited; captureManifest and verifyCandidate never infer that
 * present ignored files were pre-existing or blanket-ignore them; any newly introduced or
 * unlisted ignored file fails closed as SCOPE_VIOLATION.
 */

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

function gitExec(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options
  });
}

function gitExecBuf(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    maxBuffer: 32 * 1024 * 1024,
    ...options
  });
}

export function normalizeModelName(m) {
  if (typeof m !== 'string') return null;
  let s = m.trim().toLowerCase();
  if (s.startsWith('models/')) {
    s = s.slice(7);
  }
  if (s.endsWith(':latest')) {
    s = s.slice(0, -7);
  }
  return s;
}

export function manifestDigest(manifest) {
  if (!manifest || typeof manifest !== 'object' || manifest.schema_version !== MANIFEST_SCHEMA) {
    throw new TypeError('manifest must be a valid manifest object');
  }
  if (!manifest.head_before || typeof manifest.head_before !== 'string' || !/^[0-9a-f]{40}$/i.test(manifest.head_before)) {
    throw new TypeError('manifest must contain a valid head_before commit SHA');
  }
  if (!manifest.expected_tree || typeof manifest.expected_tree !== 'string' || !/^[0-9a-f]{40}$/i.test(manifest.expected_tree)) {
    throw new TypeError('manifest must contain a valid expected_tree SHA');
  }
  if (!Array.isArray(manifest.entries)) {
    throw new TypeError('manifest entries must be an array');
  }
  if (!manifest.baseline_snapshots || typeof manifest.baseline_snapshots !== 'object') {
    throw new TypeError('manifest must contain a valid baseline_snapshots object');
  }

  const sortedBaseline = {};
  for (const k of Object.keys(manifest.baseline_snapshots).sort()) {
    const val = manifest.baseline_snapshots[k];
    if (typeof val !== 'string' || !/^[0-9a-f]{64}$/i.test(val)) {
      throw new TypeError(`Invalid baseline snapshot hash for: ${k}`);
    }
    sortedBaseline[k] = val;
  }

  const ignoredSource = manifest.ignored_snapshots ?? manifest.authorized_ignored ?? {};
  if (typeof ignoredSource !== 'object' || ignoredSource === null) {
    throw new TypeError('manifest ignored_snapshots must be an object');
  }
  const sortedIgnored = {};
  for (const k of Object.keys(ignoredSource).sort()) {
    const val = ignoredSource[k];
    if (typeof val !== 'string' || !/^[0-9a-f]{64}$/i.test(val)) {
      throw new TypeError(`Invalid ignored snapshot hash for: ${k}`);
    }
    sortedIgnored[k] = val;
  }

  const payload = {
    schema_version: manifest.schema_version,
    head_before: manifest.head_before,
    expected_tree: manifest.expected_tree,
    entries: manifest.entries.map(e => ({
      path: e.path,
      change_type: e.change_type,
      old_mode: e.old_mode,
      new_mode: e.new_mode,
      old_blob_sha: e.old_blob_sha,
      new_blob_sha: e.new_blob_sha,
      old_content_sha256: e.old_content_sha256,
      new_content_sha256: e.new_content_sha256,
      raw_content_sha256: e.raw_content_sha256
    })),
    baseline_snapshots: sortedBaseline,
    ignored_snapshots: sortedIgnored
  };
  return sha256Hex(JSON.stringify(payload));
}

export function assertNoSuppressionFlags(cwd) {
  const out = gitExec(cwd, ['ls-files', '-v', '-z']);
  if (!out) return;
  const entries = out.split('\0').filter(Boolean);
  for (const entry of entries) {
    const tag = entry[0];
    const filePath = entry.slice(2);
    if (tag === 'h') {
      throw new Error(`assume-unchanged flag detected on: ${filePath}`);
    }
    if (tag === 'S' || tag === 's') {
      throw new Error(`skip-worktree flag detected on: ${filePath}`);
    }
    if (tag !== 'H') {
      throw new Error(`Unexpected index flag '${tag}' on: ${filePath}`);
    }
  }
}

export function assertSafeAllowedPath(p) {
  if (typeof p !== 'string' || !p.trim()) {
    throw new Error('Allowed path must be a non-empty string');
  }
  if (path.isAbsolute(p)) {
    throw new Error(`Absolute allowed path prohibited: ${p}`);
  }
  if (p.includes('\\')) {
    throw new Error(`Backslash in allowed path prohibited: ${p}`);
  }
  if (p.includes(':')) {
    throw new Error(`Colon in allowed path prohibited: ${p}`);
  }
  const parts = p.split('/');
  if (parts.some(s => s === '.' || s === '..' || s === '')) {
    throw new Error(`Path traversal or empty segment in allowed path prohibited: ${p}`);
  }
  if (parts[0] === '.git') {
    throw new Error(`Allowed path cannot target .git internals: ${p}`);
  }
}

export function assertSafeExactPath(p) {
  if (typeof p !== 'string' || !p.trim()) {
    throw new Error('Path must be a non-empty string');
  }
  if (p.endsWith('/')) {
    throw new Error(`Directory prefixes prohibited in authorized_ignored; exact file paths required: ${p}`);
  }
  assertSafeAllowedPath(p);
}

export function isPathAllowed(relPath, allowedPaths) {
  const normRel = relPath.replace(/\\/g, '/');
  return allowedPaths.some(allowed => {
    const normAllowed = allowed.replace(/\\/g, '/');
    if (normRel === normAllowed) return true;
    const prefix = normAllowed.endsWith('/') ? normAllowed : normAllowed + '/';
    return normRel.startsWith(prefix);
  });
}

function assertNoSymlinkOrReparse(cwd, relPath) {
  const fullPath = path.join(cwd, relPath);
  if (!fs.existsSync(fullPath)) return;
  const lstat = fs.lstatSync(fullPath);
  if (lstat.isSymbolicLink()) {
    throw new Error(`Symlinks are prohibited: ${relPath}`);
  }
  const realCwd = fs.realpathSync(cwd);
  const realFile = fs.realpathSync(fullPath);
  if (!realFile.startsWith(realCwd + path.sep) && realFile !== realCwd) {
    throw new Error(`Path traversal via symlink prohibited: ${relPath}`);
  }
}

export function captureManifest(cwd, headBefore, allowedPaths, options = {}) {
  if (!cwd || typeof cwd !== 'string') {
    throw new TypeError('cwd must be a valid path string');
  }
  if (!headBefore || typeof headBefore !== 'string') {
    throw new TypeError('headBefore must be a commit SHA string');
  }
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
    throw new TypeError('allowedPaths must be a non-empty array of strings');
  }

  for (const ap of allowedPaths) {
    assertSafeAllowedPath(ap);
  }

  const resolvedHeadBefore = gitExec(cwd, ['rev-parse', headBefore]).trim();
  const currentHead = gitExec(cwd, ['rev-parse', 'HEAD']).trim();
  if (currentHead !== resolvedHeadBefore) {
    throw new Error(`Current HEAD (${currentHead}) does not match headBefore (${resolvedHeadBefore})`);
  }

  // Reject assume-unchanged and skip-worktree index flags before capture
  assertNoSuppressionFlags(cwd);

  // Parse and validate authorized ignored exact files (directory prefixes prohibited)
  const rawAuthIgnored = options?.authorizedIgnored ?? options?.authorized_ignored ?? null;
  const ignoredSnapshots = {};
  if (rawAuthIgnored) {
    if (Array.isArray(rawAuthIgnored)) {
      for (const p of rawAuthIgnored) {
        assertSafeExactPath(p);
        const fullP = path.join(cwd, p);
        if (!fs.existsSync(fullP)) {
          throw new Error(`Authorized ignored file missing from workspace: ${p}`);
        }
        if (fs.statSync(fullP).isDirectory()) {
          throw new Error(`Directory prefixes prohibited in authorized_ignored; exact file paths required: ${p}`);
        }
        assertNoSymlinkOrReparse(cwd, p);
        if (isPathAllowed(p, allowedPaths)) {
          throw new Error(`Ignored file within explicitly allowed paths detected: ${p}`);
        }
        ignoredSnapshots[p] = sha256Hex(fs.readFileSync(fullP));
      }
    } else if (typeof rawAuthIgnored === 'object' && rawAuthIgnored !== null) {
      for (const [p, expectedHash] of Object.entries(rawAuthIgnored)) {
        assertSafeExactPath(p);
        const fullP = path.join(cwd, p);
        if (!fs.existsSync(fullP)) {
          throw new Error(`Authorized ignored file missing from workspace: ${p}`);
        }
        if (fs.statSync(fullP).isDirectory()) {
          throw new Error(`Directory prefixes prohibited in authorized_ignored; exact file paths required: ${p}`);
        }
        assertNoSymlinkOrReparse(cwd, p);
        if (isPathAllowed(p, allowedPaths)) {
          throw new Error(`Ignored file within explicitly allowed paths detected: ${p}`);
        }
        const actualHash = sha256Hex(fs.readFileSync(fullP));
        if (expectedHash && actualHash !== expectedHash) {
          throw new Error(`Authorized ignored file content hash mismatch for: ${p}`);
        }
        ignoredSnapshots[p] = actualHash;
      }
    } else {
      throw new TypeError('authorizedIgnored must be an array of file paths or object of { [path]: hash }');
    }
  }

  const statusRaw = gitExec(cwd, ['status', '--porcelain=v1', '-z', '-uall', '--ignored']);
  const changedPaths = new Set();
  const seenIgnored = new Set();
  const tokens = statusRaw ? statusRaw.split('\0') : [];
  let i = 0;
  while (i < tokens.length) {
    const item = tokens[i];
    if (!item) {
      i++;
      continue;
    }
    const x = item[0];
    const y = item[1];
    const relPath = item.slice(3);

    if (relPath.startsWith('.git/') || relPath === '.git') {
      i++;
      continue;
    }

    if (x === '!' && y === '!') {
      assertNoSymlinkOrReparse(cwd, relPath);
      if (isPathAllowed(relPath, allowedPaths)) {
        throw new Error(`Ignored file within explicitly allowed paths detected: ${relPath}`);
      }
      if (!ignoredSnapshots[relPath]) {
        throw new Error(`SCOPE_VIOLATION: Unexpected or newly introduced ignored file detected without authorized baseline: ${relPath}`);
      }
      seenIgnored.add(relPath);
      i++;
      continue;
    }

    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      i++;
      const newPath = tokens[i];
      if (relPath) changedPaths.add(relPath);
      if (newPath && !newPath.startsWith('.git/')) changedPaths.add(newPath);
      i++;
      continue;
    }

    if (relPath) {
      changedPaths.add(relPath);
    }
    i++;
  }

  // Ensure all authorized ignored files were actually present and ignored
  for (const p of Object.keys(ignoredSnapshots)) {
    if (!seenIgnored.has(p)) {
      throw new Error(`Authorized ignored file is not ignored or missing from status: ${p}`);
    }
  }

  for (const p of changedPaths) {
    if (p.includes('\\') || path.isAbsolute(p) || p.split('/').some(s => s === '..' || s === '.')) {
      throw new Error(`Path traversal prohibited: ${p}`);
    }
    if (!isPathAllowed(p, allowedPaths)) {
      throw new Error(`SCOPE_VIOLATION: Path outside allowedPaths was modified or created: ${p}`);
    }
    assertNoSymlinkOrReparse(cwd, p);
  }

  // Snapshot raw working bytes for baseline tracked files
  const lsTreeRaw = gitExec(cwd, ['ls-tree', '-r', '-z', '--name-only', resolvedHeadBefore]);
  const trackedFiles = lsTreeRaw ? lsTreeRaw.split('\0').filter(Boolean) : [];
  const baselineSnapshots = {};
  for (const tf of trackedFiles) {
    if (changedPaths.has(tf)) continue;
    const fullP = path.join(cwd, tf);
    if (!fs.existsSync(fullP)) {
      throw new Error(`Tracked baseline file missing from workspace: ${tf}`);
    }
    assertNoSymlinkOrReparse(cwd, tf);
    const rawBuf = fs.readFileSync(fullP);
    baselineSnapshots[tf] = sha256Hex(rawBuf);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-manifest-'));
  const tempIndex = path.join(tempDir, 'index');
  try {
    const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
    gitExec(cwd, ['read-tree', resolvedHeadBefore], { env });

    const sortedPaths = Array.from(changedPaths).sort();
    const entries = [];

    for (const relPath of sortedPaths) {
      const fullPath = path.join(cwd, relPath);
      const exists = fs.existsSync(fullPath);

      let oldMode = null;
      let oldBlobSha = null;
      let oldContentSha256 = null;

      const lsOut = gitExec(cwd, ['ls-tree', resolvedHeadBefore, '--', relPath], { env }).trim();
      if (lsOut) {
        const match = lsOut.match(/^([0-7]+)\s+blob\s+([0-9a-f]{40})\t/);
        if (match) {
          oldMode = match[1];
          oldBlobSha = match[2];
          if (oldMode === '120000') {
            throw new Error(`Symlinks are prohibited: ${relPath}`);
          }
          const oldBuf = gitExecBuf(cwd, ['cat-file', '-p', oldBlobSha]);
          oldContentSha256 = sha256Hex(oldBuf);
        }
      }

      let newMode = null;
      let newBlobSha = null;
      let newContentSha256 = null;
      let rawContentSha256 = null;
      let changeType = null;

      if (!exists) {
        changeType = 'D';
        gitExec(cwd, ['rm', '--cached', '--ignore-unmatch', '--', relPath], { env });
      } else {
        changeType = oldBlobSha ? 'M' : 'A';
        const rawBuf = fs.readFileSync(fullPath);
        rawContentSha256 = sha256Hex(rawBuf);

        gitExec(cwd, ['add', '--', relPath], { env });

        const stageOut = gitExec(cwd, ['ls-files', '--stage', '--', relPath], { env }).trim();
        if (!stageOut) {
          throw new Error(`Unable to determine staged content for: ${relPath}`);
        }
        const stageMatch = stageOut.match(/^([0-7]+)\s+([0-9a-f]{40})\s+\d\t/);
        if (!stageMatch) {
          throw new Error(`Failed to parse staged metadata for: ${relPath}`);
        }
        newMode = stageMatch[1];
        newBlobSha = stageMatch[2];
        if (newMode === '120000') {
          throw new Error(`Symlinks are prohibited: ${relPath}`);
        }
        const stagedBuf = gitExecBuf(cwd, ['cat-file', '-p', newBlobSha]);
        newContentSha256 = sha256Hex(stagedBuf);
      }

      entries.push(Object.freeze({
        path: relPath,
        change_type: changeType,
        old_mode: oldMode,
        new_mode: newMode,
        old_blob_sha: oldBlobSha,
        new_blob_sha: newBlobSha,
        old_content_sha256: oldContentSha256,
        new_content_sha256: newContentSha256,
        raw_content_sha256: rawContentSha256
      }));
    }

    const expectedTree = gitExec(cwd, ['write-tree'], { env }).trim();
    const manifestDraft = {
      schema_version: MANIFEST_SCHEMA,
      head_before: resolvedHeadBefore,
      expected_tree: expectedTree,
      entries,
      baseline_snapshots: baselineSnapshots,
      ignored_snapshots: ignoredSnapshots
    };
    const digest = manifestDigest(manifestDraft);

    return Object.freeze({
      schema_version: MANIFEST_SCHEMA,
      head_before: resolvedHeadBefore,
      expected_tree: expectedTree,
      entries: Object.freeze(entries),
      baseline_snapshots: Object.freeze(baselineSnapshots),
      ignored_snapshots: Object.freeze(ignoredSnapshots),
      authorized_ignored: Object.freeze(ignoredSnapshots),
      digest,
      created_at: new Date().toISOString()
    });
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

export function buildReceipt(observed, reported, bindings, manifest) {
  if (!observed || typeof observed !== 'object') {
    throw new TypeError('observed must be a non-null object');
  }
  if (!bindings || typeof bindings !== 'object') {
    throw new TypeError('bindings must be a non-null object');
  }
  if (!manifest || typeof manifest !== 'object' || manifest.schema_version !== MANIFEST_SCHEMA) {
    throw new TypeError('manifest must be a valid manifest object');
  }

  // Strict bindings validations - require identity, revision, full hashes, model bindings; no aliases
  if (!bindings.bridge_run_id || typeof bindings.bridge_run_id !== 'string') {
    throw new Error('bridge_run_id is required in bindings');
  }
  if (!bindings.task_id || typeof bindings.task_id !== 'string') {
    throw new Error('task_id is required in bindings');
  }
  if (!Number.isInteger(bindings.revision) || bindings.revision <= 0) {
    throw new Error('revision must be a positive integer in bindings');
  }
  if (!bindings.contract_sha256 || typeof bindings.contract_sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(bindings.contract_sha256)) {
    throw new Error('contract_sha256 must be a 64-char hex string in bindings');
  }
  if (!bindings.config_sha256 || typeof bindings.config_sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(bindings.config_sha256)) {
    throw new Error('config_sha256 must be a 64-char hex string in bindings');
  }
  if (!bindings.bridge_source_sha256 || typeof bindings.bridge_source_sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(bindings.bridge_source_sha256)) {
    throw new Error('bridge_source_sha256 must be a 64-char hex string in bindings');
  }
  if (!bindings.designated_implementer || typeof bindings.designated_implementer !== 'string') {
    throw new Error('designated_implementer is required in bindings');
  }
  if (!bindings.base_sha || typeof bindings.base_sha !== 'string' || !/^[0-9a-f]{40}$/i.test(bindings.base_sha)) {
    throw new Error('base_sha must be a 40-char hex string in bindings');
  }
  if (!bindings.head_before || typeof bindings.head_before !== 'string' || !/^[0-9a-f]{40}$/i.test(bindings.head_before)) {
    throw new Error('head_before must be a 40-char hex string in bindings');
  }

  // Check designated_implementer vs observed requested_model
  if (normalizeModelName(bindings.designated_implementer) !== normalizeModelName(observed.requested_model)) {
    throw new Error(`designated_implementer (${bindings.designated_implementer}) does not match observed requested_model (${observed.requested_model})`);
  }

  // Observed bridge validations
  if (!observed.provider || typeof observed.provider !== 'string') {
    throw new Error('observed.provider is required');
  }
  if (!observed.requested_model || typeof observed.requested_model !== 'string') {
    throw new Error('observed.requested_model is required');
  }
  if (!observed.started_at || typeof observed.started_at !== 'string') {
    throw new Error('observed.started_at is required');
  }
  if (!observed.finished_at || typeof observed.finished_at !== 'string') {
    throw new Error('observed.finished_at is required');
  }
  if (observed.redacted_invocation === undefined && observed.invocation === undefined) {
    throw new Error('observed.redacted_invocation is required');
  }
  if (typeof observed.timeout !== 'boolean') {
    throw new Error('observed.timeout must be a boolean');
  }
  if (!observed.termination_status || typeof observed.termination_status !== 'string') {
    throw new Error('observed.termination_status is required');
  }
  if (!observed.input_packet_hash || typeof observed.input_packet_hash !== 'string' || !/^[0-9a-f]{64}$/i.test(observed.input_packet_hash)) {
    throw new Error('observed.input_packet_hash must be a 64-char hex string');
  }
  if (!observed.output_hash || typeof observed.output_hash !== 'string' || !/^[0-9a-f]{64}$/i.test(observed.output_hash)) {
    throw new Error('observed.output_hash must be a 64-char hex string');
  }

  // Model effort constraints:
  // - Astra: effort low
  // - Luna: effort max
  // - Sol: effort medium
  const normReqModel = normalizeModelName(observed.requested_model);
  const isAstra = normReqModel === normalizeModelName(ASTRA_MODEL) || normReqModel.includes('astra');
  if (isAstra) {
    if (observed.requested_effort !== ASTRA_EFFORT) {
      throw new Error(`Astra effort must be '${ASTRA_EFFORT}', got: ${observed.requested_effort}`);
    }
  }
  const isLuna = normReqModel === normalizeModelName(LUNA_MODEL) || normReqModel.includes('luna');
  if (isLuna) {
    if (observed.requested_effort !== LUNA_EFFORT) {
      throw new Error(`Luna effort must be '${LUNA_EFFORT}', got: ${observed.requested_effort}`);
    }
  }
  const isSol = normReqModel === normalizeModelName(SOL_MODEL) || normReqModel.includes('sol');
  if (isSol) {
    if (observed.requested_effort !== SOL_EFFORT) {
      throw new Error(`Sol effort must be '${SOL_EFFORT}', got: ${observed.requested_effort}`);
    }
  }

  // Forbidden overrides in reported
  if (reported && typeof reported === 'object') {
    for (const key of Object.keys(reported)) {
      if (FORBIDDEN_REPORTED_OVERRIDES.has(key)) {
        throw new Error(`Provider reported fields cannot override bridge observations or bindings: ${key}`);
      }
    }
  }

  let actualModel = reported?.actual_model ?? null;
  let validObs = [];
  if (reported?.observed_models != null) {
    if (!Array.isArray(reported.observed_models)) {
      throw new Error('reported.observed_models must be an array when provided');
    }
    validObs = reported.observed_models.filter(m => typeof m === 'string' && m.trim());
    const normObs = [...new Set(validObs.map(normalizeModelName).filter(Boolean))];
    if (normObs.length > 1) {
      throw new Error(`Multiple conflicting observed_models reported: ${validObs.join(', ')}`);
    }
    if (normObs.length === 1) {
      if (normObs[0] !== normReqModel) {
        throw new Error(`Reported observed_models (${validObs[0]}) does not match requested_model (${observed.requested_model})`);
      }
      if (actualModel == null) {
        actualModel = validObs[0];
      }
    }
  }

  if (actualModel != null) {
    if (typeof actualModel !== 'string' || !actualModel.trim()) {
      throw new Error('reported.actual_model must be a non-empty string when provided');
    }
    const normActual = normalizeModelName(actualModel);
    if (normActual !== normReqModel) {
      throw new Error(`Reported actual_model (${actualModel}) does not match requested_model (${observed.requested_model})`);
    }
  }

  // Preserve reported actual_effort with null when unavailable, reject explicit mismatch with requested_effort
  if (reported?.actual_effort != null) {
    if (typeof reported.actual_effort !== 'string' || !reported.actual_effort.trim()) {
      throw new Error('reported.actual_effort must be a non-empty string when provided');
    }
    const normActualEffort = reported.actual_effort.trim().toLowerCase();
    if (observed.requested_effort != null) {
      const normReqEffort = observed.requested_effort.trim().toLowerCase();
      if (normActualEffort !== normReqEffort) {
        throw new Error(`Reported actual_effort (${reported.actual_effort}) does not match requested_effort (${observed.requested_effort})`);
      }
    }
    if (isAstra && normActualEffort !== ASTRA_EFFORT) {
      throw new Error(`Astra actual_effort must be '${ASTRA_EFFORT}', got: ${reported.actual_effort}`);
    }
    if (isLuna && normActualEffort !== LUNA_EFFORT) {
      throw new Error(`Luna actual_effort must be '${LUNA_EFFORT}', got: ${reported.actual_effort}`);
    }
    if (isSol && normActualEffort !== SOL_EFFORT) {
      throw new Error(`Sol actual_effort must be '${SOL_EFFORT}', got: ${reported.actual_effort}`);
    }
  }

  // Authorized ignored binding validation: require matching manifest baseline; no directory prefixes
  const manifestIgnored = manifest.ignored_snapshots ?? manifest.authorized_ignored ?? {};
  const manifestHasIgnored = Object.keys(manifestIgnored).length > 0;
  let receiptAuthIgnored = null;

  if (manifestHasIgnored) {
    if (!bindings.authorized_ignored) {
      throw new Error('bindings.authorized_ignored is required when manifest contains authorized ignored files');
    }
    if (Array.isArray(bindings.authorized_ignored)) {
      for (const p of bindings.authorized_ignored) {
        assertSafeExactPath(p);
      }
      const bSet = new Set(bindings.authorized_ignored);
      const mKeys = Object.keys(manifestIgnored);
      if (bSet.size !== mKeys.length || !mKeys.every(k => bSet.has(k))) {
        throw new Error('bindings.authorized_ignored paths do not match manifest ignored files');
      }
      receiptAuthIgnored = Object.freeze({ ...manifestIgnored });
    } else if (typeof bindings.authorized_ignored === 'object' && bindings.authorized_ignored !== null) {
      for (const [p, h] of Object.entries(bindings.authorized_ignored)) {
        assertSafeExactPath(p);
        if (manifestIgnored[p] !== h) {
          throw new Error(`bindings.authorized_ignored hash mismatch for: ${p}`);
        }
      }
      const mKeys = Object.keys(manifestIgnored);
      const bKeys = Object.keys(bindings.authorized_ignored);
      if (bKeys.length !== mKeys.length) {
        throw new Error('bindings.authorized_ignored does not match manifest ignored files');
      }
      receiptAuthIgnored = Object.freeze({ ...manifestIgnored });
    } else {
      throw new TypeError('bindings.authorized_ignored must be an array of paths or an object');
    }
  } else {
    if (bindings.authorized_ignored && (Array.isArray(bindings.authorized_ignored) ? bindings.authorized_ignored.length > 0 : Object.keys(bindings.authorized_ignored).length > 0)) {
      throw new Error('bindings.authorized_ignored provided but manifest contains no authorized ignored files');
    }
    receiptAuthIgnored = null;
  }

  const reportedByProvider = Object.freeze({
    actual_model: actualModel,
    ...(validObs.length > 0 ? { observed_models: validObs } : {}),
    actual_effort: reported?.actual_effort ?? null,
    session_id: reported?.session_id ?? null,
    run_id: reported?.run_id ?? null,
    usage: reported?.usage ?? null,
    provider_status: reported?.provider_status ?? null
  });

  const observedByBridge = Object.freeze({
    provider: observed.provider,
    requested_model: observed.requested_model,
    requested_effort: observed.requested_effort ?? null,
    redacted_invocation: observed.redacted_invocation ?? observed.invocation ?? null,
    started_at: observed.started_at,
    finished_at: observed.finished_at,
    termination_status: observed.termination_status,
    timeout: observed.timeout,
    input_packet_hash: observed.input_packet_hash,
    output_hash: observed.output_hash
  });

  const mDigest = manifest.digest ?? manifestDigest(manifest);
  const invocationReceiptReference = bindings.invocation_receipt_reference;
  if (!invocationReceiptReference || typeof invocationReceiptReference !== 'object' ||
      typeof invocationReceiptReference.receipt_root_id !== 'string' || !invocationReceiptReference.receipt_root_id ||
      typeof invocationReceiptReference.chain_root_id !== 'string' || !invocationReceiptReference.chain_root_id ||
      typeof invocationReceiptReference.receipt_id !== 'string' || !invocationReceiptReference.receipt_id ||
      !/^[a-f0-9]{64}$/i.test(invocationReceiptReference.receipt_sha256 ?? '')) {
    throw new Error('missing or invalid invocation receipt reference');
  }

  const receiptPolicy = bindings.policy ?? POLICY_DISCRIMINATOR;
  if (!POLICIES.includes(receiptPolicy)) {
    throw new Error(`Unsupported receipt policy: ${receiptPolicy}`);
  }

  const designatedRole = bindings.role ?? (
    normalizeModelName(bindings.designated_implementer) === normalizeModelName(SOL_MODEL) ||
    normalizeModelName(bindings.designated_implementer) === normalizeModelName(ASTRA_MODEL)
      ? 'senior'
      : 'worker'
  );

  return Object.freeze({
    schema_version: RECEIPT_SCHEMA,
    policy: receiptPolicy,
    bridge_run_id: bindings.bridge_run_id,
    task_id: bindings.task_id,
    revision: bindings.revision,
    contract_sha256: bindings.contract_sha256,
    config_sha256: bindings.config_sha256,
    bridge_source_sha256: bindings.bridge_source_sha256,
    designated_implementer: bindings.designated_implementer,
    role: designatedRole,
    base_sha: bindings.base_sha,
    head_before: bindings.head_before,
    manifest_sha256: mDigest,
    authorized_ignored: receiptAuthIgnored,
    candidate: bindings.candidate ?? null,
    invocation_receipt_reference: invocationReceiptReference,
    observed_by_bridge: observedByBridge,
    reported_by_provider: reportedByProvider,
    manifest
  });
}

export function bindCandidateToReceipt(receipt, candidateInfo, candidateTreeArg) {
  if (!receipt || typeof receipt !== 'object') {
    throw new TypeError('receipt must be an object');
  }
  let head, tree;
  if (typeof candidateInfo === 'object' && candidateInfo !== null) {
    head = candidateInfo.candidateHead ?? candidateInfo.head;
    tree = candidateInfo.candidateTree ?? candidateInfo.tree;
  } else if (typeof candidateInfo === 'string') {
    head = candidateInfo;
    tree = candidateTreeArg;
  }
  if (!head || !/^[0-9a-f]{40}$/i.test(head)) {
    throw new Error(`Invalid candidate head SHA: ${head}`);
  }
  if (!tree || !/^[0-9a-f]{40}$/i.test(tree)) {
    throw new Error(`Invalid candidate tree SHA: ${tree}`);
  }
  if (receipt.manifest?.expected_tree && receipt.manifest.expected_tree !== tree) {
    throw new Error(`Candidate tree (${tree}) does not match receipt expected tree (${receipt.manifest.expected_tree})`);
  }
  return Object.freeze({
    ...receipt,
    candidate: Object.freeze({ head, tree })
  });
}

export const finalizeReceiptCandidate = bindCandidateToReceipt;

export function verifyCandidate(cwd, receipt, frozenRecord, invocationRecord) {
  if (!cwd || typeof cwd !== 'string') {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'cwd must be a valid directory path' };
  }

  // 1. Strict Receipt Validation
  if (!receipt || typeof receipt !== 'object') {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing or invalid receipt' };
  }
  if (receipt.schema_version !== RECEIPT_SCHEMA) {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: `Invalid receipt schema_version: expected ${RECEIPT_SCHEMA}, got ${receipt.schema_version}` };
  }
  if (!POLICIES.includes(receipt.policy)) {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: `Invalid receipt policy: expected ${POLICIES.join(' or ')}, got ${receipt.policy}` };
  }
  if (!receipt.bridge_run_id || typeof receipt.bridge_run_id !== 'string') {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing bridge_run_id in receipt' };
  }
  if (!receipt.task_id || typeof receipt.task_id !== 'string') {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing task_id in receipt' };
  }
  if (!Number.isInteger(receipt.revision) || receipt.revision <= 0) {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing or invalid revision in receipt' };
  }
  if (!receipt.contract_sha256 || !/^[0-9a-f]{64}$/i.test(receipt.contract_sha256)) {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing or invalid contract_sha256 in receipt' };
  }
  if (!receipt.config_sha256 || !/^[0-9a-f]{64}$/i.test(receipt.config_sha256)) {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing or invalid config_sha256 in receipt' };
  }
  if (!receipt.bridge_source_sha256 || !/^[0-9a-f]{64}$/i.test(receipt.bridge_source_sha256)) {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing or invalid bridge_source_sha256 in receipt' };
  }
  if (!receipt.designated_implementer || typeof receipt.designated_implementer !== 'string') {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing designated_implementer in receipt' };
  }
  if (!receipt.base_sha || !/^[0-9a-f]{40}$/i.test(receipt.base_sha)) {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing or invalid base_sha in receipt' };
  }
  if (!receipt.head_before || !/^[0-9a-f]{40}$/i.test(receipt.head_before)) {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing or invalid head_before in receipt' };
  }
  if (!receipt.candidate || typeof receipt.candidate !== 'object' || !receipt.candidate.head || !receipt.candidate.tree) {
    return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: 'Candidate is not bound to receipt' };
  }

  // Observed by bridge validation
  const ob = receipt.observed_by_bridge;
  if (!ob || typeof ob !== 'object') {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing observed_by_bridge in receipt' };
  }
  if (!ob.provider || typeof ob.provider !== 'string') {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing observed provider in receipt' };
  }
  if (!ob.requested_model || typeof ob.requested_model !== 'string') {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing observed requested_model in receipt' };
  }
  if (ob.redacted_invocation === undefined || ob.redacted_invocation === null) {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing observed redacted_invocation in receipt' };
  }
  if (!ob.started_at || typeof ob.started_at !== 'string') {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing observed started_at in receipt' };
  }
  if (!ob.finished_at || typeof ob.finished_at !== 'string') {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing observed finished_at in receipt' };
  }
  if (!ob.termination_status || typeof ob.termination_status !== 'string') {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing observed termination_status in receipt' };
  }
  if (typeof ob.timeout !== 'boolean') {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing or invalid observed timeout in receipt' };
  }
  if (!ob.input_packet_hash || !/^[0-9a-f]{64}$/i.test(ob.input_packet_hash)) {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing or invalid observed input_packet_hash in receipt' };
  }
  if (!ob.output_hash || !/^[0-9a-f]{64}$/i.test(ob.output_hash)) {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing or invalid observed output_hash in receipt' };
  }

  // Model & Implementer equality check
  const normReq = normalizeModelName(ob.requested_model);
  if (normalizeModelName(receipt.designated_implementer) !== normReq) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
      reason: `designated_implementer (${receipt.designated_implementer}) does not match requested_model (${ob.requested_model})`
    };
  }

  // Permitted implementers per policy
  const normDesig = normalizeModelName(receipt.designated_implementer);
  if (receipt.policy === POLICY_V2) {
    const validV2 = [normalizeModelName(GEMINI_MODEL), normalizeModelName(LUNA_MODEL), normalizeModelName(SOL_MODEL)];
    if (!validV2.includes(normDesig)) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
        reason: `Policy ${POLICY_V2} requires designated_implementer to be ${GEMINI_MODEL}, ${LUNA_MODEL}, or ${SOL_MODEL}; got: ${receipt.designated_implementer}`
      };
    }
  } else {
    const validV1 = [normalizeModelName(GEMINI_MODEL), normalizeModelName(ASTRA_MODEL)];
    if (!validV1.includes(normDesig)) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
        reason: `Policy ${POLICY_V1} requires designated_implementer to be ${GEMINI_MODEL} or ${ASTRA_MODEL}; got: ${receipt.designated_implementer}`
      };
    }
  }

  // Model-specific effort constraints
  const isAstra = normReq === normalizeModelName(ASTRA_MODEL) || normReq.includes('astra');
  if (isAstra) {
    if (ob.requested_effort !== ASTRA_EFFORT) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
        reason: `Astra effort must be '${ASTRA_EFFORT}', got: ${ob.requested_effort}`
      };
    }
  }
  const isLuna = normReq === normalizeModelName(LUNA_MODEL) || normReq.includes('luna');
  if (isLuna) {
    if (ob.requested_effort !== LUNA_EFFORT) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
        reason: `Luna effort must be '${LUNA_EFFORT}', got: ${ob.requested_effort}`
      };
    }
  }
  const isSol = normReq === normalizeModelName(SOL_MODEL) || normReq.includes('sol');
  if (isSol) {
    if (ob.requested_effort !== SOL_EFFORT) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
        reason: `Sol effort must be '${SOL_EFFORT}', got: ${ob.requested_effort}`
      };
    }
  }

  // Reported by provider validation
  const rp = receipt.reported_by_provider;
  if (!rp || typeof rp !== 'object') {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Missing reported_by_provider in receipt' };
  }
  if (rp.actual_model != null) {
    const normActual = normalizeModelName(rp.actual_model);
    if (normActual !== normReq) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
        reason: `Reported actual_model (${rp.actual_model}) does not match requested_model (${ob.requested_model})`
      };
    }
  }
  if (rp.observed_models != null) {
    if (!Array.isArray(rp.observed_models)) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
        reason: 'Reported observed_models must be an array when provided'
      };
    }
    const validObs = rp.observed_models.filter(m => typeof m === 'string' && m.trim());
    const normObs = [...new Set(validObs.map(normalizeModelName).filter(Boolean))];
    if (normObs.length > 1) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
        reason: `Multiple conflicting observed_models reported: ${validObs.join(', ')}`
      };
    }
    if (normObs.length === 1 && normObs[0] !== normReq) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
        reason: `Reported observed_models (${validObs[0]}) does not match requested_model (${ob.requested_model})`
      };
    }
  }
  if (rp.actual_effort != null) {
    if (typeof rp.actual_effort !== 'string' || !rp.actual_effort.trim()) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
        reason: 'Reported actual_effort must be a non-empty string when provided'
      };
    }
    const normActualEffort = rp.actual_effort.trim().toLowerCase();
    if (ob.requested_effort != null) {
      const normReqEffort = ob.requested_effort.trim().toLowerCase();
      if (normActualEffort !== normReqEffort) {
        return {
          ok: false,
          failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
          reason: `Reported actual_effort (${rp.actual_effort}) does not match requested_effort (${ob.requested_effort})`
        };
      }
    }
    if (isAstra && normActualEffort !== ASTRA_EFFORT) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
        reason: `Astra actual_effort must be '${ASTRA_EFFORT}', got: ${rp.actual_effort}`
      };
    }
    if (isLuna && normActualEffort !== LUNA_EFFORT) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
        reason: `Luna actual_effort must be '${LUNA_EFFORT}', got: ${rp.actual_effort}`
      };
    }
    if (isSol && normActualEffort !== SOL_EFFORT) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
        reason: `Sol actual_effort must be '${SOL_EFFORT}', got: ${rp.actual_effort}`
      };
    }
  }

  // Manifest validation
  if (!receipt.manifest || typeof receipt.manifest !== 'object' || receipt.manifest.schema_version !== MANIFEST_SCHEMA) {
    return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: 'Invalid or missing manifest in receipt' };
  }
  if (receipt.manifest.head_before !== receipt.head_before) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.CONTENT_MISMATCH,
      reason: `Manifest head_before (${receipt.manifest.head_before}) does not match receipt head_before (${receipt.head_before})`
    };
  }
  if (!receipt.manifest.baseline_snapshots || typeof receipt.manifest.baseline_snapshots !== 'object') {
    return {
      ok: false,
      failure_code: FAILURE_CODES.CONTENT_MISMATCH,
      reason: 'Manifest missing or invalid baseline_snapshots'
    };
  }

  let computedManifestSha;
  try {
    computedManifestSha = manifestDigest(receipt.manifest);
  } catch (err) {
    return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: `Malformed manifest: ${err.message}` };
  }
  if (receipt.manifest_sha256 && receipt.manifest_sha256 !== computedManifestSha) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.CONTENT_MISMATCH,
      reason: `Manifest digest (${computedManifestSha}) does not match receipt manifest_sha256 (${receipt.manifest_sha256})`
    };
  }

  // 2. Strict Frozen Record Validation
  if (!frozenRecord || typeof frozenRecord !== 'object') {
    return { ok: false, failure_code: FAILURE_CODES.CONTRACT_MISMATCH, reason: 'Frozen record is missing or invalid' };
  }
  if (frozenRecord.schema_version !== FROZEN_RECORD_SCHEMA) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH,
      reason: `Invalid frozenRecord schema_version: expected ${FROZEN_RECORD_SCHEMA}, got ${frozenRecord.schema_version}`
    };
  }
  if (!frozenRecord.task_id || frozenRecord.task_id !== receipt.task_id) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH,
      reason: `Task ID mismatch: frozenRecord=${frozenRecord.task_id}, receipt=${receipt.task_id}`
    };
  }
  if (!frozenRecord.revision || frozenRecord.revision !== receipt.revision) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH,
      reason: `Revision mismatch: frozenRecord=${frozenRecord.revision}, receipt=${receipt.revision}`
    };
  }
  if (!frozenRecord.contract_sha256 || frozenRecord.contract_sha256 !== receipt.contract_sha256) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH,
      reason: `Contract hash mismatch: frozenRecord=${frozenRecord.contract_sha256}, receipt=${receipt.contract_sha256}`
    };
  }
  if (!frozenRecord.base_sha || frozenRecord.base_sha !== receipt.base_sha) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH,
      reason: `Base SHA mismatch: frozenRecord=${frozenRecord.base_sha}, receipt=${receipt.base_sha}`
    };
  }
  if (frozenRecord.policy && frozenRecord.policy !== receipt.policy) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH,
      reason: `Policy mismatch: frozenRecord=${frozenRecord.policy}, receipt=${receipt.policy}`
    };
  }

  // 3. Strict Invocation Record Validation
  if (!invocationRecord || typeof invocationRecord !== 'object') {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: 'Invocation record is missing or invalid' };
  }
  if (invocationRecord.schema_version !== INVOCATION_RECORD_SCHEMA) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
      reason: `Invalid invocationRecord schema_version: expected ${INVOCATION_RECORD_SCHEMA}, got ${invocationRecord.schema_version}`
    };
  }
  if (invocationRecord.policy && invocationRecord.policy !== receipt.policy) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
      reason: `Policy mismatch: invocation=${invocationRecord.policy}, receipt=${receipt.policy}`
    };
  }
  if (!invocationRecord.bridge_run_id || invocationRecord.bridge_run_id !== receipt.bridge_run_id) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
      reason: `Bridge run_id mismatch: invocation=${invocationRecord.bridge_run_id}, receipt=${receipt.bridge_run_id}`
    };
  }
  if (!invocationRecord.task_id || invocationRecord.task_id !== receipt.task_id) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
      reason: `Task ID mismatch: invocation=${invocationRecord.task_id}, receipt=${receipt.task_id}`
    };
  }
  if (!invocationRecord.revision || invocationRecord.revision !== receipt.revision) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
      reason: `Revision mismatch: invocation=${invocationRecord.revision}, receipt=${receipt.revision}`
    };
  }
  if (!invocationRecord.contract_sha256 || invocationRecord.contract_sha256 !== receipt.contract_sha256) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
      reason: `Contract hash mismatch: invocation=${invocationRecord.contract_sha256}, receipt=${receipt.contract_sha256}`
    };
  }
  if (!invocationRecord.config_sha256 || invocationRecord.config_sha256 !== receipt.config_sha256) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
      reason: `Config hash mismatch: invocation=${invocationRecord.config_sha256}, receipt=${receipt.config_sha256}`
    };
  }
  if (!invocationRecord.bridge_source_sha256 || invocationRecord.bridge_source_sha256 !== receipt.bridge_source_sha256) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
      reason: `Bridge source hash mismatch: invocation=${invocationRecord.bridge_source_sha256}, receipt=${receipt.bridge_source_sha256}`
    };
  }
  if (!invocationRecord.designated_implementer || invocationRecord.designated_implementer !== receipt.designated_implementer) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
      reason: `Designated implementer mismatch: invocation=${invocationRecord.designated_implementer}, receipt=${receipt.designated_implementer}`
    };
  }
  if (!invocationRecord.provider || invocationRecord.provider !== ob.provider) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
      reason: `Provider mismatch: invocation=${invocationRecord.provider}, receipt=${ob.provider}`
    };
  }
  if (!invocationRecord.requested_model || normalizeModelName(invocationRecord.requested_model) !== normalizeModelName(ob.requested_model)) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
      reason: `Model mismatch: invocation=${invocationRecord.requested_model}, receipt=${ob.requested_model}`
    };
  }
  if ((invocationRecord.requested_effort ?? null) !== (ob.requested_effort ?? null)) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
      reason: `Effort mismatch: invocation=${invocationRecord.requested_effort}, receipt=${ob.requested_effort}`
    };
  }
  if (!invocationRecord.input_packet_hash || invocationRecord.input_packet_hash !== ob.input_packet_hash) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
      reason: `Input packet hash mismatch: invocation=${invocationRecord.input_packet_hash}, receipt=${ob.input_packet_hash}`
    };
  }
  if (!invocationRecord.output_hash || invocationRecord.output_hash !== ob.output_hash) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
      reason: `Output hash mismatch: invocation=${invocationRecord.output_hash}, receipt=${ob.output_hash}`
    };
  }
  if (!invocationRecord.manifest_sha256 || invocationRecord.manifest_sha256 !== computedManifestSha) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
      reason: `Manifest digest mismatch: invocation=${invocationRecord.manifest_sha256}, computed=${computedManifestSha}`
    };
  }

  // Only the manifest bound above to the independent invocation digest supplies
  // content hashes. Path-only authorization cannot authorize replacement bytes.
  const receiptIgnoredMap = receipt.manifest.ignored_snapshots ?? receipt.manifest.authorized_ignored ?? {};
  const receiptIgnoredClaim = receipt.authorized_ignored ?? {};
  const ignoredKeys = Object.keys(receiptIgnoredMap);
  if (typeof receiptIgnoredClaim !== 'object' || Array.isArray(receiptIgnoredClaim) ||
      Object.keys(receiptIgnoredClaim).length !== ignoredKeys.length ||
      !ignoredKeys.every(k => Object.hasOwn(receiptIgnoredClaim, k) && receiptIgnoredClaim[k] === receiptIgnoredMap[k])) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.CONTENT_MISMATCH,
      reason: 'Receipt authorized_ignored does not match digest-bound manifest'
    };
  }
  const receiptHasIgnored = receiptIgnoredMap && Object.keys(receiptIgnoredMap).length > 0;

  if (receiptHasIgnored) {
    if (!invocationRecord.authorized_ignored) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
        reason: 'Invocation record missing authorized_ignored required by receipt'
      };
    }
    const rKeys = Object.keys(receiptIgnoredMap);
    if (Array.isArray(invocationRecord.authorized_ignored)) {
      const iSet = new Set(invocationRecord.authorized_ignored);
      if (iSet.size !== rKeys.length || !rKeys.every(k => iSet.has(k))) {
        return {
          ok: false,
          failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
          reason: 'authorized_ignored paths mismatch between invocation record and receipt'
        };
      }
    } else if (typeof invocationRecord.authorized_ignored === 'object' && invocationRecord.authorized_ignored !== null) {
      const iKeys = Object.keys(invocationRecord.authorized_ignored);
      if (iKeys.length !== rKeys.length || !rKeys.every(k => invocationRecord.authorized_ignored[k] === receiptIgnoredMap[k])) {
        return {
          ok: false,
          failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
          reason: 'authorized_ignored mismatch between invocation record and receipt'
        };
      }
    } else {
      return {
        ok: false,
        failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
        reason: 'Invalid invocationRecord.authorized_ignored format'
      };
    }
  } else {
    if (invocationRecord.authorized_ignored && (Array.isArray(invocationRecord.authorized_ignored) ? invocationRecord.authorized_ignored.length > 0 : Object.keys(invocationRecord.authorized_ignored).length > 0)) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.EXECUTION_MISMATCH,
        reason: 'Invocation record specifies authorized_ignored but receipt does not'
      };
    }
  }

  // Reject assume-unchanged and skip-worktree index flags before verify
  try {
    assertNoSuppressionFlags(cwd);
  } catch (err) {
    return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: err.message };
  }

  let currentHead, currentTree;
  try {
    currentHead = gitExec(cwd, ['rev-parse', 'HEAD']).trim();
    currentTree = gitExec(cwd, ['rev-parse', 'HEAD^{tree}']).trim();
  } catch (err) {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: `Git repository error: ${err.message}` };
  }

  if (receipt.candidate.head !== currentHead) {
    return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: `Candidate HEAD mismatch: receipt=${receipt.candidate.head}, current=${currentHead}` };
  }
  if (receipt.candidate.tree !== currentTree) {
    return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: `Candidate tree mismatch: receipt=${receipt.candidate.tree}, current=${currentTree}` };
  }

  const expectedTree = receipt.manifest?.expected_tree;
  if (!expectedTree) {
    return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: 'Receipt manifest missing expected_tree' };
  }
  if (currentTree !== expectedTree) {
    return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: `Committed tree (${currentTree}) does not match receipt expected tree (${expectedTree})` };
  }

  if (currentHead === receipt.head_before) {
    if ((receipt.manifest.entries ?? []).length > 0) {
      return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: 'Manifest has entries but candidate HEAD is unchanged from head_before' };
    }
  } else {
    let parents = [];
    try {
      const parentsOut = gitExec(cwd, ['rev-parse', 'HEAD^@']).trim();
      parents = parentsOut ? parentsOut.split(/\s+/).filter(Boolean) : [];
    } catch {}
    if (!parents.includes(receipt.head_before)) {
      return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: `Committed HEAD parent (${parents.join(', ')}) does not match head_before (${receipt.head_before})` };
    }
  }

  const diffOut = gitExec(cwd, ['diff-tree', '-r', '-z', '--name-status', '--no-commit-id', receipt.head_before, currentHead]);
  const committedChanges = new Map();
  const diffTokens = diffOut ? diffOut.split('\0').filter(Boolean) : [];
  let di = 0;
  while (di < diffTokens.length) {
    const status = diffTokens[di++];
    const p = diffTokens[di++];
    if (status.startsWith('R') || status.startsWith('C')) {
      const newP = diffTokens[di++];
      committedChanges.set(newP, status[0]);
    } else {
      committedChanges.set(p, status[0]);
    }
  }

  const manifestEntries = receipt.manifest?.entries ?? [];
  const manifestMap = new Map(manifestEntries.map(e => [e.path, e]));

  for (const [cPath, cStatus] of committedChanges.entries()) {
    const mEntry = manifestMap.get(cPath);
    if (!mEntry) {
      return { ok: false, failure_code: FAILURE_CODES.SCOPE_VIOLATION, reason: `Extra committed file not in manifest: ${cPath}` };
    }
    if (mEntry.change_type !== cStatus) {
      return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: `Change type mismatch for ${cPath}: committed=${cStatus}, manifest=${mEntry.change_type}` };
    }
  }

  for (const mEntry of manifestEntries) {
    if (!committedChanges.has(mEntry.path)) {
      return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: `Manifest entry not in committed changes: ${mEntry.path}` };
    }
    if (mEntry.change_type !== 'D') {
      const ls = gitExec(cwd, ['ls-tree', currentHead, '--', mEntry.path]).trim();
      const match = ls.match(/^([0-7]+)\s+blob\s+([0-9a-f]{40})\t/);
      if (!match) {
        return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: `Committed blob not found for: ${mEntry.path}` };
      }
      if (match[2] !== mEntry.new_blob_sha) {
        return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: `Committed blob SHA (${match[2]}) does not match manifest (${mEntry.new_blob_sha}) for: ${mEntry.path}` };
      }
      if (match[1] !== mEntry.new_mode) {
        return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: `Committed mode (${match[1]}) does not match manifest (${mEntry.new_mode}) for: ${mEntry.path}` };
      }
      if (match[1] === '120000') {
        return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: `Symlinks prohibited: ${mEntry.path}` };
      }
      if (match[1] === '100755' && mEntry.old_mode !== '100755') {
        return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: `Executable mode change prohibited: ${mEntry.path}` };
      }
    }
  }

  // Validate coverage of baseline snapshots against baseline tree
  let baseTrackedFiles = [];
  try {
    const lsOut = gitExec(cwd, ['ls-tree', '-r', '-z', '--name-only', receipt.head_before]);
    baseTrackedFiles = lsOut ? lsOut.split('\0').filter(Boolean) : [];
  } catch (err) {
    return { ok: false, failure_code: FAILURE_CODES.EXECUTION_MISMATCH, reason: `Failed to inspect baseline tree: ${err.message}` };
  }

  const manifestChangedSet = new Set(manifestEntries.map(e => e.path));
  const expectedBaselineFiles = new Set(baseTrackedFiles.filter(tf => !manifestChangedSet.has(tf)));

  const actualBaselineKeys = Object.keys(receipt.manifest.baseline_snapshots);
  if (actualBaselineKeys.length !== expectedBaselineFiles.size) {
    return {
      ok: false,
      failure_code: FAILURE_CODES.CONTENT_MISMATCH,
      reason: `Baseline snapshots coverage mismatch: expected ${expectedBaselineFiles.size} files, got ${actualBaselineKeys.length}`
    };
  }

  for (const bPath of actualBaselineKeys) {
    if (!expectedBaselineFiles.has(bPath)) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.CONTENT_MISMATCH,
        reason: `Unexpected file in baseline_snapshots: ${bPath}`
      };
    }
    const expectedRawSha = receipt.manifest.baseline_snapshots[bPath];
    if (typeof expectedRawSha !== 'string' || !/^[0-9a-f]{64}$/i.test(expectedRawSha)) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.CONTENT_MISMATCH,
        reason: `Invalid baseline snapshot hash for: ${bPath}`
      };
    }
    const fullP = path.join(cwd, bPath);
    if (!fs.existsSync(fullP)) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.CONTENT_MISMATCH,
        reason: `Tracked baseline file missing from workspace: ${bPath}`
      };
    }
    try {
      assertNoSymlinkOrReparse(cwd, bPath);
    } catch (err) {
      return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: err.message };
    }
    const rawBuf = fs.readFileSync(fullP);
    const rawSha = sha256Hex(rawBuf);
    if (rawSha !== expectedRawSha) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.CONTENT_MISMATCH,
        reason: `Tracked baseline content tamper detected in ${bPath}`
      };
    }
  }

  // Workspace status & Ignored files check
  const statusOut = gitExec(cwd, ['status', '--porcelain=v1', '-z', '-uall', '--ignored']);
  const sTokens = statusOut ? statusOut.split('\0').filter(Boolean) : [];
  const authorizedIgnoredMap = receiptIgnoredMap ?? {};

  for (let si = 0; si < sTokens.length; si++) {
    const sItem = sTokens[si];
    const sx = sItem[0];
    const sy = sItem[1];
    const sPath = sItem.slice(3);
    if (sPath.startsWith('.git/') || sPath === '.git') continue;

    if (sx === '!' && sy === '!') {
      try {
        assertNoSymlinkOrReparse(cwd, sPath);
      } catch (err) {
        return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: err.message };
      }
      if (!authorizedIgnoredMap[sPath]) {
        return {
          ok: false,
          failure_code: FAILURE_CODES.SCOPE_VIOLATION,
          reason: `Unexpected or unauthorized ignored file in workspace: ${sPath}`
        };
      }
      continue;
    }

    return {
      ok: false,
      failure_code: FAILURE_CODES.CONTENT_MISMATCH,
      reason: `Workspace is dirty after candidate commit: ${sPath} (${sx}${sy})`
    };
  }

  // Workspace raw content verification for authorized ignored files
  for (const [iPath, expectedSha] of Object.entries(authorizedIgnoredMap)) {
    const fullP = path.join(cwd, iPath);
    if (!fs.existsSync(fullP)) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.CONTENT_MISMATCH,
        reason: `Authorized ignored file missing from workspace: ${iPath}`
      };
    }
    try {
      assertNoSymlinkOrReparse(cwd, iPath);
    } catch (err) {
      return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: err.message };
    }
    const rawBuf = fs.readFileSync(fullP);
    const rawSha = sha256Hex(rawBuf);
    if (rawSha !== expectedSha) {
      return {
        ok: false,
        failure_code: FAILURE_CODES.CONTENT_MISMATCH,
        reason: `Authorized ignored file content tamper detected in ${iPath}`
      };
    }
  }

  // Workspace raw content verification for changed entries
  for (const entry of manifestEntries) {
    if (entry.change_type !== 'D') {
      const fullP = path.join(cwd, entry.path);
      if (!fs.existsSync(fullP)) {
        return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: `File missing from workspace: ${entry.path}` };
      }
      try {
        assertNoSymlinkOrReparse(cwd, entry.path);
      } catch (err) {
        return { ok: false, failure_code: FAILURE_CODES.CONTENT_MISMATCH, reason: err.message };
      }
      const rawBuf = fs.readFileSync(fullP);
      const rawSha = sha256Hex(rawBuf);
      if (entry.raw_content_sha256 && rawSha !== entry.raw_content_sha256) {
        return {
          ok: false,
          failure_code: FAILURE_CODES.CONTENT_MISMATCH,
          reason: `Post-capture workspace modification detected in ${entry.path}`
        };
      }
    }
  }

  const hooksDir = path.join(cwd, '.git', 'hooks');
  if (fs.existsSync(hooksDir)) {
    const hookFiles = fs.readdirSync(hooksDir);
    for (const hf of hookFiles) {
      if (!hf.endsWith('.sample')) {
        return {
          ok: false,
          failure_code: FAILURE_CODES.CONTENT_MISMATCH,
          reason: `Active hook alteration detected: .git/hooks/${hf}`
        };
      }
    }
  }

  return {
    ok: true,
    candidate_head: currentHead,
    candidate_tree: currentTree
  };
}

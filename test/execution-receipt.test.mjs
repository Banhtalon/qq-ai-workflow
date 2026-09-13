import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  captureManifest,
  buildReceipt,
  verifyCandidate,
  bindCandidateToReceipt,
  finalizeReceiptCandidate,
  assertSafeAllowedPath,
  assertSafeExactPath,
  isPathAllowed,
  manifestDigest,
  normalizeModelName,
  assertNoSuppressionFlags,
  RECEIPT_SCHEMA,
  MANIFEST_SCHEMA,
  FROZEN_RECORD_SCHEMA,
  INVOCATION_RECORD_SCHEMA,
  FAILURE_CODES
} from '../scripts/lib/execution-receipt.mjs';

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

async function createDisposableRepo() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'qq-receipt-test-'));
  const repo = path.join(dir, 'repo');
  await mkdir(repo, { recursive: true });

  execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test Runner'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo, stdio: 'ignore' });

  await writeFile(path.join(repo, 'tracked.txt'), 'initial tracked\n');
  await writeFile(path.join(repo, 'to_delete.txt'), 'will be deleted\n');
  execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: repo, stdio: 'ignore' });

  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  return {
    dir,
    repo,
    baseSha,
    cleanup: async () => {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {}
    }
  };
}

function makeSampleRecords(baseSha, manifest = null) {
  const bridgeRunId = 'bridge-run-001';
  const taskId = 'TASK-RECEIPT-001';
  const revision = 1;
  const contractSha256 = '1'.repeat(64);
  const configSha256 = '2'.repeat(64);
  const bridgeSourceSha256 = '3'.repeat(64);
  const inputPacketHash = '4'.repeat(64);
  const outputHash = '5'.repeat(64);
  const designatedImplementer = 'gemini-3.8-flash-high';
  const manifestSha256 = manifest ? (manifest.digest ?? manifestDigest(manifest)) : '6'.repeat(64);

  const frozenRecord = {
    schema_version: 'qq.workflow.lock.v10',
    task_id: taskId,
    revision,
    contract_sha256: contractSha256,
    base_sha: baseSha
  };

  const invocationRecord = {
    schema_version: 'qq.workflow.invocation.v1',
    bridge_run_id: bridgeRunId,
    task_id: taskId,
    revision,
    contract_sha256: contractSha256,
    config_sha256: configSha256,
    bridge_source_sha256: bridgeSourceSha256,
    designated_implementer: designatedImplementer,
    provider: 'google',
    requested_model: designatedImplementer,
    requested_effort: null,
    input_packet_hash: inputPacketHash,
    output_hash: outputHash,
    manifest_sha256: manifestSha256
  };

  const observed = {
    provider: 'google',
    requested_model: designatedImplementer,
    requested_effort: null,
    redacted_invocation: { argv: ['node', 'cli.js'] },
    started_at: '2026-09-12T10:00:00.000Z',
    finished_at: '2026-09-12T10:01:00.000Z',
    termination_status: 'SUCCESS',
    timeout: false,
    input_packet_hash: inputPacketHash,
    output_hash: outputHash
  };

  const bindings = {
    bridge_run_id: bridgeRunId,
    task_id: taskId,
    revision,
    contract_sha256: contractSha256,
    config_sha256: configSha256,
    bridge_source_sha256: bridgeSourceSha256,
    designated_implementer: designatedImplementer,
    base_sha: baseSha,
    head_before: baseSha,
    invocation_receipt_reference: {
      receipt_root_id: bridgeRunId,
      chain_root_id: bridgeRunId,
      receipt_id: 'receipt-001',
      receipt_sha256: '7'.repeat(64)
    }
  };

  return { frozenRecord, invocationRecord, observed, bindings };
}

test('captureManifest: captures actual allowed new file and deletion, sorts entries, and leaves real index clean', async () => {
  const { repo, baseSha, cleanup } = await createDisposableRepo();
  try {
    await unlink(path.join(repo, 'to_delete.txt'));
    await writeFile(path.join(repo, 'new_allowed.txt'), 'hello from allowed\n');

    const manifest = captureManifest(repo, baseSha, ['to_delete.txt', 'new_allowed.txt']);

    assert.equal(manifest.schema_version, MANIFEST_SCHEMA);
    assert.equal(manifest.head_before, baseSha);
    assert.match(manifest.expected_tree, /^[0-9a-f]{40}$/);
    assert.equal(manifest.entries.length, 2);

    assert.equal(manifest.entries[0].path, 'new_allowed.txt');
    assert.equal(manifest.entries[0].change_type, 'A');
    assert.equal(manifest.entries[0].old_blob_sha, null);
    assert.equal(manifest.entries[0].old_mode, null);
    assert.match(manifest.entries[0].new_blob_sha, /^[0-9a-f]{40}$/);
    assert.equal(manifest.entries[0].new_mode, '100644');
    assert.equal(manifest.entries[0].raw_content_sha256, sha256Hex('hello from allowed\n'));

    assert.equal(manifest.entries[1].path, 'to_delete.txt');
    assert.equal(manifest.entries[1].change_type, 'D');
    assert.match(manifest.entries[1].old_blob_sha, /^[0-9a-f]{40}$/);
    assert.equal(manifest.entries[1].old_mode, '100644');
    assert.equal(manifest.entries[1].new_blob_sha, null);
    assert.equal(manifest.entries[1].new_mode, null);

    const stagedDiff = execFileSync('git', ['diff', '--cached'], { cwd: repo, encoding: 'utf8' });
    assert.equal(stagedDiff.trim(), '');
  } finally {
    await cleanup();
  }
});

test('captureManifest: blocks when unrelated untracked files are present outside allowedPaths', async () => {
  const { repo, baseSha, cleanup } = await createDisposableRepo();
  try {
    await writeFile(path.join(repo, 'unrelated.txt'), 'should block manifest\n');
    assert.throws(
      () => captureManifest(repo, baseSha, ['tracked.txt']),
      /SCOPE_VIOLATION/
    );
  } finally {
    await cleanup();
  }
});

test('captureManifest: blocks when ignored file is within explicitly allowed paths', async () => {
  const { repo, baseSha, cleanup } = await createDisposableRepo();
  try {
    await writeFile(path.join(repo, '.gitignore'), 'ignored_allowed.txt\n');
    execFileSync('git', ['add', '.gitignore'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'add gitignore'], { cwd: repo, stdio: 'ignore' });
    const newBase = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

    await writeFile(path.join(repo, 'ignored_allowed.txt'), 'secret ignored\n');
    assert.throws(
      () => captureManifest(repo, newBase, ['ignored_allowed.txt']),
      /Ignored file within explicitly allowed paths detected/
    );
  } finally {
    await cleanup();
  }
});

test('buildReceipt: preserves null provider fields, rejects inference, and prevents provider spoofing', async () => {
  const { repo, baseSha, cleanup } = await createDisposableRepo();
  try {
    await writeFile(path.join(repo, 'new.txt'), 'content\n');
    const manifest = captureManifest(repo, baseSha, ['new.txt']);
    const { observed, bindings } = makeSampleRecords(baseSha, manifest);

    const receipt = buildReceipt(observed, null, bindings, manifest);
    assert.equal(receipt.schema_version, RECEIPT_SCHEMA);
    assert.equal(receipt.bridge_run_id, bindings.bridge_run_id);
    assert.equal(receipt.reported_by_provider.actual_model, null);
    assert.equal(receipt.reported_by_provider.actual_effort, null);
    assert.equal(receipt.reported_by_provider.session_id, null);
    assert.equal(receipt.reported_by_provider.run_id, null);
    assert.equal(receipt.reported_by_provider.usage, null);
    assert.equal(receipt.reported_by_provider.provider_status, null);

    assert.throws(
      () => buildReceipt(observed, { provider: 'spoofed_provider' }, bindings, manifest),
      /cannot override bridge observations or bindings/
    );

    assert.throws(
      () => buildReceipt(observed, { bridge_run_id: 'spoofed_run' }, bindings, manifest),
      /cannot override bridge observations or bindings/
    );

    assert.throws(
      () => buildReceipt(observed, { requested_model: 'spoofed_model' }, bindings, manifest),
      /cannot override bridge observations or bindings/
    );

    const missingRunBindings = { ...bindings, bridge_run_id: '' };
    assert.throws(
      () => buildReceipt(observed, null, missingRunBindings, manifest),
      /bridge_run_id is required/
    );

    assert.throws(
      () => buildReceipt(observed, null, { ...bindings, invocation_receipt_reference: null }, manifest),
      /missing or invalid invocation receipt reference/
    );
  } finally {
    await cleanup();
  }
});

test('verifyCandidate: passes for unchanged committed candidate matching receipt manifest', async () => {
  const { repo, baseSha, cleanup } = await createDisposableRepo();
  try {
    await writeFile(path.join(repo, 'tracked.txt'), 'worker candidate edit\n');

    const manifest = captureManifest(repo, baseSha, ['tracked.txt']);
    const { frozenRecord, invocationRecord, observed, bindings } = makeSampleRecords(baseSha, manifest);
    const receipt = buildReceipt(observed, null, bindings, manifest);

    execFileSync('git', ['add', 'tracked.txt'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'apply worker candidate'], { cwd: repo, stdio: 'ignore' });

    const candidateHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const candidateTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();

    const finalizedReceipt = finalizeReceiptCandidate(receipt, { candidateHead, candidateTree });
    const result = verifyCandidate(repo, finalizedReceipt, frozenRecord, invocationRecord);

    assert.equal(result.ok, true);
    assert.equal(result.candidate_head, candidateHead);
    assert.equal(result.candidate_tree, candidateTree);
  } finally {
    await cleanup();
  }
});

test('verifyCandidate: invalidates on operator extra commit content or post-capture workspace modification', async () => {
  const { repo, baseSha, cleanup } = await createDisposableRepo();
  try {
    await writeFile(path.join(repo, 'tracked.txt'), 'worker edit\n');

    const manifest = captureManifest(repo, baseSha, ['tracked.txt']);
    const { frozenRecord, invocationRecord, observed, bindings } = makeSampleRecords(baseSha, manifest);
    const receipt = buildReceipt(observed, null, bindings, manifest);

    // Operator commits extra file not in manifest
    await writeFile(path.join(repo, 'extra.txt'), 'operator extra\n');
    execFileSync('git', ['add', 'tracked.txt', 'extra.txt'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'operator tainted commit'], { cwd: repo, stdio: 'ignore' });

    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();

    // bindCandidateToReceipt rejects because committed tree doesn't match expected tree
    assert.throws(
      () => bindCandidateToReceipt(receipt, { candidateHead: head, candidateTree: tree }),
      /does not match receipt expected tree/
    );

    const nonFinalizedReceipt = { ...receipt, candidate: { head, tree } };
    const r1 = verifyCandidate(repo, nonFinalizedReceipt, frozenRecord, invocationRecord);
    assert.equal(r1.ok, false);
    assert.equal(r1.failure_code, FAILURE_CODES.CONTENT_MISMATCH);
  } finally {
    await cleanup();
  }
});

test('verifyCandidate: detects post-capture workspace modification even if committed tree matched', async () => {
  const { repo, baseSha, cleanup } = await createDisposableRepo();
  try {
    await writeFile(path.join(repo, 'tracked.txt'), 'worker edit\n');

    const manifest = captureManifest(repo, baseSha, ['tracked.txt']);
    const { frozenRecord, invocationRecord, observed, bindings } = makeSampleRecords(baseSha, manifest);
    const receipt = buildReceipt(observed, null, bindings, manifest);

    execFileSync('git', ['add', 'tracked.txt'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'candidate commit'], { cwd: repo, stdio: 'ignore' });

    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();
    const finalizedReceipt = finalizeReceiptCandidate(receipt, { candidateHead: head, candidateTree: tree });

    // Tamper with file in workspace after commit
    await writeFile(path.join(repo, 'tracked.txt'), 'tampered after commit\n');

    const r = verifyCandidate(repo, finalizedReceipt, frozenRecord, invocationRecord);
    assert.equal(r.ok, false);
    assert.equal(r.failure_code, FAILURE_CODES.CONTENT_MISMATCH);
    assert.match(r.reason, /dirty|Post-capture workspace modification/i);
  } finally {
    await cleanup();
  }
});

test('captureManifest and verifyCandidate: handles legitimate CRLF normalization', async () => {
  const { repo, baseSha, cleanup } = await createDisposableRepo();
  try {
    await writeFile(path.join(repo, '.gitattributes'), '*.txt text eol=lf\n');
    execFileSync('git', ['add', '.gitattributes'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'add gitattributes'], { cwd: repo, stdio: 'ignore' });
    const newBase = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

    // Write CRLF content in worktree
    await writeFile(path.join(repo, 'crlf.txt'), 'line1\r\nline2\r\n');
    const manifest = captureManifest(repo, newBase, ['crlf.txt']);

    assert.equal(manifest.entries[0].raw_content_sha256, sha256Hex('line1\r\nline2\r\n'));
    assert.match(manifest.entries[0].new_blob_sha, /^[0-9a-f]{40}$/);

    const { frozenRecord, invocationRecord, observed, bindings } = makeSampleRecords(newBase, manifest);
    const receipt = buildReceipt(observed, null, bindings, manifest);

    execFileSync('git', ['add', 'crlf.txt'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'crlf commit'], { cwd: repo, stdio: 'ignore' });

    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();
    const finalized = bindCandidateToReceipt(receipt, { candidateHead: head, candidateTree: tree });

    const res = verifyCandidate(repo, finalized, frozenRecord, invocationRecord);
    assert.equal(res.ok, true);
  } finally {
    await cleanup();
  }
});

test('verifyCandidate: fails closed on missing or mismatched frozen record and invocation record', async () => {
  const { repo, baseSha, cleanup } = await createDisposableRepo();
  try {
    await writeFile(path.join(repo, 'tracked.txt'), 'edit\n');
    const manifest = captureManifest(repo, baseSha, ['tracked.txt']);
    const { frozenRecord, invocationRecord, observed, bindings } = makeSampleRecords(baseSha, manifest);
    const receipt = buildReceipt(observed, null, bindings, manifest);

    execFileSync('git', ['add', 'tracked.txt'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'commit'], { cwd: repo, stdio: 'ignore' });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();
    const finalized = bindCandidateToReceipt(receipt, { candidateHead: head, candidateTree: tree });

    const rNoFrozen = verifyCandidate(repo, finalized, null, invocationRecord);
    assert.equal(rNoFrozen.ok, false);
    assert.equal(rNoFrozen.failure_code, FAILURE_CODES.CONTRACT_MISMATCH);

    const rNoInvoc = verifyCandidate(repo, finalized, frozenRecord, null);
    assert.equal(rNoInvoc.ok, false);
    assert.equal(rNoInvoc.failure_code, FAILURE_CODES.EXECUTION_MISMATCH);

    const rMismatchedRunId = verifyCandidate(repo, finalized, frozenRecord, {
      ...invocationRecord,
      bridge_run_id: 'mismatched-run-id'
    });
    assert.equal(rMismatchedRunId.ok, false);
    assert.equal(rMismatchedRunId.failure_code, FAILURE_CODES.EXECUTION_MISMATCH);

    const rMismatchedContract = verifyCandidate(repo, finalized, {
      ...frozenRecord,
      contract_sha256: '9'.repeat(64)
    }, invocationRecord);
    assert.equal(rMismatchedContract.ok, false);
    assert.equal(rMismatchedContract.failure_code, FAILURE_CODES.CONTRACT_MISMATCH);
  } finally {
    await cleanup();
  }
});

test('path safety: rejects traversal, absolute paths, and .git target paths', () => {
  assert.throws(() => assertSafeAllowedPath('../escape.txt'), /Path traversal/);
  assert.throws(() => assertSafeAllowedPath('foo/../../bar.txt'), /Path traversal/);
  assert.throws(() => assertSafeAllowedPath('/abs/file.txt'), /Absolute allowed path prohibited/);
  assert.throws(() => assertSafeAllowedPath('C:/Windows/file.txt'), /Absolute allowed path prohibited|Colon in allowed path prohibited/);
  assert.throws(() => assertSafeAllowedPath('foo:bar.txt'), /Colon in allowed path prohibited/);
  assert.throws(() => assertSafeAllowedPath('.git/hooks/pre-commit'), /cannot target \.git internals/);
  assert.throws(() => assertSafeAllowedPath(''), /non-empty string/);

  assert.throws(() => assertSafeExactPath('ignored/'), /Directory prefixes prohibited/);

  assert.equal(isPathAllowed('src/lib/code.js', ['src/']), true);
  assert.equal(isPathAllowed('src/lib/code.js', ['src/lib/code.js']), true);
  assert.equal(isPathAllowed('src_other/code.js', ['src/']), false);
  assert.equal(isPathAllowed('other.js', ['src/']), false);
});

test('verifyCandidate: blocks on active hook alteration in repository', async () => {
  const { repo, baseSha, cleanup } = await createDisposableRepo();
  try {
    await writeFile(path.join(repo, 'tracked.txt'), 'valid edit\n');
    const manifest = captureManifest(repo, baseSha, ['tracked.txt']);
    const { frozenRecord, invocationRecord, observed, bindings } = makeSampleRecords(baseSha, manifest);
    const receipt = buildReceipt(observed, null, bindings, manifest);

    execFileSync('git', ['add', 'tracked.txt'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'valid commit'], { cwd: repo, stdio: 'ignore' });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();
    const finalized = bindCandidateToReceipt(receipt, { candidateHead: head, candidateTree: tree });

    // Inject active hook into .git/hooks
    await writeFile(path.join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');

    const res = verifyCandidate(repo, finalized, frozenRecord, invocationRecord);
    assert.equal(res.ok, false);
    assert.equal(res.failure_code, FAILURE_CODES.CONTENT_MISMATCH);
    assert.match(res.reason, /Active hook alteration detected/);
  } finally {
    await cleanup();
  }
});

// =========================================================================
// REGRESSION SUITE: Astra Review Holes 1 - 5 (and Repair 2 issues 1 - 3)
// =========================================================================

test('regression 1: verifyCandidate rejects empty, partial, or malformed records up front', async () => {
  const { repo, baseSha, cleanup } = await createDisposableRepo();
  try {
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();

    // 1. Exact hole reproduced: stub receipt with empty frozenRecord and invocationRecord
    const stubReceipt = {
      schema_version: RECEIPT_SCHEMA,
      head_before: baseSha,
      manifest: { expected_tree: tree, entries: [] }
    };
    const rEmpty = verifyCandidate(repo, stubReceipt, {}, {});
    assert.equal(rEmpty.ok, false);
    assert.equal(rEmpty.failure_code, FAILURE_CODES.EXECUTION_MISMATCH);

    // 2. Missing receipt or empty objects
    assert.equal(verifyCandidate(repo, null, {}, {}).ok, false);
    assert.equal(verifyCandidate(repo, {}, {}, {}).ok, false);

    // 3. Valid receipt structure but malformed record schemas
    await writeFile(path.join(repo, 'tracked.txt'), 'new content\n');
    const manifest = captureManifest(repo, baseSha, ['tracked.txt']);
    const { frozenRecord, invocationRecord, observed, bindings } = makeSampleRecords(baseSha, manifest);
    const receipt = buildReceipt(observed, null, bindings, manifest);

    execFileSync('git', ['add', 'tracked.txt'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'apply new content'], { cwd: repo, stdio: 'ignore' });
    const candidateHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const candidateTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();
    const finalized = finalizeReceiptCandidate(receipt, { candidateHead, candidateTree });

    // Missing schema on frozenRecord
    const rBadFrozenSchema = verifyCandidate(repo, finalized, { ...frozenRecord, schema_version: 'bad.schema' }, invocationRecord);
    assert.equal(rBadFrozenSchema.ok, false);
    assert.equal(rBadFrozenSchema.failure_code, FAILURE_CODES.CONTRACT_MISMATCH);

    // Missing schema on invocationRecord
    const rBadInvocSchema = verifyCandidate(repo, finalized, frozenRecord, { ...invocationRecord, schema_version: 'bad.schema' });
    assert.equal(rBadInvocSchema.ok, false);
    assert.equal(rBadInvocSchema.failure_code, FAILURE_CODES.EXECUTION_MISMATCH);

    // Unbound candidate on receipt
    const rNoCandidate = verifyCandidate(repo, receipt, frozenRecord, invocationRecord);
    assert.equal(rNoCandidate.ok, false);
    assert.equal(rNoCandidate.failure_code, FAILURE_CODES.CONTENT_MISMATCH);

    // Manifest digest tamper against invocation record
    const rMismatchedManifestDigest = verifyCandidate(repo, finalized, frozenRecord, {
      ...invocationRecord,
      manifest_sha256: '9'.repeat(64)
    });
    assert.equal(rMismatchedManifestDigest.ok, false);
    assert.equal(rMismatchedManifestDigest.failure_code, FAILURE_CODES.EXECUTION_MISMATCH);
  } finally {
    await cleanup();
  }
});

test('regression 2: rejects reported actual_model WRONG, mismatched bridge source/implementer, and enforces Astra low effort', async () => {
  const { repo, baseSha, cleanup } = await createDisposableRepo();
  try {
    await writeFile(path.join(repo, 'tracked.txt'), 'candidate edit\n');
    const manifest = captureManifest(repo, baseSha, ['tracked.txt']);
    const { frozenRecord, invocationRecord, observed, bindings } = makeSampleRecords(baseSha, manifest);

    // 1. buildReceipt throws when reported actual_model does not match requested model
    assert.throws(
      () => buildReceipt(observed, { actual_model: 'wrong-model' }, bindings, manifest),
      /Reported actual_model .* does not match/
    );

    // 2. buildReceipt accepts normalized model name
    const receiptWithNormalized = buildReceipt(
      observed,
      { actual_model: 'models/gemini-3.8-flash-high:latest' },
      bindings,
      manifest
    );
    assert.equal(receiptWithNormalized.reported_by_provider.actual_model, 'models/gemini-3.8-flash-high:latest');

    // 3. verifyCandidate rejects receipt with wrong reported actual_model
    execFileSync('git', ['add', 'tracked.txt'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'candidate commit'], { cwd: repo, stdio: 'ignore' });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();
    const fin = finalizeReceiptCandidate(receiptWithNormalized, { candidateHead: head, candidateTree: tree });

    const tamperedModelReceipt = {
      ...fin,
      reported_by_provider: { ...fin.reported_by_provider, actual_model: 'gpt-4o' }
    };
    const rWrongActual = verifyCandidate(repo, tamperedModelReceipt, frozenRecord, invocationRecord);
    assert.equal(rWrongActual.ok, false);
    assert.equal(rWrongActual.failure_code, FAILURE_CODES.EXECUTION_MISMATCH);

    // 4. verifyCandidate rejects mismatched bridge_source_sha256 in invocationRecord
    const rSourceMismatch = verifyCandidate(repo, fin, frozenRecord, {
      ...invocationRecord,
      bridge_source_sha256: '9'.repeat(64)
    });
    assert.equal(rSourceMismatch.ok, false);
    assert.equal(rSourceMismatch.failure_code, FAILURE_CODES.EXECUTION_MISMATCH);

    // 5. verifyCandidate rejects mismatched designated_implementer in invocationRecord
    const rImplementerMismatch = verifyCandidate(repo, fin, frozenRecord, {
      ...invocationRecord,
      designated_implementer: 'different-implementer'
    });
    assert.equal(rImplementerMismatch.ok, false);
    assert.equal(rImplementerMismatch.failure_code, FAILURE_CODES.EXECUTION_MISMATCH);

    // 6. Astra effort must be low: reject medium/high/null
    const astraObservedBadEffort = {
      ...observed,
      requested_model: 'gpt-6-astra',
      requested_effort: 'medium'
    };
    const astraBindings = {
      ...bindings,
      designated_implementer: 'gpt-6-astra'
    };
    assert.throws(
      () => buildReceipt(astraObservedBadEffort, null, astraBindings, manifest),
      /Astra effort must be 'low'/
    );

    // Valid Astra low effort
    const astraObservedLow = {
      ...observed,
      requested_model: 'gpt-6-astra',
      requested_effort: 'low'
    };
    const astraReceipt = buildReceipt(astraObservedLow, null, astraBindings, manifest);
    const astraFin = finalizeReceiptCandidate(astraReceipt, { candidateHead: head, candidateTree: tree });
    const astraInvoc = {
      ...invocationRecord,
      designated_implementer: 'gpt-6-astra',
      requested_model: 'gpt-6-astra',
      requested_effort: 'low',
      manifest_sha256: astraReceipt.manifest_sha256
    };
    const rAstraOk = verifyCandidate(repo, astraFin, frozenRecord, astraInvoc);
    assert.equal(rAstraOk.ok, true);

    // Verify rejection if receipt effort is tampered
    const astraTamperedEffort = {
      ...astraFin,
      observed_by_bridge: { ...astraFin.observed_by_bridge, requested_effort: 'high' }
    };
    const rAstraBad = verifyCandidate(repo, astraTamperedEffort, frozenRecord, { ...astraInvoc, requested_effort: 'high' });
    assert.equal(rAstraBad.ok, false);
    assert.equal(rAstraBad.failure_code, FAILURE_CODES.EXECUTION_MISMATCH);
  } finally {
    await cleanup();
  }
});

test('regression 3: rejects assume-unchanged / skip-worktree suppression flags and catches raw content tamper outside manifest', async () => {
  const { repo, baseSha, cleanup } = await createDisposableRepo();
  try {
    // Add b.txt as an existing tracked file outside allowed scope ['tracked.txt']
    await writeFile(path.join(repo, 'b.txt'), 'original b content\n');
    execFileSync('git', ['add', 'b.txt'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'commit b.txt'], { cwd: repo, stdio: 'ignore' });
    const newBase = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

    // 1. Worker modifies b.txt with --assume-unchanged
    await writeFile(path.join(repo, 'b.txt'), 'tampered b with assume-unchanged\n');
    execFileSync('git', ['update-index', '--assume-unchanged', 'b.txt'], { cwd: repo, stdio: 'ignore' });

    // captureManifest must reject the assume-unchanged flag
    assert.throws(
      () => captureManifest(repo, newBase, ['tracked.txt']),
      /assume-unchanged flag detected on: b\.txt/
    );

    // 2. Reset assume-unchanged and test --skip-worktree
    execFileSync('git', ['update-index', '--no-assume-unchanged', 'b.txt'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['update-index', '--skip-worktree', 'b.txt'], { cwd: repo, stdio: 'ignore' });

    assert.throws(
      () => captureManifest(repo, newBase, ['tracked.txt']),
      /skip-worktree flag detected on: b\.txt/
    );

    // 3. Clean up suppression flags and restore clean baseline
    execFileSync('git', ['update-index', '--no-skip-worktree', 'b.txt'], { cwd: repo, stdio: 'ignore' });
    await writeFile(path.join(repo, 'b.txt'), 'original b content\n');
    execFileSync('git', ['checkout', 'b.txt'], { cwd: repo, stdio: 'ignore' });

    // 4. Capture valid manifest for tracked.txt only
    await writeFile(path.join(repo, 'tracked.txt'), 'allowed candidate change\n');
    const manifest = captureManifest(repo, newBase, ['tracked.txt']);
    assert.equal(manifest.entries.length, 1);
    assert.ok(manifest.baseline_snapshots['b.txt']);

    const { frozenRecord, invocationRecord, observed, bindings } = makeSampleRecords(newBase, manifest);
    const receipt = buildReceipt(observed, null, bindings, manifest);

    execFileSync('git', ['add', 'tracked.txt'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'commit tracked.txt'], { cwd: repo, stdio: 'ignore' });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();
    const fin = finalizeReceiptCandidate(receipt, { candidateHead: head, candidateTree: tree });

    // Working directory is clean -> passes
    assert.equal(verifyCandidate(repo, fin, frozenRecord, invocationRecord).ok, true);

    // Tamper with b.txt raw bytes after capture
    await writeFile(path.join(repo, 'b.txt'), 'tampered b raw bytes\n');
    const rTampered = verifyCandidate(repo, fin, frozenRecord, invocationRecord);
    assert.equal(rTampered.ok, false);
    assert.equal(rTampered.failure_code, FAILURE_CODES.CONTENT_MISMATCH);
    assert.match(rTampered.reason, /Tracked baseline content tamper detected|dirty/);
  } finally {
    await cleanup();
  }
});

test('regression 4: accounts for ignored files; blocks newly introduced ignored files without authorized baseline', async () => {
  const { repo, baseSha, cleanup } = await createDisposableRepo();
  try {
    await writeFile(path.join(repo, '.gitignore'), 'evil.txt\nauthorized_dir/\n');
    execFileSync('git', ['add', '.gitignore'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'add gitignore'], { cwd: repo, stdio: 'ignore' });
    const newBase = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

    // Introduce evil.txt which matches .gitignore
    await writeFile(path.join(repo, 'evil.txt'), 'malicious payload\n');

    // 1. captureManifest fails closed on unexpected ignored file without authorized baseline
    assert.throws(
      () => captureManifest(repo, newBase, ['tracked.txt']),
      /SCOPE_VIOLATION: Unexpected or newly introduced ignored file detected/
    );

    // Directory prefix in authorizedIgnored is prohibited
    assert.throws(
      () => captureManifest(repo, newBase, ['tracked.txt'], { authorizedIgnored: ['authorized_dir/'] }),
      /Directory prefixes prohibited in authorized_ignored/
    );

    // Remove evil.txt and create authorized ignored exact file
    await unlink(path.join(repo, 'evil.txt'));
    await mkdir(path.join(repo, 'authorized_dir'), { recursive: true });
    await writeFile(path.join(repo, 'authorized_dir', 'cache.json'), '{"cached": true}');

    // 2. captureManifest passes when exact file path is authorized
    await writeFile(path.join(repo, 'tracked.txt'), 'authorized edit\n');
    const manifest = captureManifest(repo, newBase, ['tracked.txt'], {
      authorizedIgnored: ['authorized_dir/cache.json']
    });
    assert.equal(manifest.entries.length, 1);
    assert.ok(manifest.ignored_snapshots['authorized_dir/cache.json']);

    const { frozenRecord, invocationRecord, observed, bindings } = makeSampleRecords(newBase, manifest);
    bindings.authorized_ignored = ['authorized_dir/cache.json'];
    invocationRecord.authorized_ignored = ['authorized_dir/cache.json'];
    const receipt = buildReceipt(observed, null, bindings, manifest);

    execFileSync('git', ['add', 'tracked.txt'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'commit edit'], { cwd: repo, stdio: 'ignore' });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();
    const fin = finalizeReceiptCandidate(receipt, { candidateHead: head, candidateTree: tree });

    // verifyCandidate passes with authorized ignored baseline bound to invocation record
    const rAuthOk = verifyCandidate(repo, fin, frozenRecord, invocationRecord);
    assert.equal(rAuthOk.ok, true);

    // 3. Introduce evil.txt into workspace after candidate commit
    await writeFile(path.join(repo, 'evil.txt'), 'post-commit evil\n');
    const rEvil = verifyCandidate(repo, fin, frozenRecord, invocationRecord);
    assert.equal(rEvil.ok, false);
    assert.equal(rEvil.failure_code, FAILURE_CODES.SCOPE_VIOLATION);
    assert.match(rEvil.reason, /Unexpected or unauthorized ignored file/);
  } finally {
    await cleanup();
  }
});

// =========================================================================
// NEW REGRESSIONS: Astra Low Re-review Material Issues 1, 2, 3
// =========================================================================

test('repair2 issue 1 regression: no unverified receipt exemptions; directory prefixes and newly created ignored files fail', async () => {
  const { repo, baseSha, cleanup } = await createDisposableRepo();
  try {
    await writeFile(path.join(repo, '.gitignore'), 'ignored/\n');
    execFileSync('git', ['add', '.gitignore'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'add gitignore for ignored/'], { cwd: repo, stdio: 'ignore' });
    const newBase = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

    await mkdir(path.join(repo, 'ignored'), { recursive: true });
    await writeFile(path.join(repo, 'ignored', 'preexisting.txt'), 'legit preexisting\n');

    // 1. Directory prefix in options is rejected fail-closed
    assert.throws(
      () => captureManifest(repo, newBase, ['tracked.txt'], { authorizedIgnored: ['ignored/'] }),
      /Directory prefixes prohibited/
    );

    // 2. Exact file path captures trusted baseline
    await writeFile(path.join(repo, 'tracked.txt'), 'worker change\n');
    const manifest = captureManifest(repo, newBase, ['tracked.txt'], {
      authorizedIgnored: ['ignored/preexisting.txt']
    });

    const { frozenRecord, invocationRecord, observed, bindings } = makeSampleRecords(newBase, manifest);

    // 3. Adding exemption ONLY to receipt/bindings without invocation record fails
    bindings.authorized_ignored = ['ignored/preexisting.txt'];
    const receiptWithoutInvoc = buildReceipt(observed, null, bindings, manifest);

    execFileSync('git', ['add', 'tracked.txt'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'commit candidate'], { cwd: repo, stdio: 'ignore' });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();
    const finalizedNoInvoc = finalizeReceiptCandidate(receiptWithoutInvoc, { candidateHead: head, candidateTree: tree });

    const rNoInvoc = verifyCandidate(repo, finalizedNoInvoc, frozenRecord, invocationRecord);
    assert.equal(rNoInvoc.ok, false);
    assert.equal(rNoInvoc.failure_code, FAILURE_CODES.EXECUTION_MISMATCH);
    assert.match(rNoInvoc.reason, /Invocation record missing authorized_ignored/);

    // 4. Properly bound invocation record passes
    const validInvoc = {
      ...invocationRecord,
      authorized_ignored: { 'ignored/preexisting.txt': manifest.ignored_snapshots['ignored/preexisting.txt'] }
    };
    const rValid = verifyCandidate(repo, finalizedNoInvoc, frozenRecord, validInvoc);
    assert.equal(rValid.ok, true);
    const pathOnlyInvoc = {
      ...invocationRecord,
      authorized_ignored: ['ignored/preexisting.txt']
    };
    assert.equal(verifyCandidate(repo, finalizedNoInvoc, frozenRecord, pathOnlyInvoc).ok, true);

    // 5. Newly created file under ignored/evil.txt fails closed (trusted dir prefix does not exempt arbitrary files below it)
    await writeFile(path.join(repo, 'ignored', 'evil.txt'), 'malicious payload\n');
    const rEvil = verifyCandidate(repo, finalizedNoInvoc, frozenRecord, validInvoc);
    assert.equal(rEvil.ok, false);
    assert.equal(rEvil.failure_code, FAILURE_CODES.SCOPE_VIOLATION);
    assert.match(rEvil.reason, /Unexpected or unauthorized ignored file in workspace: ignored\/evil\.txt/);

    // 6. Modification to preexisting ignored file fails closed
    await unlink(path.join(repo, 'ignored', 'evil.txt'));
    await writeFile(path.join(repo, 'ignored', 'preexisting.txt'), 'tampered content\n');
    const rTampered = verifyCandidate(repo, finalizedNoInvoc, frozenRecord, validInvoc);
    assert.equal(rTampered.ok, false);
    assert.equal(rTampered.failure_code, FAILURE_CODES.CONTENT_MISMATCH);
    assert.match(rTampered.reason, /Authorized ignored file content tamper detected/);

    // Path authorization cannot replace the digest-bound content baseline.
    const forgedIgnoredReceipt = {
      ...finalizedNoInvoc,
      authorized_ignored: { 'ignored/preexisting.txt': sha256Hex('tampered content\n') }
    };
    assert.equal(forgedIgnoredReceipt.manifest_sha256, invocationRecord.manifest_sha256);
    const rForged = verifyCandidate(repo, forgedIgnoredReceipt, frozenRecord, pathOnlyInvoc);
    assert.equal(rForged.ok, false);
    assert.equal(rForged.failure_code, FAILURE_CODES.CONTENT_MISMATCH);
    assert.match(rForged.reason, /authorized_ignored does not match digest-bound manifest/);
  } finally {
    await cleanup();
  }
});

test('repair2 issue 2 regression: actual_effort preserved, explicit mismatches blocked, Astra low enforced', async () => {
  const { repo, baseSha, cleanup } = await createDisposableRepo();
  try {
    await writeFile(path.join(repo, 'tracked.txt'), 'change\n');
    const manifest = captureManifest(repo, baseSha, ['tracked.txt']);
    const { frozenRecord, invocationRecord, observed, bindings } = makeSampleRecords(baseSha, manifest);

    // 1. Unknown / unavailable actual_effort preserved as null when requested_effort is null
    const receiptNullEffort = buildReceipt(observed, { actual_effort: null }, bindings, manifest);
    assert.equal(receiptNullEffort.reported_by_provider.actual_effort, null);

    execFileSync('git', ['add', 'tracked.txt'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'commit change'], { cwd: repo, stdio: 'ignore' });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();
    const finNull = finalizeReceiptCandidate(receiptNullEffort, { candidateHead: head, candidateTree: tree });
    const rNullOk = verifyCandidate(repo, finNull, frozenRecord, invocationRecord);
    assert.equal(rNullOk.ok, true);

    // 2. Observed high / reported low: explicit mismatch rejected
    const observedHigh = { ...observed, requested_effort: 'high' };
    assert.throws(
      () => buildReceipt(observedHigh, { actual_effort: 'low' }, bindings, manifest),
      /Reported actual_effort \(low\) does not match requested_effort \(high\)/
    );

    // In verifyCandidate: tampered receipt reporting low when high requested fails
    const receiptHigh = buildReceipt(observedHigh, { actual_effort: 'high' }, bindings, manifest);
    const finHigh = finalizeReceiptCandidate(receiptHigh, { candidateHead: head, candidateTree: tree });
    const invocHigh = { ...invocationRecord, requested_effort: 'high' };
    const tamperedReportedLow = {
      ...finHigh,
      reported_by_provider: { ...finHigh.reported_by_provider, actual_effort: 'low' }
    };
    const rMismatchLow = verifyCandidate(repo, tamperedReportedLow, frozenRecord, invocHigh);
    assert.equal(rMismatchLow.ok, false);
    assert.equal(rMismatchLow.failure_code, FAILURE_CODES.EXECUTION_MISMATCH);
    assert.match(rMismatchLow.reason, /Reported actual_effort .* does not match requested_effort/);

    // 3. Astra low / reported high: Astra model with reported high effort blocked
    const astraObserved = {
      ...observed,
      requested_model: 'gpt-6-astra',
      requested_effort: 'low'
    };
    const astraBindings = {
      ...bindings,
      designated_implementer: 'gpt-6-astra'
    };
    assert.throws(
      () => buildReceipt(astraObserved, { actual_effort: 'high' }, astraBindings, manifest),
      /Reported actual_effort \(high\) does not match requested_effort \(low\)/
    );

    const astraReceipt = buildReceipt(astraObserved, { actual_effort: 'low' }, astraBindings, manifest);
    assert.equal(astraReceipt.reported_by_provider.actual_effort, 'low');
    const astraFin = finalizeReceiptCandidate(astraReceipt, { candidateHead: head, candidateTree: tree });
    const astraInvoc = {
      ...invocationRecord,
      designated_implementer: 'gpt-6-astra',
      requested_model: 'gpt-6-astra',
      requested_effort: 'low',
      manifest_sha256: astraReceipt.manifest_sha256
    };
    assert.equal(verifyCandidate(repo, astraFin, frozenRecord, astraInvoc).ok, true);

    const astraTamperedHigh = {
      ...astraFin,
      reported_by_provider: { ...astraFin.reported_by_provider, actual_effort: 'high' }
    };
    const rAstraHighBlocked = verifyCandidate(repo, astraTamperedHigh, frozenRecord, astraInvoc);
    assert.equal(rAstraHighBlocked.ok, false);
    assert.equal(rAstraHighBlocked.failure_code, FAILURE_CODES.EXECUTION_MISMATCH);
    assert.match(rAstraHighBlocked.reason, /Reported actual_effort \(high\) does not match requested_effort \(low\)/);
  } finally {
    await cleanup();
  }
});

test('repair2 issue 3 regression: manifestDigest binds baseline_snapshots; CRLF raw tamper and baseline removal/tamper fail', async () => {
  const { repo, baseSha, cleanup } = await createDisposableRepo();
  try {
    // Disposable repo with tracked unchanged file having LF content
    await writeFile(path.join(repo, '.gitattributes'), '*.txt text eol=lf\n');
    await writeFile(path.join(repo, 'unchanged.txt'), 'line1\nline2\n');
    execFileSync('git', ['add', '.gitattributes', 'unchanged.txt'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'add gitattributes and unchanged.txt'], { cwd: repo, stdio: 'ignore' });
    const newBase = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

    // 1. Candidate modifies tracked.txt (allowed), captures manifest including baseline_snapshots of unchanged.txt
    await writeFile(path.join(repo, 'tracked.txt'), 'worker edit\n');
    const manifest = captureManifest(repo, newBase, ['tracked.txt']);

    assert.ok(manifest.baseline_snapshots['unchanged.txt']);
    const expectedUnchangedHash = manifest.baseline_snapshots['unchanged.txt'];
    assert.equal(expectedUnchangedHash, sha256Hex('line1\nline2\n'));

    // manifestDigest deterministically binds baseline_snapshots
    const initialDigest = manifestDigest(manifest);
    assert.equal(manifest.digest, initialDigest);

    const { frozenRecord, invocationRecord, observed, bindings } = makeSampleRecords(newBase, manifest);
    const receipt = buildReceipt(observed, null, bindings, manifest);

    execFileSync('git', ['add', 'tracked.txt'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'apply candidate edit'], { cwd: repo, stdio: 'ignore' });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();
    const fin = finalizeReceiptCandidate(receipt, { candidateHead: head, candidateTree: tree });

    // Untampered workspace passes
    const rClean = verifyCandidate(repo, fin, frozenRecord, invocationRecord);
    assert.equal(rClean.ok, true);

    // 2. Real CRLF raw content change in otherwise unchanged tracked file
    // Worktree file changed to CRLF: git blob normalization might consider content clean,
    // but raw working bytes are tampered
    await writeFile(path.join(repo, 'unchanged.txt'), 'line1\r\nline2\r\n');

    // verifyCandidate detects raw content tamper against baseline_snapshots
    const rCrlfTampered = verifyCandidate(repo, fin, frozenRecord, invocationRecord);
    assert.equal(rCrlfTampered.ok, false);
    assert.equal(rCrlfTampered.failure_code, FAILURE_CODES.CONTENT_MISMATCH);
    assert.match(rCrlfTampered.reason, /Tracked baseline content tamper detected in unchanged\.txt/);

    // 3. Proving removal of baseline_snapshots cannot make it pass (no optional bypass)
    const strippedBaselineReceipt = {
      ...fin,
      manifest: {
        ...fin.manifest,
        baseline_snapshots: null
      }
    };
    const rStripped = verifyCandidate(repo, strippedBaselineReceipt, frozenRecord, invocationRecord);
    assert.equal(rStripped.ok, false);
    assert.equal(rStripped.failure_code, FAILURE_CODES.CONTENT_MISMATCH);
    assert.match(rStripped.reason, /Manifest missing or invalid baseline_snapshots/);

    // 4. Proving tamper of baseline_snapshots to new hash cannot make it pass:
    // canonical manifest digest changes and mismatches independent invocationRecord.manifest_sha256
    const tamperedBaselineReceipt = {
      ...fin,
      manifest: {
        ...fin.manifest,
        baseline_snapshots: {
          ...fin.manifest.baseline_snapshots,
          'unchanged.txt': sha256Hex('line1\r\nline2\r\n')
        }
      }
    };
    const rTamperedBaseline = verifyCandidate(repo, tamperedBaselineReceipt, frozenRecord, invocationRecord);
    assert.equal(rTamperedBaseline.ok, false);
    assert.equal(rTamperedBaseline.failure_code, FAILURE_CODES.CONTENT_MISMATCH);
    assert.match(rTamperedBaseline.reason, /Manifest digest .* does not match receipt manifest_sha256/);
  } finally {
    await cleanup();
  }
});

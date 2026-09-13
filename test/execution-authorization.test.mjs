import test from 'node:test';
import assert from 'node:assert/strict';
import * as authModule from '../scripts/lib/execution-authorization.mjs';

const { validateActionAuthorization } = authModule;

const VALID_COMMIT = '1111111111111111111111111111111111111111';
const OTHER_COMMIT = '2222222222222222222222222222222222222222';
const VALID_ARTIFACT = '3333333333333333333333333333333333333333';
const OTHER_ARTIFACT = '4444444444444444444444444444444444444444';
const VALID_ISO_TIMESTAMP = '2026-09-12T12:00:00.000Z';

function makeMergeTarget(overrides = {}) {
  return {
    revision: 1,
    candidate_commit: VALID_COMMIT,
    repository: 'Banhtalon/qq-ai-workflow',
    target_branch: 'main',
    ...overrides
  };
}

function makeMergeAuth(overrides = {}) {
  return {
    action: 'MERGE',
    revision: 1,
    candidate_commit: VALID_COMMIT,
    repository: 'Banhtalon/qq-ai-workflow',
    target_branch: 'main',
    approved_by: 'owner-alice',
    approved_at: VALID_ISO_TIMESTAMP,
    owner_instruction_ref: 'TASK-100#instruction-1',
    ...overrides
  };
}

function makeDeployTarget(overrides = {}) {
  return {
    revision: 1,
    artifact_or_commit: VALID_ARTIFACT,
    environment: 'production',
    ...overrides
  };
}

function makeDeployAuth(overrides = {}) {
  return {
    action: 'DEPLOY',
    revision: 1,
    artifact_or_commit: VALID_ARTIFACT,
    environment: 'production',
    approved_by: 'owner-alice',
    approved_at: VALID_ISO_TIMESTAMP,
    owner_instruction_ref: 'TASK-100#deploy-order-1',
    ...overrides
  };
}

test('authorization: returns explicit {ok: false, reason} and does not throw on invalid inputs', () => {
  const invalidCalls = [
    () => validateActionAuthorization(),
    () => validateActionAuthorization('MERGE', null, null),
    () => validateActionAuthorization('MERGE', {}, {}),
    () => validateActionAuthorization('MERGE', makeMergeTarget(), null),
    () => validateActionAuthorization('MERGE', makeMergeTarget(), undefined),
    () => validateActionAuthorization('MERGE', makeMergeTarget(), 'APPROVED'),
    () => validateActionAuthorization('MERGE', makeMergeTarget(), 12345),
    () => validateActionAuthorization('MERGE', makeMergeTarget(), true),
    () => validateActionAuthorization(null, makeMergeTarget(), makeMergeAuth()),
    () => validateActionAuthorization('UNSUPPORTED_ACTION', makeMergeTarget(), makeMergeAuth())
  ];

  for (const call of invalidCalls) {
    let result;
    assert.doesNotThrow(() => {
      result = call();
    });
    assert.ok(result && typeof result === 'object', 'must return an object');
    assert.equal(result.ok, false, 'must return ok: false');
    assert.equal(typeof result.reason, 'string', 'must provide string reason');
    assert.ok(result.reason.trim().length > 0, 'reason must be non-empty');
  }
});

test('authorization: WORKFLOW_DONE or owner functional acceptance alone never authorizes MERGE or DEPLOY', () => {
  const insufficientAuths = [
    { status: 'WORKFLOW_DONE' },
    { status: 'WORKFLOW_DONE', functional_acceptance: 'ACCEPTED' },
    { status: 'WORKFLOW_DONE', owner_acceptance: true },
    { owner_functional_acceptance: true },
    { functional_acceptance: 'ACCEPTED' },
    'WORKFLOW_DONE',
    'ACCEPTED'
  ];

  for (const auth of insufficientAuths) {
    const mergeRes = validateActionAuthorization('MERGE', makeMergeTarget({ status: 'WORKFLOW_DONE' }), auth);
    assert.equal(mergeRes.ok, false);
    assert.ok(typeof mergeRes.reason === 'string' && mergeRes.reason.length > 0);

    const deployRes = validateActionAuthorization('DEPLOY', makeDeployTarget({ status: 'WORKFLOW_DONE' }), auth);
    assert.equal(deployRes.ok, false);
    assert.ok(typeof deployRes.reason === 'string' && deployRes.reason.length > 0);
  }
});

test('authorization: rejects informal approval fields as substitute for required fields', () => {
  const informalAuths = [
    { approved: true, lgtm: true, comment: 'LGTM by Owner' },
    { action: 'MERGE', approved: true, signed_off_by_owner: true },
    { action: 'DEPLOY', approved: true, owner_status: 'CONFIRMED' },
    { action: 'MERGE', signoff: 'owner-alice', notes: 'all tests pass' }
  ];

  for (const auth of informalAuths) {
    const res = validateActionAuthorization(auth.action || 'MERGE', makeMergeTarget(), auth);
    assert.equal(res.ok, false);
    assert.ok(typeof res.reason === 'string' && res.reason.length > 0);
  }
});

test('authorization: validates complete and matching MERGE authorization', () => {
  const target = makeMergeTarget();
  const auth = makeMergeAuth();

  const res = validateActionAuthorization('MERGE', target, auth);
  assert.equal(res.ok, true);
});

test('authorization: rejects MERGE when required authorization fields are missing or malformed', () => {
  const target = makeMergeTarget();

  const invalidFieldCases = [
    { action: 'DEPLOY' },
    { revision: 0 },
    { revision: -1 },
    { revision: 1.5 },
    { revision: '1' },
    { revision: null },
    { candidate_commit: '123' },
    { candidate_commit: 'g'.repeat(40) },
    { candidate_commit: '' },
    { candidate_commit: null },
    { repository: '' },
    { repository: '   ' },
    { repository: null },
    { target_branch: '' },
    { target_branch: '   ' },
    { target_branch: null },
    { approved_by: '' },
    { approved_by: '   ' },
    { approved_by: null },
    { approved_at: '' },
    { approved_at: 'not-an-iso-date' },
    { approved_at: null },
    { owner_instruction_ref: '' },
    { owner_instruction_ref: '   ' },
    { owner_instruction_ref: null }
  ];

  for (const badField of invalidFieldCases) {
    const auth = makeMergeAuth(badField);
    const res = validateActionAuthorization('MERGE', target, auth);
    assert.equal(res.ok, false, `Expected failure for field override: ${JSON.stringify(badField)}`);
    assert.ok(typeof res.reason === 'string' && res.reason.length > 0);
  }
});

test('authorization: rejects MERGE when target and authorization fields mismatch', () => {
  const target = makeMergeTarget();

  const mismatchCases = [
    makeMergeAuth({ revision: 2 }),
    makeMergeAuth({ candidate_commit: OTHER_COMMIT }),
    makeMergeAuth({ repository: 'OtherOwner/other-repo' }),
    makeMergeAuth({ target_branch: 'release-branch' })
  ];

  for (const mismatchedAuth of mismatchCases) {
    const res = validateActionAuthorization('MERGE', target, mismatchedAuth);
    assert.equal(res.ok, false);
    assert.ok(typeof res.reason === 'string' && res.reason.length > 0);
  }
});

test('authorization: validates complete and matching DEPLOY authorization', () => {
  const target = makeDeployTarget();
  const auth = makeDeployAuth();

  const res = validateActionAuthorization('DEPLOY', target, auth);
  assert.equal(res.ok, true);

  // Also supports destination field name
  const destTarget = { revision: 2, artifact_or_commit: VALID_ARTIFACT, destination: 'staging' };
  const destAuth = makeDeployAuth({ revision: 2, destination: 'staging', environment: 'staging' });
  const destRes = validateActionAuthorization('DEPLOY', destTarget, destAuth);
  assert.equal(destRes.ok, true);
});

test('authorization: rejects DEPLOY when required authorization fields are missing or malformed', () => {
  const target = makeDeployTarget();

  const invalidFieldCases = [
    { action: 'MERGE' },
    { revision: 0 },
    { revision: -2 },
    { revision: '1' },
    { artifact_or_commit: 'short-sha' },
    { artifact_or_commit: 'z'.repeat(40) },
    { artifact_or_commit: '' },
    { environment: '', destination: '' },
    { environment: '   ', destination: '   ' },
    { approved_by: '' },
    { approved_by: null },
    { approved_at: 'bad-timestamp' },
    { approved_at: null },
    { owner_instruction_ref: '' },
    { owner_instruction_ref: null }
  ];

  for (const badField of invalidFieldCases) {
    const auth = makeDeployAuth(badField);
    const res = validateActionAuthorization('DEPLOY', target, auth);
    assert.equal(res.ok, false, `Expected failure for DEPLOY override: ${JSON.stringify(badField)}`);
    assert.ok(typeof res.reason === 'string' && res.reason.length > 0);
  }
});

test('authorization: rejects DEPLOY when commit/artifact, destination, or revision changes', () => {
  const target = makeDeployTarget();

  const mismatchCases = [
    makeDeployAuth({ artifact_or_commit: OTHER_ARTIFACT }),
    makeDeployAuth({ environment: 'staging' }),
    makeDeployAuth({ destination: 'staging', environment: 'staging' }),
    makeDeployAuth({ revision: 3 })
  ];

  for (const mismatchedAuth of mismatchCases) {
    const res = validateActionAuthorization('DEPLOY', target, mismatchedAuth);
    assert.equal(res.ok, false);
    assert.ok(typeof res.reason === 'string' && res.reason.length > 0);
  }
});

test('authorization: validates supplemental recovery record if module exposes it', () => {
  const helper =
    authModule.validateSupplementalRecoveryAuthorization ??
    authModule.validateSupplementalRecoveryRecord ??
    authModule.validateSupplementalRecovery;

  if (typeof helper !== 'function') {
    // If no such helper is appropriate, do not require it.
    return;
  }

  const priorRecord = {
    revision: 1,
    requirement: 'Bounded Owner-authorization task',
    requirement_sha256: 'e'.repeat(64),
    initial_count: 1,
    repair_count: 2,
    attempts: [{ id: 'att-1' }, { id: 'att-2' }]
  };

  const validRecovery = {
    revision: 1,
    requirement: 'Bounded Owner-authorization task',
    requirement_sha256: 'e'.repeat(64),
    owner_instruction_ref: 'OWNER-RECOVERY-REVISE-01',
    additional_budget: 2
  };

  const validRes = helper(priorRecord, validRecovery);
  assert.equal(validRes.ok, true);

  // Mismatched revision invalidates
  const badRev = helper(priorRecord, { ...validRecovery, revision: 2 });
  assert.equal(badRev.ok, false);
  assert.ok(badRev.reason);

  // Changed requirement invalidates
  const badReq = helper(priorRecord, { ...validRecovery, requirement_sha256: 'f'.repeat(64) });
  assert.equal(badReq.ok, false);
  assert.ok(badReq.reason);

  // Missing or empty owner instruction ref invalidates
  const badRef = helper(priorRecord, { ...validRecovery, owner_instruction_ref: '' });
  assert.equal(badRef.ok, false);
  assert.ok(badRef.reason);

  // Non-positive additional budget invalidates
  for (const badBudget of [0, -1, 1.5, '2', null, undefined]) {
    const badBud = helper(priorRecord, { ...validRecovery, additional_budget: badBudget });
    assert.equal(badBud.ok, false);
    assert.ok(badBud.reason);
  }

  // Must not reset prior counters or history
  const resetAttempt = helper(priorRecord, {
    ...validRecovery,
    repair_count: 0,
    reset_counters: true
  });
  assert.equal(resetAttempt.ok, false);
  assert.ok(resetAttempt.reason);

  const eraseHistoryAttempt = helper(priorRecord, {
    ...validRecovery,
    attempts: []
  });
  assert.equal(eraseHistoryAttempt.ok, false);
  assert.ok(eraseHistoryAttempt.reason);
});

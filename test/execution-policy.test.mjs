import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  advanceBudget,
  createBudget,
  validateBudgetState,
  validateFrozenRecord,
  resolveLane,
  frozenPayloadDigest,
  projectFrozenPayload,
  verifyClassifierContract,
  POLICY_DISCRIMINATOR,
  BUDGET_ORIGINS,
  BUDGET_EVENTS,
  BUDGET_ACTIONS,
  RISKS,
  LANES,
  LANE_STATUSES,
  FAILURE_CODES,
  GEMINI_MODEL,
  ASTRA_MODEL,
  ASTRA_EFFORT,
  FROZEN_CONTRACT_KEYS
} from '../scripts/lib/execution-policy.mjs';

// --- Test Fixtures & Helpers ---

function sha256Hex(content) {
  return createHash('sha256').update(content).digest('hex');
}

function makeValidClassifierDecision() {
  return {
    schema_version: 'qq.workflow.fast-lane.result.v1',
    base: '1'.repeat(40),
    head: '2'.repeat(40),
    allowlist_sha256: 'a'.repeat(64),
    classifier_sha256: 'b'.repeat(64),
    runner_sha256: 'c'.repeat(64),
    decision_sha256: 'd'.repeat(64),
    comment_only_supported: false,
    status: 'FAST_LANE',
    fast_lane: true,
    reasons: [],
    changes: [
      {
        kind: 'M',
        old_mode: '100644',
        new_mode: '100644',
        old_path: 'docs/user-guide/getting-started.md',
        new_path: 'docs/user-guide/getting-started.md'
      }
    ]
  };
}

function makeSampleTask() {
  return {
    schema_version: 'qq.workflow.task.v10',
    policy: POLICY_DISCRIMINATOR,
    task_id: 'TASK-BUDGET-001',
    revision: 1,
    base_sha: '0'.repeat(40),
    goal: 'Controlled delegation core policy implementation',
    acceptance_criteria: ['Budget state machine strictly enforced'],
    gates: [{ id: 'unit-tests', argv: ['node', '--test'], timeout_seconds: 60 }],
    user_visible: false,
    risk: 'LOW',
    complexity: 'SIMPLE',
    // Dynamic runtime fields that should not affect frozen contract digest
    candidate_head: null,
    contract_sha256: null,
    repair_rounds: 0,
    senior_passes: 0,
    implementer_sessions: []
  };
}

// ============================================================================
// Budget State Machine Tests
// ============================================================================

test('GEMINI_INITIAL permits initial + 2 repairs then exactly 1 senior escalation to Astra Low; subsequent repairs fail closed', () => {
  const b0 = createBudget(BUDGET_ORIGINS.GEMINI_INITIAL);
  assert.equal(b0.origin, BUDGET_ORIGINS.GEMINI_INITIAL);
  assert.equal(b0.initial_count, 0);
  assert.equal(b0.repair_count, 0);
  assert.equal(b0.escalation_count, 0);
  assert.equal(b0.escalation_used, false);
  assert.equal(b0.attempts.length, 0);

  // 1. Initial attempt -> Gemini Flash High worker
  const r1 = advanceBudget(b0, BUDGET_EVENTS.INITIAL);
  assert.equal(r1.action, BUDGET_ACTIONS.LAUNCH);
  assert.equal(r1.state.initial_count, 1);
  assert.equal(r1.state.repair_count, 0);
  assert.equal(r1.state.attempts.length, 1);
  const att1 = r1.state.attempts[0];
  assert.equal(att1.id, 'attempt-1');
  assert.equal(att1.phase, 'initial');
  assert.equal(att1.tier, 'worker');
  assert.equal(att1.model, GEMINI_MODEL);
  assert.equal(att1.effort, null);
  assert.equal(att1.status, 'LAUNCHED');

  // 2. Repair 1 -> Gemini worker repair 1 of 2
  const r2 = advanceBudget(r1.state, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(r2.action, BUDGET_ACTIONS.LAUNCH);
  assert.equal(r2.state.initial_count, 1);
  assert.equal(r2.state.repair_count, 1);
  assert.equal(r2.state.attempts.length, 2);
  const att2 = r2.state.attempts[1];
  assert.equal(att2.id, 'attempt-2');
  assert.equal(att2.phase, 'repair');
  assert.equal(att2.tier, 'worker');
  assert.equal(att2.model, GEMINI_MODEL);

  // 3. Repair 2 -> Gemini worker repair 2 of 2
  const r3 = advanceBudget(r2.state, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(r3.action, BUDGET_ACTIONS.LAUNCH);
  assert.equal(r3.state.repair_count, 2);
  assert.equal(r3.state.escalation_used, false);
  assert.equal(r3.state.attempts.length, 3);
  const att3 = r3.state.attempts[2];
  assert.equal(att3.id, 'attempt-3');
  assert.equal(att3.phase, 'repair');
  assert.equal(att3.tier, 'worker');

  // 4. Repair 3 -> Senior escalation invocation to Astra Low (exactly one allowed)
  const r4 = advanceBudget(r3.state, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(r4.action, BUDGET_ACTIONS.LAUNCH);
  assert.equal(r4.state.repair_count, 2);
  assert.equal(r4.state.escalation_count, 1);
  assert.equal(r4.state.escalation_used, true);
  assert.equal(r4.state.attempts.length, 4);
  const att4 = r4.state.attempts[3];
  assert.equal(att4.id, 'attempt-4');
  assert.equal(att4.phase, 'escalation');
  assert.equal(att4.tier, 'senior');
  assert.equal(att4.model, ASTRA_MODEL);
  assert.equal(att4.effort, ASTRA_EFFORT);
  assert.equal(att4.status, 'LAUNCHED');

  // 5. Subsequent repair request -> BLOCKED (budget exhausted)
  const r5 = advanceBudget(r4.state, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(r5.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(r5.reason, /Budget exhausted/i);
  assert.equal(r5.state.attempts.length, 4);

  // 6. Further repair request stays BLOCKED
  const r6 = advanceBudget(r5.state, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(r6.action, BUDGET_ACTIONS.BLOCKED);
});

test('ASTRA_INITIAL permits initial + 1 repair only; never escalates to itself', () => {
  const b0 = createBudget(BUDGET_ORIGINS.ASTRA_INITIAL);
  assert.equal(b0.origin, BUDGET_ORIGINS.ASTRA_INITIAL);

  // 1. Initial attempt -> Astra Low senior worker
  const r1 = advanceBudget(b0, BUDGET_EVENTS.INITIAL);
  assert.equal(r1.action, BUDGET_ACTIONS.LAUNCH);
  assert.equal(r1.state.initial_count, 1);
  assert.equal(r1.state.repair_count, 0);
  assert.equal(r1.state.attempts.length, 1);
  const att1 = r1.state.attempts[0];
  assert.equal(att1.id, 'attempt-1');
  assert.equal(att1.phase, 'initial');
  assert.equal(att1.tier, 'senior');
  assert.equal(att1.model, ASTRA_MODEL);
  assert.equal(att1.effort, ASTRA_EFFORT);

  // 2. Repair 1 -> Astra Low senior repair 1 of 1
  const r2 = advanceBudget(r1.state, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(r2.action, BUDGET_ACTIONS.LAUNCH);
  assert.equal(r2.state.repair_count, 1);
  assert.equal(r2.state.attempts.length, 2);
  const att2 = r2.state.attempts[1];
  assert.equal(att2.id, 'attempt-2');
  assert.equal(att2.phase, 'repair');
  assert.equal(att2.tier, 'senior');
  assert.equal(att2.model, ASTRA_MODEL);
  assert.equal(att2.effort, ASTRA_EFFORT);

  // 3. Repair 2 -> BLOCKED (Astra cannot escalate to itself; exhausted)
  const r3 = advanceBudget(r2.state, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(r3.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(r3.reason, /self-escalation prohibited|exhausted/i);
  assert.equal(r3.state.attempts.length, 2);
});

test('Interruption and resume preserve attempt ID and reservation without resetting counters or refunding budget', () => {
  const b0 = createBudget(BUDGET_ORIGINS.GEMINI_INITIAL);
  const r1 = advanceBudget(b0, BUDGET_EVENTS.INITIAL);
  assert.equal(r1.state.active_attempt_id, 'attempt-1');
  assert.equal(r1.state.initial_count, 1);
  assert.equal(r1.state.repair_count, 0);

  // Attempt interrupted mid-flight
  const r_int = advanceBudget(r1.state, BUDGET_EVENTS.INTERRUPTED);
  assert.equal(r_int.action, BUDGET_ACTIONS.WAIT);
  assert.equal(r_int.state.pending_reconcile, true);
  assert.equal(r_int.state.active_attempt_id, 'attempt-1');
  assert.equal(r_int.state.attempts[0].status, 'INTERRUPTED');
  assert.equal(r_int.state.initial_count, 1);
  assert.equal(r_int.state.repair_count, 0);

  // While pending reconcile, new launches are BLOCKED
  const r_blocked_repair = advanceBudget(r_int.state, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(r_blocked_repair.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(r_blocked_repair.reason, /pending reconcile/i);
  assert.equal(r_blocked_repair.state.repair_count, 0);

  const r_blocked_init = advanceBudget(r_int.state, BUDGET_EVENTS.INITIAL);
  assert.equal(r_blocked_init.action, BUDGET_ACTIONS.BLOCKED);

  // Resume validated: returns RESUME directive, clears pending_reconcile, retains attempt-1
  const r_res = advanceBudget(r_int.state, BUDGET_EVENTS.RESUME_VALIDATED);
  assert.equal(r_res.action, BUDGET_ACTIONS.RESUME);
  assert.equal(r_res.state.pending_reconcile, false);
  assert.equal(r_res.state.active_attempt_id, 'attempt-1');
  assert.equal(r_res.state.attempts[0].status, 'RESUMED');
  // Counters remain strictly intact (no reset, no implicit refund)
  assert.equal(r_res.state.initial_count, 1);
  assert.equal(r_res.state.repair_count, 0);

  // Subsequent repair proceeds as attempt-2 with repair_count = 1
  const r_rep1 = advanceBudget(r_res.state, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(r_rep1.action, BUDGET_ACTIONS.LAUNCH);
  assert.equal(r_rep1.state.repair_count, 1);
  assert.equal(r_rep1.state.attempts.length, 2);
  assert.equal(r_rep1.state.attempts[1].id, 'attempt-2');
});

test('Caller object immutability is strictly preserved across budget transitions', () => {
  const originalBudget = createBudget(BUDGET_ORIGINS.GEMINI_INITIAL);
  Object.freeze(originalBudget);
  Object.freeze(originalBudget.attempts);

  const event = Object.freeze({ type: BUDGET_EVENTS.INITIAL });

  // Advance budget should not mutate original budget or throw on frozen object
  const result = advanceBudget(originalBudget, event);
  assert.notEqual(result.state, originalBudget);
  assert.equal(originalBudget.initial_count, 0);
  assert.equal(originalBudget.attempts.length, 0);
  assert.equal(result.state.initial_count, 1);
  assert.equal(result.state.attempts.length, 1);

  // Verify deep immutability of returned state
  assert(Object.isFrozen(result.state));
  assert(Object.isFrozen(result.state.attempts));
  assert(Object.isFrozen(result.state.attempts[0]));
});

test('Unsupported origins, invalid events, out-of-order events and non-low Astra efforts fail closed', () => {
  // Unsupported origin
  const badOrigin = advanceBudget({ origin: 'UNSUPPORTED_ORIGIN' }, BUDGET_EVENTS.INITIAL);
  assert.equal(badOrigin.action, BUDGET_ACTIONS.BLOCKED);

  // Missing or null state
  const nullState = advanceBudget(null, BUDGET_EVENTS.INITIAL);
  assert.equal(nullState.action, BUDGET_ACTIONS.BLOCKED);

  // Unsupported event
  const b0 = createBudget(BUDGET_ORIGINS.GEMINI_INITIAL);
  const badEvent = advanceBudget(b0, 'BOGUS_EVENT');
  assert.equal(badEvent.action, BUDGET_ACTIONS.BLOCKED);

  // INITIAL requested after attempts already exist
  const r1 = advanceBudget(b0, BUDGET_EVENTS.INITIAL);
  const doubleInit = advanceBudget(r1.state, BUDGET_EVENTS.INITIAL);
  assert.equal(doubleInit.action, BUDGET_ACTIONS.BLOCKED);

  // REPAIR_REQUESTED before INITIAL
  const repairTooEarly = advanceBudget(b0, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(repairTooEarly.action, BUDGET_ACTIONS.BLOCKED);

  // RESUME_VALIDATED without prior interruption
  const unneededResume = advanceBudget(r1.state, BUDGET_EVENTS.RESUME_VALIDATED);
  assert.equal(unneededResume.action, BUDGET_ACTIONS.BLOCKED);

  // Astra effort other than 'low' is strictly rejected
  const badEffort = advanceBudget(createBudget(BUDGET_ORIGINS.ASTRA_INITIAL), {
    type: BUDGET_EVENTS.INITIAL,
    effort: 'medium'
  });
  assert.equal(badEffort.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(badEffort.reason, /Astra effort other than 'low'/i);
});

// ============================================================================
// Issue 1 Regressions: Counter Types, Ranges, Historical Reservations & Integrity
// ============================================================================

test('P1 regression: exhausted Gemini budget rejects repair_count string "2" and forbids attempt-5 launch', () => {
  // Drive Gemini budget through all 4 invocations (1 initial + 2 repairs + 1 Astra escalation)
  const b0 = createBudget(BUDGET_ORIGINS.GEMINI_INITIAL);
  const r1 = advanceBudget(b0, BUDGET_EVENTS.INITIAL);
  const r2 = advanceBudget(r1.state, BUDGET_EVENTS.REPAIR_REQUESTED);
  const r3 = advanceBudget(r2.state, BUDGET_EVENTS.REPAIR_REQUESTED);
  const r4 = advanceBudget(r3.state, BUDGET_EVENTS.REPAIR_REQUESTED);

  assert.equal(r4.state.attempts.length, 4);
  assert.equal(r4.state.escalation_used, true);
  assert.equal(r4.state.escalation_count, 1);
  assert.equal(r4.state.repair_count, 2);
  assert.equal(r4.state.initial_count, 1);

  // Exact reproduced bug scenario: repair_count is string '2' on exhausted state
  const tamperedState = {
    ...r4.state,
    repair_count: '2'
  };

  const tamperedResult = advanceBudget(tamperedState, BUDGET_EVENTS.REPAIR_REQUESTED);
  // Must fail closed with BLOCKED; must NEVER produce attempt-5
  assert.equal(tamperedResult.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(tamperedResult.reason, /finite nonnegative integer|Malformed budget state/i);

  // Valid integer repair_count on exhausted state also strictly blocks; no attempt-5
  const exhaustedResult = advanceBudget(r4.state, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(exhaustedResult.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(exhaustedResult.reason, /Budget exhausted/i);
  assert.equal(exhaustedResult.state.attempts.length, 4);
});

test('P1 regression: negative, fractional, missing, and non-integer counters are strictly rejected', () => {
  const b0 = createBudget(BUDGET_ORIGINS.GEMINI_INITIAL);
  const r1 = advanceBudget(b0, BUDGET_EVENTS.INITIAL);

  // Negative initial_count
  const negInit = advanceBudget({ ...r1.state, initial_count: -1 }, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(negInit.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(negInit.reason, /initial_count must be a finite nonnegative integer/i);

  // Negative repair_count
  const negRepair = advanceBudget({ ...r1.state, repair_count: -1 }, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(negRepair.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(negRepair.reason, /repair_count must be a finite nonnegative integer/i);

  // Negative escalation_count
  const negEsc = advanceBudget({ ...r1.state, escalation_count: -1 }, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(negEsc.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(negEsc.reason, /escalation_count must be a finite nonnegative integer/i);

  // Fractional repair_count
  const fracRepair = advanceBudget({ ...r1.state, repair_count: 1.5 }, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(fracRepair.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(fracRepair.reason, /repair_count must be a finite nonnegative integer/i);

  // Fractional initial_count
  const fracInit = advanceBudget({ ...r1.state, initial_count: 0.5 }, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(fracInit.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(fracInit.reason, /initial_count must be a finite nonnegative integer/i);

  // Missing (undefined) repair_count
  const missingRepairState = { ...r1.state };
  delete missingRepairState.repair_count;
  const missingRepair = advanceBudget(missingRepairState, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(missingRepair.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(missingRepair.reason, /repair_count must be a finite nonnegative integer/i);

  // Missing initial_count
  const missingInitState = { ...r1.state };
  delete missingInitState.initial_count;
  const missingInit = advanceBudget(missingInitState, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(missingInit.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(missingInit.reason, /initial_count must be a finite nonnegative integer/i);

  // String initial_count '1'
  const strInit = advanceBudget({ ...r1.state, initial_count: '1' }, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(strInit.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(strInit.reason, /initial_count must be a finite nonnegative integer/i);

  // String escalation_count '0'
  const strEsc = advanceBudget({ ...r1.state, escalation_count: '0' }, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(strEsc.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(strEsc.reason, /escalation_count must be a finite nonnegative integer/i);

  // NaN counters
  const nanRepair = advanceBudget({ ...r1.state, repair_count: NaN }, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(nanRepair.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(nanRepair.reason, /repair_count must be a finite nonnegative integer/i);
});

test('P1 regression: contradictory attempt history and active attempt inconsistency fail closed', () => {
  const b0 = createBudget(BUDGET_ORIGINS.GEMINI_INITIAL);
  const r1 = advanceBudget(b0, BUDGET_EVENTS.INITIAL);
  const r2 = advanceBudget(r1.state, BUDGET_EVENTS.REPAIR_REQUESTED);

  // Contradiction 1: repair_count is 0 but attempts has a repair attempt
  const mismatchRepairCount = advanceBudget({ ...r2.state, repair_count: 0 }, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(mismatchRepairCount.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(mismatchRepairCount.reason, /repair_count.*does not match repair attempt history/i);

  // Contradiction 2: initial_count is 0 but attempts has an initial attempt
  const mismatchInitCount = advanceBudget({ ...r1.state, initial_count: 0 }, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(mismatchInitCount.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(mismatchInitCount.reason, /initial_count.*does not match initial attempt history/i);

  // Contradiction 3: escalation_used is false but escalation_count is 1
  const mismatchEscUsed = advanceBudget(
    { ...r2.state, escalation_count: 1, escalation_used: false },
    BUDGET_EVENTS.REPAIR_REQUESTED
  );
  assert.equal(mismatchEscUsed.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(mismatchEscUsed.reason, /contradicts escalation_count/i);

  // Contradiction 4: non-sequential attempt IDs (gap in attempt numbers)
  const gapAttempts = [
    r1.state.attempts[0],
    { ...r2.state.attempts[1], id: 'attempt-3' }
  ];
  const mismatchIds = advanceBudget({ ...r2.state, attempts: gapAttempts }, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(mismatchIds.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(mismatchIds.reason, /ID mismatch/i);

  // Contradiction 5: senior tier in worker attempt
  const badTierAttempts = [
    { ...r1.state.attempts[0], tier: 'senior', model: ASTRA_MODEL, effort: ASTRA_EFFORT }
  ];
  const mismatchTier = advanceBudget({ ...r1.state, attempts: badTierAttempts }, BUDGET_EVENTS.REPAIR_REQUESTED);
  assert.equal(mismatchTier.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(mismatchTier.reason, /worker\/model\/effort mismatch/i);

  // Contradiction 6: pending_reconcile is true but last attempt status is LAUNCHED
  const mismatchReconcileTrue = advanceBudget(
    { ...r1.state, pending_reconcile: true },
    BUDGET_EVENTS.REPAIR_REQUESTED
  );
  assert.equal(mismatchReconcileTrue.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(mismatchReconcileTrue.reason, /pending_reconcile is true but active attempt is not INTERRUPTED/i);

  // Contradiction 7: pending_reconcile is false but last attempt status is INTERRUPTED
  const interruptedAtt = { ...r1.state.attempts[0], status: 'INTERRUPTED' };
  const mismatchReconcileFalse = advanceBudget(
    { ...r1.state, pending_reconcile: false, attempts: [interruptedAtt] },
    BUDGET_EVENTS.REPAIR_REQUESTED
  );
  assert.equal(mismatchReconcileFalse.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(mismatchReconcileFalse.reason, /pending_reconcile is false but active attempt is INTERRUPTED/i);

  // Contradiction 8: active_attempt_id does not match last attempt ID
  const mismatchActiveId = advanceBudget(
    { ...r2.state, active_attempt_id: 'attempt-1' },
    BUDGET_EVENTS.REPAIR_REQUESTED
  );
  assert.equal(mismatchActiveId.action, BUDGET_ACTIONS.BLOCKED);
  assert.match(mismatchActiveId.reason, /active_attempt_id.*does not match last attempt ID/i);
});

// ============================================================================
// Frozen Record Validation Tests
// ============================================================================

test('validateFrozenRecord succeeds for matching canonical contract and independent frozen record', () => {
  const task = makeSampleTask();
  const canonicalDigest = frozenPayloadDigest(task);
  task.contract_sha256 = canonicalDigest;

  const record = {
    schema_version: 'qq.workflow.lock.v10',
    task_id: task.task_id,
    revision: task.revision,
    contract_sha256: canonicalDigest,
    contract_payload: projectFrozenPayload(task)
  };

  const validation = validateFrozenRecord(task, record);
  assert.equal(validation.ok, true);
  assert.equal(validation.contract_sha256, canonicalDigest);
});

test('contract mutation plus rehashed task rejection: candidate recomputing declared hash cannot satisfy mismatch', () => {
  const task = makeSampleTask();
  const originalDigest = frozenPayloadDigest(task);
  task.contract_sha256 = originalDigest;

  // Independent frozen record created before candidate execution
  const frozenRecord = Object.freeze({
    schema_version: 'qq.workflow.lock.v10',
    task_id: task.task_id,
    revision: task.revision,
    contract_sha256: originalDigest
  });

  // Candidate mutates task goal (a contract field)
  task.goal = 'Mutated unauthorized goal';

  // Candidate recomputes its own declared contract_sha256 to match the tampered contract
  task.contract_sha256 = frozenPayloadDigest(task);
  assert.notEqual(task.contract_sha256, originalDigest);

  // Validation MUST fail closed with CONTRACT_MISMATCH
  const checkRehashed = validateFrozenRecord(task, frozenRecord);
  assert.equal(checkRehashed.ok, false);
  assert.equal(checkRehashed.failure_code, FAILURE_CODES.CONTRACT_MISMATCH);
  assert.match(checkRehashed.reason, /mismatch/i);

  // Candidate mutates gates but leaves declared contract_sha256 as original
  task.goal = 'Controlled delegation core policy implementation'; // restore goal
  task.gates = [{ id: 'weakened-gate', argv: ['echo', 'passed'], timeout_seconds: 10 }];
  task.contract_sha256 = originalDigest;

  const checkMutatedContract = validateFrozenRecord(task, frozenRecord);
  assert.equal(checkMutatedContract.ok, false);
  assert.equal(checkMutatedContract.failure_code, FAILURE_CODES.CONTRACT_MISMATCH);
});

test('dynamic task state mutation does not cause contract mismatch', () => {
  const task = makeSampleTask();
  const canonicalDigest = frozenPayloadDigest(task);
  task.contract_sha256 = canonicalDigest;

  const frozenRecord = {
    schema_version: 'qq.workflow.lock.v10',
    task_id: task.task_id,
    revision: task.revision,
    contract_sha256: canonicalDigest
  };

  // Mutate multiple dynamic execution fields during run
  task.candidate_head = 'f'.repeat(40);
  task.repair_rounds = 1;
  task.senior_passes = 1;
  task.implementer_sessions = ['writer-session-42'];
  task.ui_evidence = { head: task.candidate_head, status: 'PASS' };

  // Validation continues to pass because dynamic fields are projected out
  const validation = validateFrozenRecord(task, frozenRecord);
  assert.equal(validation.ok, true);
  assert.equal(validation.contract_sha256, canonicalDigest);
});

test('task identity mismatch (task_id or revision) fails closed', () => {
  const task = makeSampleTask();
  const digest = frozenPayloadDigest(task);
  task.contract_sha256 = digest;

  const record = {
    schema_version: 'qq.workflow.lock.v10',
    task_id: 'TASK-BUDGET-999', // mismatched task_id
    revision: task.revision,
    contract_sha256: digest
  };

  const idMismatch = validateFrozenRecord(task, record);
  assert.equal(idMismatch.ok, false);
  assert.equal(idMismatch.failure_code, FAILURE_CODES.CONTRACT_MISMATCH);
  assert.match(idMismatch.reason, /Task ID mismatch/i);

  const revMismatch = validateFrozenRecord(task, { ...record, task_id: task.task_id, revision: 2 });
  assert.equal(revMismatch.ok, false);
  assert.equal(revMismatch.failure_code, FAILURE_CODES.CONTRACT_MISMATCH);
  assert.match(revMismatch.reason, /Revision mismatch/i);
});

// ============================================================================
// Issue 2 Regressions: Legacy Fallback Removal & All Newly Frozen Fields
// ============================================================================

test('P1 regression: new policy strictly rejects legacy hash fallback', () => {
  const task = makeSampleTask();
  task.allowed_paths = ['scripts/lib/execution-policy.mjs', 'test/execution-policy.test.mjs'];
  task.product_checks = [{ id: 'lint', command: 'npm run lint' }];

  // Compute legacy hash (omits allowed_paths, product_checks, etc.)
  const legacyContract = {
    schema_version: task.schema_version,
    task_id: task.task_id,
    revision: task.revision,
    base_sha: task.base_sha,
    goal: task.goal,
    acceptance_criteria: task.acceptance_criteria,
    gates: task.gates,
    user_visible: task.user_visible,
    risk: task.risk,
    complexity: task.complexity
  };
  const legacyHash = sha256Hex(JSON.stringify(legacyContract));

  const recordWithLegacyHash = {
    schema_version: 'qq.workflow.lock.v10',
    task_id: task.task_id,
    revision: task.revision,
    contract_sha256: legacyHash
  };

  // Legacy hash MUST be rejected under CONTROLLED_DELEGATION_V1
  const result = validateFrozenRecord(task, recordWithLegacyHash);
  assert.equal(result.ok, false);
  assert.equal(result.failure_code, FAILURE_CODES.CONTRACT_MISMATCH);
  assert.match(result.reason, /Contract digest mismatch/i);
});

test('P1 regression: mutating allowed_paths from safe to anything cannot be masked and fails closed', () => {
  const task = makeSampleTask();
  task.allowed_paths = ['docs/user-guide/getting-started.md'];
  const canonicalDigest = frozenPayloadDigest(task);
  task.contract_sha256 = canonicalDigest;

  const frozenRecord = {
    schema_version: 'qq.workflow.lock.v10',
    task_id: task.task_id,
    revision: task.revision,
    contract_sha256: canonicalDigest
  };

  // Safe task matches
  const safeCheck = validateFrozenRecord(task, frozenRecord);
  assert.equal(safeCheck.ok, true);

  // Mutate allowed_paths to anything
  task.allowed_paths = ['**/*', '/etc/passwd'];
  const mutatedCheck = validateFrozenRecord(task, frozenRecord);
  assert.equal(mutatedCheck.ok, false);
  assert.equal(mutatedCheck.failure_code, FAILURE_CODES.CONTRACT_MISMATCH);

  // Even if candidate recomputes declared contract_sha256 to match mutated allowed_paths, it still fails closed
  task.contract_sha256 = frozenPayloadDigest(task);
  const rehashedMutatedCheck = validateFrozenRecord(task, frozenRecord);
  assert.equal(rehashedMutatedCheck.ok, false);
  assert.equal(rehashedMutatedCheck.failure_code, FAILURE_CODES.CONTRACT_MISMATCH);
});

test('P1 regression: mutation of every newly frozen contract field invalidates verification', () => {
  const baselineTask = makeSampleTask();
  baselineTask.allowed_paths = ['scripts/lib/execution-policy.mjs'];
  baselineTask.product_checks = [{ id: 'test-check', command: 'echo ok' }];
  baselineTask.behavior = 'deterministic';
  baselineTask.exclusions = ['private/**'];
  baselineTask.execution_constraints = { allow_network: false };
  baselineTask.initial_lane = 'NORMAL';
  baselineTask.initial_risk = 'LOW';
  baselineTask.lane = 'NORMAL';
  baselineTask.policy = POLICY_DISCRIMINATOR;
  baselineTask.policy_version = '1.0.0';
  baselineTask.accepted_classifier = 'fast-classifier-v1';
  baselineTask.accepted_classifier_reference = 'ref-42';
  baselineTask.write_paths = ['scripts/lib/execution-policy.mjs'];

  const baselineDigest = frozenPayloadDigest(baselineTask);
  baselineTask.contract_sha256 = baselineDigest;

  const frozenRecord = {
    schema_version: 'qq.workflow.lock.v10',
    task_id: baselineTask.task_id,
    revision: baselineTask.revision,
    contract_sha256: baselineDigest
  };

  assert.equal(validateFrozenRecord(baselineTask, frozenRecord).ok, true);

  // All newly frozen fields to test individually
  const mutations = [
    { field: 'allowed_paths', mutatedVal: ['scripts/other.mjs'] },
    { field: 'product_checks', mutatedVal: [] },
    { field: 'behavior', mutatedVal: 'divergent' },
    { field: 'exclusions', mutatedVal: [] },
    { field: 'execution_constraints', mutatedVal: { allow_network: true } },
    { field: 'initial_lane', mutatedVal: 'FAST' },
    { field: 'initial_risk', mutatedVal: 'ELEVATED' },
    { field: 'lane', mutatedVal: 'FAST' },
    { field: 'policy_version', mutatedVal: '2.0.0' },
    { field: 'accepted_classifier', mutatedVal: 'tampered-classifier' },
    { field: 'accepted_classifier_reference', mutatedVal: 'tampered-ref' },
    { field: 'write_paths', mutatedVal: ['everywhere/**'] }
  ];

  for (const { field, mutatedVal } of mutations) {
    const mutatedTask = { ...baselineTask, [field]: mutatedVal };
    const check = validateFrozenRecord(mutatedTask, frozenRecord);
    assert.equal(
      check.ok,
      false,
      `Expected mutation of newly frozen field '${field}' to invalidate contract record`
    );
    assert.equal(check.failure_code, FAILURE_CODES.CONTRACT_MISMATCH);

    // Also assert mutation fails if candidate recomputes declared contract_sha256
    const rehashedMutatedTask = {
      ...mutatedTask,
      contract_sha256: frozenPayloadDigest(mutatedTask)
    };
    const rehashedCheck = validateFrozenRecord(rehashedMutatedTask, frozenRecord);
    assert.equal(
      rehashedCheck.ok,
      false,
      `Expected rehashed mutation of field '${field}' to invalidate contract record`
    );
    assert.equal(rehashedCheck.failure_code, FAILURE_CODES.CONTRACT_MISMATCH);
  }
});

test('P1 regression: missing record metadata or hash aliases fail closed', () => {
  const task = makeSampleTask();
  const canonicalDigest = frozenPayloadDigest(task);
  task.contract_sha256 = canonicalDigest;

  // Missing record schema_version
  const noSchema = validateFrozenRecord(task, {
    task_id: task.task_id,
    revision: task.revision,
    contract_sha256: canonicalDigest
  });
  assert.equal(noSchema.ok, false);
  assert.match(noSchema.reason, /missing valid schema_version/i);

  // Missing record task_id
  const noTaskId = validateFrozenRecord(task, {
    schema_version: 'qq.workflow.lock.v10',
    revision: task.revision,
    contract_sha256: canonicalDigest
  });
  assert.equal(noTaskId.ok, false);
  assert.match(noTaskId.reason, /Task ID mismatch/i);

  // Missing record revision
  const noRev = validateFrozenRecord(task, {
    schema_version: 'qq.workflow.lock.v10',
    task_id: task.task_id,
    contract_sha256: canonicalDigest
  });
  assert.equal(noRev.ok, false);
  assert.match(noRev.reason, /Revision mismatch/i);

  // Using hash alias 'hash' instead of contract_sha256
  const aliasHash = validateFrozenRecord(task, {
    schema_version: 'qq.workflow.lock.v10',
    task_id: task.task_id,
    revision: task.revision,
    hash: canonicalDigest
  });
  assert.equal(aliasHash.ok, false);
  assert.match(aliasHash.reason, /missing valid contract_sha256/i);

  // Using hash alias 'sha256' instead of contract_sha256
  const aliasSha = validateFrozenRecord(task, {
    schema_version: 'qq.workflow.lock.v10',
    task_id: task.task_id,
    revision: task.revision,
    sha256: canonicalDigest
  });
  assert.equal(aliasSha.ok, false);
  assert.match(aliasSha.reason, /missing valid contract_sha256/i);

  // Task with unsupported policy
  const badPolicyTask = { ...task, policy: 'UNSUPPORTED_POLICY' };
  const badPolicyCheck = validateFrozenRecord(badPolicyTask, {
    schema_version: 'qq.workflow.lock.v10',
    task_id: task.task_id,
    revision: task.revision,
    contract_sha256: canonicalDigest
  });
  assert.equal(badPolicyCheck.ok, false);
  assert.match(badPolicyCheck.reason, /Unsupported task policy/i);
});

test('P1 regression: exact schemas, strict policy, and prevention of unknown field laundering', () => {
  const task = makeSampleTask();
  const canonicalDigest = frozenPayloadDigest(task);
  task.contract_sha256 = canonicalDigest;

  const validRecord = {
    schema_version: 'qq.workflow.lock.v10',
    task_id: task.task_id,
    revision: task.revision,
    contract_sha256: canonicalDigest
  };

  // 1. Task with arbitrary schema string is rejected
  const arbitrarySchemaTask = { ...task, schema_version: 'qq.workflow.task.v999' };
  const badTaskSchemaCheck = validateFrozenRecord(arbitrarySchemaTask, validRecord);
  assert.equal(badTaskSchemaCheck.ok, false);
  assert.match(badTaskSchemaCheck.reason, /Task missing valid schema_version/i);

  // 2. Record with arbitrary schema string is rejected
  const badRecordSchema = validateFrozenRecord(task, {
    ...validRecord,
    schema_version: 'qq.workflow.lock.arbitrary'
  });
  assert.equal(badRecordSchema.ok, false);
  assert.match(badRecordSchema.reason, /Frozen record missing valid schema_version/i);

  // 3. Record with unsupported policy is rejected
  const badRecordPolicy = validateFrozenRecord(task, {
    ...validRecord,
    policy: 'UNSUPPORTED_POLICY'
  });
  assert.equal(badRecordPolicy.ok, false);
  assert.match(badRecordPolicy.reason, /Record policy mismatch/i);

  // 4. Record with unknown field fails closed (no laundering unknown fields into record)
  const launderedRecord = validateFrozenRecord(task, {
    ...validRecord,
    unauthorized_injected_field: 'exploit'
  });
  assert.equal(launderedRecord.ok, false);
  assert.equal(launderedRecord.failure_code, FAILURE_CODES.CONTRACT_MISMATCH);
  assert.match(launderedRecord.reason, /unknown fields/i);

  // 5. Record contract_payload with unknown field fails closed (no laundering unknown payload fields)
  const launderedPayloadRecord = validateFrozenRecord(task, {
    ...validRecord,
    contract_payload: {
      ...projectFrozenPayload(task),
      unauthorized_payload_field: 'exploit'
    }
  });
  assert.equal(launderedPayloadRecord.ok, false);
  assert.equal(launderedPayloadRecord.failure_code, FAILURE_CODES.CONTRACT_MISMATCH);
  assert.match(launderedPayloadRecord.reason, /unknown fields/i);

  // 6. Record contract_payload with unsupported policy fails closed
  const badPayloadPolicyRecord = validateFrozenRecord(task, {
    ...validRecord,
    contract_payload: {
      ...projectFrozenPayload(task),
      policy: 'UNSUPPORTED_POLICY'
    }
  });
  assert.equal(badPayloadPolicyRecord.ok, false);
  assert.equal(badPayloadPolicyRecord.failure_code, FAILURE_CODES.CONTRACT_MISMATCH);
  assert.match(badPayloadPolicyRecord.reason, /policy mismatch/i);
});

test('canonical digest projection is deterministic and consistent regardless of extra task fields', () => {
  const task = makeSampleTask();
  const digest1 = frozenPayloadDigest(task);

  // Add various dynamic and non-frozen fields
  const dynamicTask = {
    ...task,
    attempts: [{ id: 'attempt-1' }],
    status: 'ACTIVE',
    candidate_head: 'abc1234',
    session_id: 'session-xyz',
    arbitrary_extra_runtime_property: 42
  };

  const digest2 = frozenPayloadDigest(dynamicTask);
  const digest3 = frozenPayloadDigest(projectFrozenPayload(dynamicTask));

  // Canonical digests must be identical
  assert.equal(digest1, digest2);
  assert.equal(digest2, digest3);
});

// ============================================================================
// Lane Resolution Tests & Issue 3 Regressions
// ============================================================================

test('positive fastDecision passes only with LOW risk and legitimate classifier decision shape (plain boolean rejected)', () => {
  // 1. Plain boolean fastDecision: true is rejected; does not authenticate classifier
  const boolResult = resolveLane({
    risk: RISKS.LOW,
    scopeOk: true,
    prerequisitesOk: true,
    fastDecision: true
  });
  assert.equal(boolResult.status, LANE_STATUSES.OK);
  assert.equal(boolResult.lane, LANES.NORMAL); // Resolves to NORMAL, NOT FAST
  assert(boolResult.reasons.some(r => r.includes('FAST_DECISION_REJECTED')));

  // 2. Structural fake without required hashes is rejected
  const fakeResult = resolveLane({
    risk: RISKS.LOW,
    scopeOk: true,
    prerequisitesOk: true,
    fastDecision: { schema_version: 'qq.workflow.fast-lane.result.v1', status: 'FAST_LANE', fast_lane: true }
  });
  assert.equal(fakeResult.status, LANE_STATUSES.OK);
  assert.equal(fakeResult.lane, LANES.NORMAL);
  assert(fakeResult.reasons.some(r => r.includes('FAST_DECISION_REJECTED')));

  // 3. Legitimate classifier decision object passes for FAST
  const validDecision = makeValidClassifierDecision();
  const validResult = resolveLane({
    risk: RISKS.LOW,
    scopeOk: true,
    prerequisitesOk: true,
    fastDecision: validDecision
  });
  assert.equal(validResult.status, LANE_STATUSES.OK);
  assert.equal(validResult.lane, LANES.FAST);
  assert(validResult.reasons.includes('FAST_LANE_QUALIFIED'));

  // 4. Legitimate decision structure with rejection reasons resolves to NORMAL
  const rejectedClassifierDecision = {
    ...validDecision,
    status: 'FEATURE_FLOW',
    fast_lane: false,
    reasons: ['PATH_OUTSIDE_ALLOWLIST']
  };
  const rejectedResult = resolveLane({
    risk: RISKS.LOW,
    scopeOk: true,
    prerequisitesOk: true,
    fastDecision: rejectedClassifierDecision
  });
  assert.equal(rejectedResult.status, LANE_STATUSES.OK);
  assert.equal(rejectedResult.lane, LANES.NORMAL);
});

test('risk elevation: ELEVATED risk always forces ELEVATED_PROCESS regardless of classifier decision', () => {
  const validDecision = makeValidClassifierDecision();

  // Even with a valid Fast decision, ELEVATED risk requires ELEVATED_PROCESS
  const elevatedResult = resolveLane({
    risk: RISKS.ELEVATED,
    scopeOk: true,
    prerequisitesOk: true,
    fastDecision: validDecision
  });
  assert.equal(elevatedResult.status, LANE_STATUSES.OK);
  assert.equal(elevatedResult.lane, LANES.ELEVATED_PROCESS);
  assert(elevatedResult.reasons.includes('ELEVATED_RISK_REQUIRES_ELEVATED_PROCESS'));
  assert(elevatedResult.reasons.includes('FAST_LANE_PROHIBITED_FOR_ELEVATED_RISK'));
});

test('downgrade prevention: laneFloor prevents downward lane transition within revision', () => {
  const validDecision = makeValidClassifierDecision();

  // Candidate qualifies for FAST, but laneFloor is NORMAL -> floored at NORMAL
  const floorNormal = resolveLane({
    risk: RISKS.LOW,
    laneFloor: LANES.NORMAL,
    scopeOk: true,
    prerequisitesOk: true,
    fastDecision: validDecision
  });
  assert.equal(floorNormal.status, LANE_STATUSES.OK);
  assert.equal(floorNormal.lane, LANES.NORMAL);
  assert(floorNormal.reasons.some(r => r.includes('DOWNGRADE_PREVENTED')));

  // Candidate qualifies for FAST, but laneFloor is ELEVATED_PROCESS -> floored at ELEVATED_PROCESS
  const floorElevated = resolveLane({
    risk: RISKS.LOW,
    laneFloor: LANES.ELEVATED_PROCESS,
    scopeOk: true,
    prerequisitesOk: true,
    fastDecision: validDecision
  });
  assert.equal(floorElevated.status, LANE_STATUSES.OK);
  assert.equal(floorElevated.lane, LANES.ELEVATED_PROCESS);
  assert(floorElevated.reasons.some(r => r.includes('DOWNGRADE_PREVENTED')));

  // Candidate is ELEVATED_PROCESS, laneFloor is NORMAL -> upgrades to ELEVATED_PROCESS
  const upgradeNormal = resolveLane({
    risk: RISKS.ELEVATED,
    laneFloor: LANES.NORMAL,
    scopeOk: true,
    prerequisitesOk: true
  });
  assert.equal(upgradeNormal.status, LANE_STATUSES.OK);
  assert.equal(upgradeNormal.lane, LANES.ELEVATED_PROCESS);
});

test('scope failure forces status STOP; cannot be masked by lane elevation', () => {
  const validDecision = makeValidClassifierDecision();

  // Scope violation on LOW risk
  const stopLow = resolveLane({
    risk: RISKS.LOW,
    scopeOk: false,
    prerequisitesOk: true,
    fastDecision: validDecision
  });
  assert.equal(stopLow.status, LANE_STATUSES.STOP);
  assert(stopLow.reasons.includes('SCOPE_VIOLATION'));

  // Scope violation on ELEVATED risk
  const stopElevated = resolveLane({
    risk: RISKS.ELEVATED,
    scopeOk: false,
    prerequisitesOk: true
  });
  assert.equal(stopElevated.status, LANE_STATUSES.STOP);
  assert(stopElevated.reasons.includes('SCOPE_VIOLATION'));
});

test('missing required prerequisites forces status WAIT', () => {
  const validDecision = makeValidClassifierDecision();

  const waitResult = resolveLane({
    risk: RISKS.LOW,
    scopeOk: true,
    prerequisitesOk: false,
    fastDecision: validDecision
  });
  assert.equal(waitResult.status, LANE_STATUSES.WAIT);
  assert(waitResult.reasons.includes('MISSING_PREREQUISITES'));

  // Scope failure takes precedence over missing prerequisites (STOP beats WAIT)
  const stopAndWait = resolveLane({
    risk: RISKS.LOW,
    scopeOk: false,
    prerequisitesOk: false,
    fastDecision: validDecision
  });
  assert.equal(stopAndWait.status, LANE_STATUSES.STOP);
  assert(stopAndWait.reasons.includes('SCOPE_VIOLATION'));
});

test('invalid risk or laneFloor input fails closed', () => {
  const badRisk = resolveLane({ risk: 'INVALID_RISK' });
  assert.equal(badRisk.status, LANE_STATUSES.STOP);
  assert(badRisk.reasons.includes('INVALID_RISK'));

  const badFloor = resolveLane({ risk: RISKS.LOW, laneFloor: 'UNKNOWN_FLOOR' });
  assert.equal(badFloor.status, LANE_STATUSES.STOP);
  assert(badFloor.reasons.includes('INVALID_LANE_FLOOR'));
});

// ============================================================================
// Issue 3 Regressions: Explicit Booleans, No Default Success, Malformed Handling
// ============================================================================

test('P2 regression: resolveLane({risk: "LOW"}) fails closed without success by default', () => {
  // Calling resolveLane without explicit scopeOk and prerequisitesOk must NEVER return OK
  const uninspected = resolveLane({ risk: RISKS.LOW });
  assert.notEqual(uninspected.status, LANE_STATUSES.OK);
  assert.equal(uninspected.status, LANE_STATUSES.STOP);
  assert(uninspected.reasons.includes('SCOPE_INSPECTION_REQUIRED'));
});

test('P2 regression: string booleans "false" and "true" are rejected as malformed; explicit booleans required', () => {
  // scopeOk string 'false' rejected -> STOP
  const malformedScopeFalse = resolveLane({
    risk: RISKS.LOW,
    scopeOk: 'false',
    prerequisitesOk: true
  });
  assert.equal(malformedScopeFalse.status, LANE_STATUSES.STOP);
  assert(malformedScopeFalse.reasons.includes('SCOPE_INSPECTION_MALFORMED'));

  // scopeOk string 'true' rejected -> STOP
  const malformedScopeTrue = resolveLane({
    risk: RISKS.LOW,
    scopeOk: 'true',
    prerequisitesOk: true
  });
  assert.equal(malformedScopeTrue.status, LANE_STATUSES.STOP);
  assert(malformedScopeTrue.reasons.includes('SCOPE_INSPECTION_MALFORMED'));

  // prerequisitesOk string 'false' rejected -> WAIT
  const malformedPrereqFalse = resolveLane({
    risk: RISKS.LOW,
    scopeOk: true,
    prerequisitesOk: 'false'
  });
  assert.equal(malformedPrereqFalse.status, LANE_STATUSES.WAIT);
  assert(malformedPrereqFalse.reasons.includes('PREREQUISITES_MALFORMED'));

  // prerequisitesOk string 'true' rejected -> WAIT
  const malformedPrereqTrue = resolveLane({
    risk: RISKS.LOW,
    scopeOk: true,
    prerequisitesOk: 'true'
  });
  assert.equal(malformedPrereqTrue.status, LANE_STATUSES.WAIT);
  assert(malformedPrereqTrue.reasons.includes('PREREQUISITES_MALFORMED'));

  // Non-boolean numbers rejected
  const numericScope = resolveLane({
    risk: RISKS.LOW,
    scopeOk: 1,
    prerequisitesOk: true
  });
  assert.equal(numericScope.status, LANE_STATUSES.STOP);
  assert(numericScope.reasons.includes('SCOPE_INSPECTION_MALFORMED'));

  const numericPrereq = resolveLane({
    risk: RISKS.LOW,
    scopeOk: true,
    prerequisitesOk: 0
  });
  assert.equal(numericPrereq.status, LANE_STATUSES.WAIT);
  assert(numericPrereq.reasons.includes('PREREQUISITES_MALFORMED'));
});

test('P2 regression: missing scope inspection forces STOP; missing prerequisites forces WAIT', () => {
  // Only prerequisites provided -> scope inspection missing forces STOP
  const missingScope = resolveLane({
    risk: RISKS.LOW,
    prerequisitesOk: true
  });
  assert.equal(missingScope.status, LANE_STATUSES.STOP);
  assert(missingScope.reasons.includes('SCOPE_INSPECTION_REQUIRED'));

  // Only scope provided -> prerequisites missing forces WAIT
  const missingPrereq = resolveLane({
    risk: RISKS.LOW,
    scopeOk: true
  });
  assert.equal(missingPrereq.status, LANE_STATUSES.WAIT);
  assert(missingPrereq.reasons.includes('MISSING_PREREQUISITES'));
});

test('P2 regression: valid positive decisions preserved when explicit booleans are provided', () => {
  // Valid LOW risk with explicit booleans resolves to NORMAL / OK
  const validNormal = resolveLane({
    risk: RISKS.LOW,
    scopeOk: true,
    prerequisitesOk: true
  });
  assert.equal(validNormal.status, LANE_STATUSES.OK);
  assert.equal(validNormal.lane, LANES.NORMAL);

  // Valid LOW risk with legitimate fast classifier resolves to FAST / OK
  const validFast = resolveLane({
    risk: RISKS.LOW,
    scopeOk: true,
    prerequisitesOk: true,
    fastDecision: makeValidClassifierDecision()
  });
  assert.equal(validFast.status, LANE_STATUSES.OK);
  assert.equal(validFast.lane, LANES.FAST);

  // Valid ELEVATED risk resolves to ELEVATED_PROCESS / OK
  const validElevated = resolveLane({
    risk: RISKS.ELEVATED,
    scopeOk: true,
    prerequisitesOk: true
  });
  assert.equal(validElevated.status, LANE_STATUSES.OK);
  assert.equal(validElevated.lane, LANES.ELEVATED_PROCESS);
});

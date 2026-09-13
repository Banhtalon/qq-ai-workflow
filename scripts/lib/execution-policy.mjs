import { createHash } from 'node:crypto';

/**
 * Policy key for controlled delegation v1.
 */
export const POLICY_DISCRIMINATOR = 'CONTROLLED_DELEGATION_V1';

/**
 * Expected schema versions for task and frozen record (lock).
 */
export const TASK_SCHEMA = 'qq.workflow.task.v10';
export const RECORD_SCHEMA = 'qq.workflow.lock.v10';

/**
 * Valid budget origin identifiers.
 */
export const BUDGET_ORIGINS = Object.freeze({
  GEMINI_INITIAL: 'GEMINI_INITIAL',
  ASTRA_INITIAL: 'ASTRA_INITIAL'
});

/**
 * Supported budget event types.
 */
export const BUDGET_EVENTS = Object.freeze({
  INITIAL: 'INITIAL',
  REPAIR_REQUESTED: 'REPAIR_REQUESTED',
  INTERRUPTED: 'INTERRUPTED',
  RESUME_VALIDATED: 'RESUME_VALIDATED'
});

/**
 * Explicit budget action directives returned to the runner.
 */
export const BUDGET_ACTIONS = Object.freeze({
  LAUNCH: 'LAUNCH',
  WAIT: 'WAIT',
  BLOCKED: 'BLOCKED',
  RESUME: 'RESUME'
});

/**
 * Explicit risk assessment levels.
 */
export const RISKS = Object.freeze({
  LOW: 'LOW',
  ELEVATED: 'ELEVATED'
});

/**
 * Execution process lanes.
 * Monotonic ordering: FAST < NORMAL < ELEVATED_PROCESS.
 */
export const LANES = Object.freeze({
  FAST: 'FAST',
  NORMAL: 'NORMAL',
  ELEVATED_PROCESS: 'ELEVATED_PROCESS'
});

/**
 * Monotonic integer ranks for process lanes.
 */
export const LANE_RANKS = Object.freeze({
  [LANES.FAST]: 1,
  [LANES.NORMAL]: 2,
  [LANES.ELEVATED_PROCESS]: 3
});

/**
 * Explicit status outcomes for lane resolution.
 */
export const LANE_STATUSES = Object.freeze({
  OK: 'OK',
  STOP: 'STOP',
  WAIT: 'WAIT'
});

/**
 * Standard failure codes for contract and candidate violations.
 */
export const FAILURE_CODES = Object.freeze({
  CONTRACT_MISMATCH: 'CONTRACT_MISMATCH',
  EXECUTION_MISMATCH: 'EXECUTION_MISMATCH',
  CONTENT_MISMATCH: 'CONTENT_MISMATCH',
  SCOPE_VIOLATION: 'SCOPE_VIOLATION'
});

/**
 * Bound worker and senior model designations.
 */
export const GEMINI_MODEL = 'gemini-3.8-flash-high';
export const ASTRA_MODEL = 'gpt-6-astra';
export const ASTRA_EFFORT = 'low';

/**
 * Canonical contract keys to project from task into frozen payload.
 * Dynamic / mutable task state (candidate_head, contract_sha256, repair_rounds,
 * senior_passes, implementer_sessions, ui_evidence, owner_acceptance, status,
 * attempts, etc.) are explicitly excluded.
 */
export const FROZEN_CONTRACT_KEYS = Object.freeze([
  'acceptance_criteria',
  'accepted_classifier',
  'accepted_classifier_reference',
  'allowed_paths',
  'base_sha',
  'behavior',
  'complexity',
  'exclusions',
  'execution',
  'execution_constraints',
  'gates',
  'goal',
  'initial_lane',
  'initial_risk',
  'lane',
  'policy',
  'policy_version',
  'product_check',
  'product_checks',
  'revision',
  'risk',
  'schema_version',
  'task_id',
  'user_visible',
  'write_paths'
]);

/**
 * Deterministic JSON stringifier with recursively sorted object keys.
 */
function deterministicStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(deterministicStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + deterministicStringify(value[k])).join(',') + '}';
}

/**
 * Compute SHA-256 digest in hex from string or buffer.
 */
function sha256Hex(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Projects frozen contract payload from a task object.
 * Strips dynamic / mutable runtime state.
 *
 * @param {object} task
 * @returns {object} Canonical contract projection
 */
export function projectFrozenPayload(task) {
  if (!task || typeof task !== 'object') {
    throw new TypeError('task must be a non-null object');
  }
  const payload = {};
  for (const key of FROZEN_CONTRACT_KEYS) {
    if (task[key] !== undefined) {
      payload[key] = task[key];
    }
  }
  return payload;
}

/**
 * Computes deterministic SHA-256 digest of a frozen contract payload or task.
 * Always projects canonical contract keys so runtime dynamic state is consistently excluded.
 *
 * @param {object} taskOrPayload
 * @returns {string} Hex SHA-256 digest
 */
export function frozenPayloadDigest(taskOrPayload) {
  if (!taskOrPayload || typeof taskOrPayload !== 'object') {
    throw new TypeError('taskOrPayload must be a non-null object');
  }
  const payload = projectFrozenPayload(taskOrPayload);
  return sha256Hex(deterministicStringify(payload));
}

/**
 * Validates an active task against an independent frozen record.
 * Recomputing a task-declared contract_sha256 cannot satisfy a mismatch.
 * Dynamic runtime state (candidate_head, repair_rounds, sessions, etc.) is
 * projected out and does not invalidate the contract match.
 *
 * Requirements:
 * - Requires task policy to be CONTROLLED_DELEGATION_V1.
 * - Requires record task_id, revision, schema_version, and contract_sha256.
 * - Optional identities or hash aliases (hash, sha256, payload) that downgrade verification are rejected.
 * - Legacy hash fallback is strictly removed for new-policy validation.
 * - Canonical digest projection is deterministic and consistent.
 *
 * @param {object} task
 * @param {object} record Independent frozen record
 * @returns {{ ok: boolean, reason?: string, failure_code?: string, contract_sha256?: string }}
 */
export function validateFrozenRecord(task, record) {
  if (!task || typeof task !== 'object') {
    return {
      ok: false,
      reason: 'Task is missing or not an object',
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH
    };
  }
  if (!record || typeof record !== 'object') {
    return {
      ok: false,
      reason: 'Frozen record is missing or not an object',
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH
    };
  }

  // 1. Task schema and policy validation
  if (task.policy !== POLICY_DISCRIMINATOR) {
    return {
      ok: false,
      reason: `Unsupported task policy: ${task.policy}; expected ${POLICY_DISCRIMINATOR}`,
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH
    };
  }
  if (typeof task.schema_version !== 'string' || !task.schema_version.trim() || task.schema_version !== TASK_SCHEMA) {
    return {
      ok: false,
      reason: `Task missing valid schema_version: expected ${TASK_SCHEMA}`,
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH
    };
  }
  if (typeof task.task_id !== 'string' || !task.task_id.trim()) {
    return {
      ok: false,
      reason: 'Task missing valid task_id',
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH
    };
  }
  if (!Number.isInteger(task.revision) || task.revision < 0) {
    return {
      ok: false,
      reason: 'Task missing valid revision',
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH
    };
  }

  // 2. Frozen record requirements: schema_version, task_id, revision, and contract_sha256 are required.
  // Optional identities or hash aliases (hash, sha256, payload) that downgrade verification are rejected.
  if (typeof record.schema_version !== 'string' || !record.schema_version.trim() || record.schema_version !== RECORD_SCHEMA) {
    return {
      ok: false,
      reason: `Frozen record missing valid schema_version: expected ${RECORD_SCHEMA}`,
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH
    };
  }
  if (record.policy !== undefined && record.policy !== POLICY_DISCRIMINATOR) {
    return {
      ok: false,
      reason: `Record policy mismatch: ${record.policy}; expected ${POLICY_DISCRIMINATOR}`,
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH
    };
  }
  if (typeof record.task_id !== 'string' || !record.task_id.trim() || record.task_id !== task.task_id) {
    return {
      ok: false,
      reason: `Task ID mismatch: task=${task.task_id}, record=${record.task_id}`,
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH
    };
  }
  if (!Number.isInteger(record.revision) || record.revision !== task.revision) {
    return {
      ok: false,
      reason: `Revision mismatch: task=${task.revision}, record=${record.revision}`,
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH
    };
  }
  if (typeof record.contract_sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(record.contract_sha256)) {
    return {
      ok: false,
      reason: 'Frozen record missing valid contract_sha256 digest',
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH
    };
  }

  // Reject unknown fields on frozen record to prevent field laundering
  const ALLOWED_RECORD_KEYS = new Set([
    'schema_version',
    'task_id',
    'revision',
    'contract_sha256',
    'policy',
    'effective_risk_floor',
    'contract_payload'
  ]);
  const unknownRecordKeys = Object.keys(record).filter(k => !ALLOWED_RECORD_KEYS.has(k));
  if (unknownRecordKeys.length > 0) {
    return {
      ok: false,
      reason: `Frozen record contains unknown fields: ${unknownRecordKeys.join(', ')}`,
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH
    };
  }

  // 3. Optional canonical payload verification
  if (record.contract_payload !== undefined) {
    if (!record.contract_payload || typeof record.contract_payload !== 'object' || Array.isArray(record.contract_payload)) {
      return {
        ok: false,
        reason: 'Frozen record contract_payload is invalid',
        failure_code: FAILURE_CODES.CONTRACT_MISMATCH
      };
    }
    // Reject unknown fields in contract_payload to prevent field laundering
    const payloadKeys = Object.keys(record.contract_payload);
    const unknownPayloadKeys = payloadKeys.filter(k => !FROZEN_CONTRACT_KEYS.includes(k));
    if (unknownPayloadKeys.length > 0) {
      return {
        ok: false,
        reason: `Frozen record contract_payload contains unknown fields: ${unknownPayloadKeys.join(', ')}`,
        failure_code: FAILURE_CODES.CONTRACT_MISMATCH
      };
    }
    // Reject unsupported policy or schema in contract_payload
    if (record.contract_payload.policy !== undefined && record.contract_payload.policy !== POLICY_DISCRIMINATOR) {
      return {
        ok: false,
        reason: `Frozen record contract_payload policy mismatch: ${record.contract_payload.policy}; expected ${POLICY_DISCRIMINATOR}`,
        failure_code: FAILURE_CODES.CONTRACT_MISMATCH
      };
    }
    if (record.contract_payload.schema_version !== undefined && record.contract_payload.schema_version !== TASK_SCHEMA) {
      return {
        ok: false,
        reason: `Frozen record contract_payload schema_version mismatch: ${record.contract_payload.schema_version}; expected ${TASK_SCHEMA}`,
        failure_code: FAILURE_CODES.CONTRACT_MISMATCH
      };
    }
    const recordPayloadDigest = frozenPayloadDigest(record.contract_payload);
    if (recordPayloadDigest !== record.contract_sha256) {
      return {
        ok: false,
        reason: 'Frozen record contract_payload does not match record contract_sha256',
        failure_code: FAILURE_CODES.CONTRACT_MISMATCH
      };
    }
  }

  // 4. Compute canonical digest of task and compare with independent frozen record digest.
  // Legacy hash fallback is strictly removed.
  const actualPayload = projectFrozenPayload(task);
  const actualHash = frozenPayloadDigest(actualPayload);

  if (actualHash !== record.contract_sha256) {
    return {
      ok: false,
      reason: `Contract digest mismatch: computed=${actualHash}, record=${record.contract_sha256}`,
      failure_code: FAILURE_CODES.CONTRACT_MISMATCH
    };
  }

  // If record contains contract_payload, verify actual payload matches
  if (record.contract_payload) {
    const expectedPayloadDigest = frozenPayloadDigest(record.contract_payload);
    if (actualHash !== expectedPayloadDigest) {
      return {
        ok: false,
        reason: 'Canonical contract payload does not match independent frozen record payload',
        failure_code: FAILURE_CODES.CONTRACT_MISMATCH
      };
    }
  }

  // 5. If task has a declared contract_sha256 field, verify that it matches the independent record.
  // A candidate that mutated the contract cannot satisfy mismatch by recomputing its own task.contract_sha256.
  if (task.contract_sha256 !== undefined) {
    if (task.contract_sha256 !== record.contract_sha256) {
      return {
        ok: false,
        reason: `Task declared contract_sha256 (${task.contract_sha256}) does not match independent frozen record (${record.contract_sha256})`,
        failure_code: FAILURE_CODES.CONTRACT_MISMATCH
      };
    }
  }

  return {
    ok: true,
    contract_sha256: record.contract_sha256
  };
}

/**
 * Initializes a new immutable budget tracking state object.
 *
 * @param {'GEMINI_INITIAL' | 'ASTRA_INITIAL'} origin
 * @returns {object} Budget state
 */
export function createBudget(origin) {
  if (origin !== BUDGET_ORIGINS.GEMINI_INITIAL && origin !== BUDGET_ORIGINS.ASTRA_INITIAL) {
    throw new Error(`Unsupported budget origin: ${origin}`);
  }
  return Object.freeze({
    schema_version: 'qq.workflow.budget.v1',
    policy: POLICY_DISCRIMINATOR,
    origin,
    initial_count: 0,
    repair_count: 0,
    escalation_count: 0,
    escalation_used: false,
    active_attempt_id: null,
    pending_reconcile: false,
    attempts: Object.freeze([])
  });
}

/**
 * Validates budget state structural integrity and consistency.
 * Reconciles counters with historical attempt reservations.
 *
 * @param {object} state
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateBudgetState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { valid: false, reason: 'Budget state must be a non-null object' };
  }

  // Schema and policy
  if (state.schema_version !== 'qq.workflow.budget.v1') {
    return { valid: false, reason: `Invalid or missing budget schema_version: ${state.schema_version}` };
  }
  if (state.policy !== POLICY_DISCRIMINATOR) {
    return { valid: false, reason: `Invalid or missing budget policy: ${state.policy}` };
  }
  if (state.origin !== BUDGET_ORIGINS.GEMINI_INITIAL && state.origin !== BUDGET_ORIGINS.ASTRA_INITIAL) {
    return { valid: false, reason: `Unsupported budget origin: ${state.origin}` };
  }

  // Counters: finite nonnegative integers required
  if (typeof state.initial_count !== 'number' || !Number.isInteger(state.initial_count) || state.initial_count < 0) {
    return { valid: false, reason: `initial_count must be a finite nonnegative integer (got ${state.initial_count})` };
  }
  if (typeof state.repair_count !== 'number' || !Number.isInteger(state.repair_count) || state.repair_count < 0) {
    return { valid: false, reason: `repair_count must be a finite nonnegative integer (got ${state.repair_count})` };
  }
  if (typeof state.escalation_count !== 'number' || !Number.isInteger(state.escalation_count) || state.escalation_count < 0) {
    return { valid: false, reason: `escalation_count must be a finite nonnegative integer (got ${state.escalation_count})` };
  }

  // Origin-specific counter bounds
  if (state.origin === BUDGET_ORIGINS.GEMINI_INITIAL) {
    if (state.initial_count > 1) {
      return { valid: false, reason: `initial_count exceeds maximum of 1 for GEMINI_INITIAL (got ${state.initial_count})` };
    }
    if (state.repair_count > 2) {
      return { valid: false, reason: `repair_count exceeds maximum of 2 for GEMINI_INITIAL (got ${state.repair_count})` };
    }
    if (state.escalation_count > 1) {
      return { valid: false, reason: `escalation_count exceeds maximum of 1 for GEMINI_INITIAL (got ${state.escalation_count})` };
    }
  } else if (state.origin === BUDGET_ORIGINS.ASTRA_INITIAL) {
    if (state.initial_count > 1) {
      return { valid: false, reason: `initial_count exceeds maximum of 1 for ASTRA_INITIAL (got ${state.initial_count})` };
    }
    if (state.repair_count > 1) {
      return { valid: false, reason: `repair_count exceeds maximum of 1 for ASTRA_INITIAL (got ${state.repair_count})` };
    }
    if (state.escalation_count !== 0) {
      return { valid: false, reason: `escalation_count must be 0 for ASTRA_INITIAL (got ${state.escalation_count})` };
    }
  }

  // Escalation flag check
  if (typeof state.escalation_used !== 'boolean') {
    return { valid: false, reason: 'escalation_used must be a boolean' };
  }
  const expectedEscalationUsed = state.escalation_count > 0;
  if (state.escalation_used !== expectedEscalationUsed) {
    return {
      valid: false,
      reason: `escalation_used (${state.escalation_used}) contradicts escalation_count (${state.escalation_count})`
    };
  }

  // Attempts array
  if (!Array.isArray(state.attempts)) {
    return { valid: false, reason: 'attempts must be an array' };
  }

  // Reconcile counters with attempt history
  const initialAttempts = state.attempts.filter(a => a && a.phase === 'initial');
  const repairAttempts = state.attempts.filter(a => a && a.phase === 'repair');
  const escalationAttempts = state.attempts.filter(a => a && a.phase === 'escalation');

  if (state.initial_count !== initialAttempts.length) {
    return {
      valid: false,
      reason: `initial_count (${state.initial_count}) does not match initial attempt history (${initialAttempts.length})`
    };
  }
  if (state.repair_count !== repairAttempts.length) {
    return {
      valid: false,
      reason: `repair_count (${state.repair_count}) does not match repair attempt history (${repairAttempts.length})`
    };
  }
  if (state.escalation_count !== escalationAttempts.length) {
    return {
      valid: false,
      reason: `escalation_count (${state.escalation_count}) does not match escalation attempt history (${escalationAttempts.length})`
    };
  }
  if (state.attempts.length !== (state.initial_count + state.repair_count + state.escalation_count)) {
    return {
      valid: false,
      reason: `Total attempts (${state.attempts.length}) contradicts sum of counters (${state.initial_count + state.repair_count + state.escalation_count})`
    };
  }

  // Attempt items sequence, IDs, tiers, models, and statuses
  const VALID_STATUSES = new Set(['LAUNCHED', 'INTERRUPTED', 'RESUMED']);
  for (let i = 0; i < state.attempts.length; i++) {
    const att = state.attempts[i];
    if (!att || typeof att !== 'object') {
      return { valid: false, reason: `Attempt at index ${i} is not a valid object` };
    }
    const expectedId = `attempt-${i + 1}`;
    if (att.id !== expectedId) {
      return { valid: false, reason: `Attempt at index ${i} ID mismatch: expected ${expectedId}, got ${att.id}` };
    }
    if (att.origin !== state.origin) {
      return { valid: false, reason: `Attempt ${att.id} origin (${att.origin}) does not match state origin (${state.origin})` };
    }
    if (!VALID_STATUSES.has(att.status)) {
      return { valid: false, reason: `Attempt ${att.id} has invalid status: ${att.status}` };
    }

    if (i === 0) {
      if (att.phase !== 'initial') {
        return { valid: false, reason: `First attempt ${att.id} must have phase 'initial'` };
      }
    } else {
      if (att.phase === 'initial') {
        return { valid: false, reason: `Subsequent attempt ${att.id} cannot have phase 'initial'` };
      }
    }

    if (state.origin === BUDGET_ORIGINS.GEMINI_INITIAL) {
      if (att.phase === 'initial') {
        if (att.tier !== 'worker' || att.model !== GEMINI_MODEL || att.effort !== null) {
          return { valid: false, reason: `Attempt ${att.id} worker/model/effort mismatch for Gemini initial` };
        }
      } else if (att.phase === 'repair') {
        if (att.tier !== 'worker' || att.model !== GEMINI_MODEL || att.effort !== null) {
          return { valid: false, reason: `Attempt ${att.id} worker/model/effort mismatch for Gemini repair` };
        }
      } else if (att.phase === 'escalation') {
        if (att.tier !== 'senior' || att.model !== ASTRA_MODEL || att.effort !== ASTRA_EFFORT) {
          return { valid: false, reason: `Attempt ${att.id} senior/model/effort mismatch for Astra escalation` };
        }
        if (i !== 3) {
          return { valid: false, reason: `Senior escalation attempt ${att.id} must be attempt-4` };
        }
      } else {
        return { valid: false, reason: `Attempt ${att.id} has invalid phase: ${att.phase}` };
      }
    } else if (state.origin === BUDGET_ORIGINS.ASTRA_INITIAL) {
      if (att.phase === 'initial') {
        if (att.tier !== 'senior' || att.model !== ASTRA_MODEL || att.effort !== ASTRA_EFFORT) {
          return { valid: false, reason: `Attempt ${att.id} senior/model/effort mismatch for Astra initial` };
        }
      } else if (att.phase === 'repair') {
        if (att.tier !== 'senior' || att.model !== ASTRA_MODEL || att.effort !== ASTRA_EFFORT) {
          return { valid: false, reason: `Attempt ${att.id} senior/model/effort mismatch for Astra repair` };
        }
      } else {
        return { valid: false, reason: `Attempt ${att.id} has invalid phase for Astra initial: ${att.phase}` };
      }
    }
  }

  // Active attempt and pending reconcile consistency
  if (typeof state.pending_reconcile !== 'boolean') {
    return { valid: false, reason: 'pending_reconcile must be a boolean' };
  }

  if (state.attempts.length === 0) {
    if (state.active_attempt_id !== null) {
      return { valid: false, reason: 'active_attempt_id must be null when attempts is empty' };
    }
    if (state.pending_reconcile !== false) {
      return { valid: false, reason: 'pending_reconcile must be false when attempts is empty' };
    }
  } else {
    const lastAttempt = state.attempts[state.attempts.length - 1];
    if (state.active_attempt_id !== lastAttempt.id) {
      return {
        valid: false,
        reason: `active_attempt_id (${state.active_attempt_id}) does not match last attempt ID (${lastAttempt.id})`
      };
    }
    if (state.pending_reconcile === true && lastAttempt.status !== 'INTERRUPTED') {
      return { valid: false, reason: 'pending_reconcile is true but active attempt is not INTERRUPTED' };
    }
    if (state.pending_reconcile === false && lastAttempt.status === 'INTERRUPTED') {
      return { valid: false, reason: 'pending_reconcile is false but active attempt is INTERRUPTED' };
    }
  }

  return { valid: true };
}

/**
 * Pure state machine advancing budget for controlled delegation.
 * Inputs are treated as immutable; returns a new frozen state and directive action.
 *
 * Budget allocation rules:
 * - GEMINI_INITIAL: 1 initial + 2 repair invocations (Gemini Flash High),
 *   then exactly 1 senior escalation invocation (Astra Low).
 * - ASTRA_INITIAL: 1 initial + 1 repair invocation (Astra Low). Never escalates to itself.
 * - Unsupported origins or events fail closed with BLOCKED.
 * - Interrupted attempt retains reservation/ID and blocks new launches pending reconcile.
 * - Historical attempts define reservations; no extra invocations after senior.
 * - No implicit refund, counter reset, or supplemental budget.
 *
 * @param {object} state Current budget state
 * @param {string | { type: string, effort?: string }} event Budget event
 * @returns {{ state: object, action: string, reason: string }}
 */
export function advanceBudget(state, event) {
  // Fail closed on invalid state
  if (!state || typeof state !== 'object') {
    return {
      state: null,
      action: BUDGET_ACTIONS.BLOCKED,
      reason: 'Invalid or missing budget state'
    };
  }

  // Fail closed on unsupported origin
  if (state.origin !== BUDGET_ORIGINS.GEMINI_INITIAL && state.origin !== BUDGET_ORIGINS.ASTRA_INITIAL) {
    return {
      state,
      action: BUDGET_ACTIONS.BLOCKED,
      reason: `Unsupported budget origin: ${state.origin}`
    };
  }

  // Validate state integrity and reconcile counters with history
  const stateCheck = validateBudgetState(state);
  if (!stateCheck.valid) {
    return {
      state,
      action: BUDGET_ACTIONS.BLOCKED,
      reason: `Malformed budget state: ${stateCheck.reason}`
    };
  }

  // Extract event type and options
  const eventType = typeof event === 'string' ? event : event?.type;
  if (!eventType || !Object.values(BUDGET_EVENTS).includes(eventType)) {
    return {
      state,
      action: BUDGET_ACTIONS.BLOCKED,
      reason: `Unsupported budget event: ${eventType}`
    };
  }

  // Reject Astra effort other than low
  const requestedEffort = typeof event === 'object' ? event?.effort : null;
  if (requestedEffort && requestedEffort !== ASTRA_EFFORT) {
    return {
      state,
      action: BUDGET_ACTIONS.BLOCKED,
      reason: `Astra effort other than '${ASTRA_EFFORT}' is rejected (requested: '${requestedEffort}')`
    };
  }

  const attempts = [...state.attempts];
  const initialCount = state.initial_count;
  const repairCount = state.repair_count;
  const escalationCount = state.escalation_count;
  const escalationUsed = state.escalation_used;
  const activeAttemptId = state.active_attempt_id;
  const pendingReconcile = state.pending_reconcile;

  // --- EVENT: INTERRUPTED ---
  if (eventType === BUDGET_EVENTS.INTERRUPTED) {
    if (attempts.length === 0 || !activeAttemptId) {
      return {
        state,
        action: BUDGET_ACTIONS.BLOCKED,
        reason: 'No active attempt available to interrupt'
      };
    }
    if (pendingReconcile) {
      return {
        state,
        action: BUDGET_ACTIONS.WAIT,
        reason: `Attempt ${activeAttemptId} is already interrupted; reconcile required before proceeding`
      };
    }

    const updatedAttempts = attempts.map(att => {
      if (att.id === activeAttemptId) {
        return Object.freeze({ ...att, status: 'INTERRUPTED' });
      }
      return att;
    });

    const nextState = Object.freeze({
      ...state,
      active_attempt_id: activeAttemptId,
      pending_reconcile: true,
      attempts: Object.freeze(updatedAttempts)
    });

    return {
      state: nextState,
      action: BUDGET_ACTIONS.WAIT,
      reason: `Attempt ${activeAttemptId} interrupted; reconcile required before proceeding; counters retained`
    };
  }

  // --- EVENT: RESUME_VALIDATED ---
  if (eventType === BUDGET_EVENTS.RESUME_VALIDATED) {
    if (!pendingReconcile || !activeAttemptId) {
      return {
        state,
        action: BUDGET_ACTIONS.BLOCKED,
        reason: 'No interrupted attempt pending reconcile'
      };
    }

    const updatedAttempts = attempts.map(att => {
      if (att.id === activeAttemptId) {
        return Object.freeze({ ...att, status: 'RESUMED' });
      }
      return att;
    });

    const nextState = Object.freeze({
      ...state,
      active_attempt_id: activeAttemptId,
      pending_reconcile: false,
      attempts: Object.freeze(updatedAttempts)
    });

    return {
      state: nextState,
      action: BUDGET_ACTIONS.RESUME,
      reason: `Resuming validated interrupted attempt ${activeAttemptId}`
    };
  }

  // --- GUARD: NEW LAUNCHES BLOCKED WHILE PENDING RECONCILE ---
  if (pendingReconcile) {
    return {
      state,
      action: BUDGET_ACTIONS.BLOCKED,
      reason: `Interrupted attempt ${activeAttemptId} pending reconcile; new launches blocked`
    };
  }

  // --- EVENT: INITIAL ---
  if (eventType === BUDGET_EVENTS.INITIAL) {
    if (initialCount > 0 || attempts.length > 0) {
      return {
        state,
        action: BUDGET_ACTIONS.BLOCKED,
        reason: 'Initial invocation already consumed'
      };
    }

    if (state.origin === BUDGET_ORIGINS.GEMINI_INITIAL) {
      const newAttempt = Object.freeze({
        id: 'attempt-1',
        origin: BUDGET_ORIGINS.GEMINI_INITIAL,
        phase: 'initial',
        tier: 'worker',
        model: GEMINI_MODEL,
        effort: null,
        status: 'LAUNCHED'
      });
      const nextState = Object.freeze({
        ...state,
        initial_count: 1,
        active_attempt_id: newAttempt.id,
        pending_reconcile: false,
        attempts: Object.freeze([newAttempt])
      });
      return {
        state: nextState,
        action: BUDGET_ACTIONS.LAUNCH,
        reason: 'Initial Gemini worker invocation'
      };
    }

    if (state.origin === BUDGET_ORIGINS.ASTRA_INITIAL) {
      const newAttempt = Object.freeze({
        id: 'attempt-1',
        origin: BUDGET_ORIGINS.ASTRA_INITIAL,
        phase: 'initial',
        tier: 'senior',
        model: ASTRA_MODEL,
        effort: ASTRA_EFFORT,
        status: 'LAUNCHED'
      });
      const nextState = Object.freeze({
        ...state,
        initial_count: 1,
        active_attempt_id: newAttempt.id,
        pending_reconcile: false,
        attempts: Object.freeze([newAttempt])
      });
      return {
        state: nextState,
        action: BUDGET_ACTIONS.LAUNCH,
        reason: 'Initial Astra worker invocation'
      };
    }
  }

  // --- EVENT: REPAIR_REQUESTED ---
  if (eventType === BUDGET_EVENTS.REPAIR_REQUESTED) {
    if (initialCount === 0) {
      return {
        state,
        action: BUDGET_ACTIONS.BLOCKED,
        reason: 'Cannot request repair before initial attempt'
      };
    }

    // GEMINI_INITIAL repair progression
    if (state.origin === BUDGET_ORIGINS.GEMINI_INITIAL) {
      // Historical attempts define reservations: senior escalation marks final allowed invocation.
      // No extra invocations after senior.
      if (escalationUsed || escalationCount > 0 || attempts.some(a => a.tier === 'senior' || a.phase === 'escalation') || attempts.length >= 4) {
        return {
          state,
          action: BUDGET_ACTIONS.BLOCKED,
          reason: 'Budget exhausted: Gemini initial + 2 repairs + 1 Astra escalation completed'
        };
      }

      // 1. In-budget Gemini repair (up to 2 repairs)
      if (repairCount < 2) {
        const attemptId = `attempt-${attempts.length + 1}`;
        const nextRepairCount = repairCount + 1;
        const newAttempt = Object.freeze({
          id: attemptId,
          origin: BUDGET_ORIGINS.GEMINI_INITIAL,
          phase: 'repair',
          tier: 'worker',
          model: GEMINI_MODEL,
          effort: null,
          status: 'LAUNCHED'
        });
        const nextState = Object.freeze({
          ...state,
          repair_count: nextRepairCount,
          active_attempt_id: attemptId,
          pending_reconcile: false,
          attempts: Object.freeze([...attempts, newAttempt])
        });
        return {
          state: nextState,
          action: BUDGET_ACTIONS.LAUNCH,
          reason: `Gemini repair invocation ${nextRepairCount} of 2`
        };
      }

      // 2. Exactly one senior escalation invocation (Astra Low)
      if (repairCount === 2 && !escalationUsed && escalationCount === 0) {
        const attemptId = `attempt-${attempts.length + 1}`;
        const newAttempt = Object.freeze({
          id: attemptId,
          origin: BUDGET_ORIGINS.GEMINI_INITIAL,
          phase: 'escalation',
          tier: 'senior',
          model: ASTRA_MODEL,
          effort: ASTRA_EFFORT,
          status: 'LAUNCHED'
        });
        const nextState = Object.freeze({
          ...state,
          escalation_count: 1,
          escalation_used: true,
          active_attempt_id: attemptId,
          pending_reconcile: false,
          attempts: Object.freeze([...attempts, newAttempt])
        });
        return {
          state: nextState,
          action: BUDGET_ACTIONS.LAUNCH,
          reason: 'Senior escalation invocation to Astra Low (1 invocation allowed after Gemini initial + 2 repairs)'
        };
      }

      // 3. Exhausted
      return {
        state,
        action: BUDGET_ACTIONS.BLOCKED,
        reason: 'Budget exhausted: Gemini initial + 2 repairs + 1 Astra escalation completed'
      };
    }

    // ASTRA_INITIAL repair progression
    if (state.origin === BUDGET_ORIGINS.ASTRA_INITIAL) {
      if (repairCount < 1 && attempts.length < 2) {
        const attemptId = `attempt-${attempts.length + 1}`;
        const newAttempt = Object.freeze({
          id: attemptId,
          origin: BUDGET_ORIGINS.ASTRA_INITIAL,
          phase: 'repair',
          tier: 'senior',
          model: ASTRA_MODEL,
          effort: ASTRA_EFFORT,
          status: 'LAUNCHED'
        });
        const nextState = Object.freeze({
          ...state,
          repair_count: 1,
          active_attempt_id: attemptId,
          pending_reconcile: false,
          attempts: Object.freeze([...attempts, newAttempt])
        });
        return {
          state: nextState,
          action: BUDGET_ACTIONS.LAUNCH,
          reason: 'Astra repair invocation 1 of 1'
        };
      }

      return {
        state,
        action: BUDGET_ACTIONS.BLOCKED,
        reason: 'Astra initial budget exhausted: initial + 1 repair completed; self-escalation prohibited'
      };
    }
  }

  return {
    state,
    action: BUDGET_ACTIONS.BLOCKED,
    reason: `Unhandled budget transition: origin=${state.origin}, event=${eventType}`
  };
}

/**
 * Structural verification contract for a Fast Lane classifier result.
 * A plain boolean or unauthenticated object does NOT authenticate the classifier.
 *
 * @param {object} decision
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verifyClassifierContract(decision) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    return { valid: false, reason: 'Classifier decision must be a non-null object' };
  }
  if (decision.schema_version !== 'qq.workflow.fast-lane.result.v1') {
    return { valid: false, reason: 'Invalid or missing classifier schema_version' };
  }
  if (decision.status !== 'FAST_LANE' || decision.fast_lane !== true) {
    return { valid: false, reason: 'Classifier decision status is not FAST_LANE' };
  }
  const sha256Regex = /^[0-9a-f]{64}$/i;
  const shaRegex = /^[0-9a-f]{40,64}$/i;
  if (typeof decision.decision_sha256 !== 'string' || !sha256Regex.test(decision.decision_sha256)) {
    return { valid: false, reason: 'Missing or invalid decision_sha256 digest' };
  }
  if (typeof decision.allowlist_sha256 !== 'string' || !sha256Regex.test(decision.allowlist_sha256)) {
    return { valid: false, reason: 'Missing or invalid allowlist_sha256 digest' };
  }
  if (typeof decision.classifier_sha256 !== 'string' || !sha256Regex.test(decision.classifier_sha256)) {
    return { valid: false, reason: 'Missing or invalid classifier_sha256 digest' };
  }
  if (typeof decision.base !== 'string' || !shaRegex.test(decision.base)) {
    return { valid: false, reason: 'Missing or invalid base reference' };
  }
  if (typeof decision.head !== 'string' || !shaRegex.test(decision.head)) {
    return { valid: false, reason: 'Missing or invalid head reference' };
  }
  if (!Array.isArray(decision.reasons) || decision.reasons.length > 0) {
    return { valid: false, reason: 'FAST_LANE classifier decision must have empty rejection reasons' };
  }
  return { valid: true };
}

/**
 * Resolves execution lane and status based on risk, lane floor, scope, prerequisites,
 * and classifier decision.
 *
 * Invariants:
 * - Explicit LOW or ELEVATED risk required.
 * - Monotonic lane hierarchy: FAST < NORMAL < ELEVATED_PROCESS.
 * - ELEVATED risk always mandates ELEVATED_PROCESS.
 * - Positive FAST requires LOW risk and a verified legitimate classifier decision contract.
 * - LOW risk without verified FAST resolves to NORMAL (NORMAL is not a generic error fallback).
 * - No downgrade below laneFloor in the same revision.
 * - Explicit booleans required for scope and prerequisites: no success by default.
 * - Missing/malformed scope inspection forces status STOP with reason; false scope forces STOP.
 * - Missing/malformed prerequisites force status WAIT with reason; false prerequisite forces WAIT.
 *
 * @param {object} params
 * @param {'LOW' | 'ELEVATED'} params.risk
 * @param {'FAST' | 'NORMAL' | 'ELEVATED_PROCESS' | null} [params.laneFloor]
 * @param {boolean} params.scopeOk
 * @param {boolean} params.prerequisitesOk
 * @param {object | null} [params.fastDecision=null]
 * @returns {{ lane: string, status: string, reasons: string[] }}
 */
export function resolveLane({ risk, laneFloor = null, scopeOk, prerequisitesOk, fastDecision = null } = {}) {
  const reasons = [];

  // Validate risk
  if (risk !== RISKS.LOW && risk !== RISKS.ELEVATED) {
    return {
      lane: LANES.ELEVATED_PROCESS,
      status: LANE_STATUSES.STOP,
      reasons: ['INVALID_RISK']
    };
  }

  // Validate laneFloor if provided
  if (laneFloor !== null && laneFloor !== undefined && !LANE_RANKS[laneFloor]) {
    return {
      lane: LANES.ELEVATED_PROCESS,
      status: LANE_STATUSES.STOP,
      reasons: ['INVALID_LANE_FLOOR']
    };
  }

  // Determine candidate lane
  let candidateLane;
  if (risk === RISKS.ELEVATED) {
    candidateLane = LANES.ELEVATED_PROCESS;
    reasons.push('ELEVATED_RISK_REQUIRES_ELEVATED_PROCESS');
    if (fastDecision) {
      reasons.push('FAST_LANE_PROHIBITED_FOR_ELEVATED_RISK');
    }
  } else {
    // Risk is LOW
    const classifierCheck = verifyClassifierContract(fastDecision);
    if (classifierCheck.valid) {
      candidateLane = LANES.FAST;
      reasons.push('FAST_LANE_QUALIFIED');
    } else {
      candidateLane = LANES.NORMAL;
      if (fastDecision !== null && fastDecision !== undefined) {
        reasons.push(`FAST_DECISION_REJECTED: ${classifierCheck.reason}`);
      } else {
        reasons.push('LOW_RISK_DEFAULT_NORMAL');
      }
    }
  }

  // Monotonic floor enforcement (no downgrade in same revision)
  let effectiveLane = candidateLane;
  if (laneFloor && LANE_RANKS[laneFloor] > LANE_RANKS[candidateLane]) {
    effectiveLane = laneFloor;
    reasons.push(`DOWNGRADE_PREVENTED: candidate ${candidateLane} floored at ${laneFloor}`);
  }

  // Scope check: explicit boolean required; no success by default.
  // Missing or malformed scope inspection forces status STOP; false scope forces STOP.
  if (scopeOk === undefined) {
    reasons.push('SCOPE_INSPECTION_REQUIRED');
    return {
      lane: effectiveLane,
      status: LANE_STATUSES.STOP,
      reasons
    };
  }
  if (typeof scopeOk !== 'boolean') {
    reasons.push('SCOPE_INSPECTION_MALFORMED');
    return {
      lane: effectiveLane,
      status: LANE_STATUSES.STOP,
      reasons
    };
  }
  if (scopeOk === false) {
    reasons.push('SCOPE_VIOLATION');
    return {
      lane: effectiveLane,
      status: LANE_STATUSES.STOP,
      reasons
    };
  }

  // Prerequisites check: explicit boolean required; no success by default.
  // Missing or malformed prerequisites force WAIT; false prerequisite forces WAIT.
  if (prerequisitesOk === undefined) {
    reasons.push('MISSING_PREREQUISITES');
    return {
      lane: effectiveLane,
      status: LANE_STATUSES.WAIT,
      reasons
    };
  }
  if (typeof prerequisitesOk !== 'boolean') {
    reasons.push('PREREQUISITES_MALFORMED');
    return {
      lane: effectiveLane,
      status: LANE_STATUSES.WAIT,
      reasons
    };
  }
  if (prerequisitesOk === false) {
    reasons.push('MISSING_PREREQUISITES');
    return {
      lane: effectiveLane,
      status: LANE_STATUSES.WAIT,
      reasons
    };
  }

  return {
    lane: effectiveLane,
    status: LANE_STATUSES.OK,
    reasons
  };
}

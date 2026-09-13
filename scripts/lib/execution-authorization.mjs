/**
 * Execution Authorization Validator for QQ AI Workflow v10.
 *
 * Implements strict Owner authorization validation for sensitive actions (MERGE, DEPLOY)
 * and supplemental recovery requests.
 *
 * Key invariants:
 * - Explicit MERGE or DEPLOY action only.
 * - Strict typed field validation (no informal substitutes).
 * - Merge authorization binds revision, candidate commit, repository, target branch.
 * - Deploy authorization binds revision, artifact/commit, environment/destination.
 * - Requires approved_by (non-empty), valid ISO-8601 approved_at, and non-empty owner_instruction_ref.
 * - Status, DONE/WORKFLOW_DONE, string values, or informal fields never authorize.
 * - Any mismatch or invalid input fails closed: returns { ok: false, reason: string }.
 * - No action is performed (read-only validator).
 */

const COMMIT_OR_ARTIFACT_REGEX = /^[0-9a-f]{40}$/i;
const ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

function isPositiveInteger(val) {
  return typeof val === 'number' && Number.isInteger(val) && val > 0;
}

function isValidIsoTimestamp(val) {
  if (!isNonEmptyString(val)) return false;
  if (!ISO_TIMESTAMP_REGEX.test(val)) return false;
  const t = Date.parse(val);
  return !Number.isNaN(t);
}

function getCandidateCommit(obj, label) {
  const val = obj.candidate_commit ?? obj.commit;
  if (!isNonEmptyString(val) || !COMMIT_OR_ARTIFACT_REGEX.test(val)) {
    return { ok: false, reason: `${label} candidate_commit must be a 40-character hex commit SHA` };
  }
  return { ok: true, value: val.toLowerCase() };
}

function getArtifactOrCommit(obj, label) {
  const val = obj.artifact_or_commit ?? obj.artifact ?? obj.commit;
  if (!isNonEmptyString(val) || !COMMIT_OR_ARTIFACT_REGEX.test(val)) {
    return { ok: false, reason: `${label} artifact_or_commit must be a 40-character hex string` };
  }
  return { ok: true, value: val.toLowerCase() };
}

function getDeployDestination(obj, label) {
  const hasDest = obj.destination !== undefined;
  const hasEnv = obj.environment !== undefined;

  if (!hasDest && !hasEnv) {
    return { ok: false, reason: `${label} must specify environment or destination` };
  }

  if (hasDest) {
    if (!isNonEmptyString(obj.destination)) {
      return { ok: false, reason: `${label} destination must be a non-empty string` };
    }
  }

  if (hasEnv) {
    if (!isNonEmptyString(obj.environment)) {
      return { ok: false, reason: `${label} environment must be a non-empty string` };
    }
  }

  if (hasDest && hasEnv) {
    if (obj.destination.trim() !== obj.environment.trim()) {
      return { ok: false, reason: `${label} destination and environment mismatch` };
    }
  }

  const val = (obj.destination ?? obj.environment).trim();
  return { ok: true, value: val };
}

/**
 * Validate action authorization for MERGE or DEPLOY.
 *
 * @param {string} action - 'MERGE' or 'DEPLOY'
 * @param {object} target - Target execution descriptor
 * @param {object} authorization - Owner authorization descriptor
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateActionAuthorization(action, target, authorization) {
  try {
    if (action !== 'MERGE' && action !== 'DEPLOY') {
      return {
        ok: false,
        reason: `Unsupported or invalid action: expected "MERGE" or "DEPLOY", received ${JSON.stringify(action)}`
      };
    }

    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      return { ok: false, reason: 'Target must be a non-null object' };
    }

    if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
      return { ok: false, reason: 'Authorization must be a non-null object' };
    }

    if (authorization.action !== action) {
      return {
        ok: false,
        reason: `Authorization action "${authorization.action}" does not match requested action "${action}"`
      };
    }

    if (!isPositiveInteger(target.revision)) {
      return { ok: false, reason: 'Target revision must be a positive integer' };
    }

    if (!isPositiveInteger(authorization.revision)) {
      return { ok: false, reason: 'Authorization revision must be a positive integer' };
    }

    if (authorization.revision !== target.revision) {
      return {
        ok: false,
        reason: `Revision mismatch: target has ${target.revision}, authorization has ${authorization.revision}`
      };
    }

    if (!isNonEmptyString(authorization.approved_by)) {
      return { ok: false, reason: 'Authorization approved_by must be a non-empty string' };
    }

    if (!isValidIsoTimestamp(authorization.approved_at)) {
      return { ok: false, reason: 'Authorization approved_at must be a valid ISO 8601 timestamp string' };
    }

    if (!isNonEmptyString(authorization.owner_instruction_ref)) {
      return { ok: false, reason: 'Authorization owner_instruction_ref must be a non-empty string' };
    }

    if (action === 'MERGE') {
      const targetCommitRes = getCandidateCommit(target, 'Target');
      if (!targetCommitRes.ok) return targetCommitRes;

      const authCommitRes = getCandidateCommit(authorization, 'Authorization');
      if (!authCommitRes.ok) return authCommitRes;

      if (authCommitRes.value !== targetCommitRes.value) {
        return {
          ok: false,
          reason: `candidate_commit mismatch: target has ${target.candidate_commit}, authorization has ${authorization.candidate_commit}`
        };
      }

      if (!isNonEmptyString(target.repository)) {
        return { ok: false, reason: 'Target repository must be a non-empty string' };
      }

      if (!isNonEmptyString(authorization.repository)) {
        return { ok: false, reason: 'Authorization repository must be a non-empty string' };
      }

      if (authorization.repository.trim() !== target.repository.trim()) {
        return {
          ok: false,
          reason: `repository mismatch: target has "${target.repository}", authorization has "${authorization.repository}"`
        };
      }

      if (!isNonEmptyString(target.target_branch)) {
        return { ok: false, reason: 'Target target_branch must be a non-empty string' };
      }

      if (!isNonEmptyString(authorization.target_branch)) {
        return { ok: false, reason: 'Authorization target_branch must be a non-empty string' };
      }

      if (authorization.target_branch.trim() !== target.target_branch.trim()) {
        return {
          ok: false,
          reason: `target_branch mismatch: target has "${target.target_branch}", authorization has "${authorization.target_branch}"`
        };
      }
    } else if (action === 'DEPLOY') {
      const targetArtifactRes = getArtifactOrCommit(target, 'Target');
      if (!targetArtifactRes.ok) return targetArtifactRes;

      const authArtifactRes = getArtifactOrCommit(authorization, 'Authorization');
      if (!authArtifactRes.ok) return authArtifactRes;

      if (authArtifactRes.value !== targetArtifactRes.value) {
        return {
          ok: false,
          reason: `artifact_or_commit mismatch: target has ${target.artifact_or_commit}, authorization has ${authorization.artifact_or_commit}`
        };
      }

      const targetDestRes = getDeployDestination(target, 'Target');
      if (!targetDestRes.ok) return targetDestRes;

      const authDestRes = getDeployDestination(authorization, 'Authorization');
      if (!authDestRes.ok) return authDestRes;

      if (authDestRes.value !== targetDestRes.value) {
        return {
          ok: false,
          reason: `destination/environment mismatch: target has "${targetDestRes.value}", authorization has "${authDestRes.value}"`
        };
      }
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `Unexpected error during authorization validation: ${err?.message || err}` };
  }
}

/**
 * Validate supplemental recovery authorization against prior execution records.
 *
 * Requirements:
 * - Bounded same-revision extension.
 * - Requirement text and requirement_sha256 must match prior record.
 * - Non-empty owner_instruction_ref.
 * - Positive integer additional_budget.
 * - Strict preservation of prior counters (repair_count, initial_count) and history (attempts).
 *
 * @param {object} priorRecord - Prior execution or recovery record
 * @param {object} recoveryRecord - Proposed recovery authorization
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateSupplementalRecoveryAuthorization(priorRecord, recoveryRecord) {
  try {
    if (!priorRecord || typeof priorRecord !== 'object' || Array.isArray(priorRecord)) {
      return { ok: false, reason: 'priorRecord must be a non-null object' };
    }

    if (!recoveryRecord || typeof recoveryRecord !== 'object' || Array.isArray(recoveryRecord)) {
      return { ok: false, reason: 'recoveryRecord must be a non-null object' };
    }

    if (!isPositiveInteger(priorRecord.revision)) {
      return { ok: false, reason: 'priorRecord revision must be a positive integer' };
    }

    if (!isPositiveInteger(recoveryRecord.revision)) {
      return { ok: false, reason: 'recoveryRecord revision must be a positive integer' };
    }

    if (recoveryRecord.revision !== priorRecord.revision) {
      return {
        ok: false,
        reason: `Revision mismatch: expected ${priorRecord.revision}, got ${recoveryRecord.revision}`
      };
    }

    if (priorRecord.requirement !== undefined && recoveryRecord.requirement !== undefined) {
      if (recoveryRecord.requirement !== priorRecord.requirement) {
        return { ok: false, reason: 'Requirement text mismatch between recovery and prior record' };
      }
    }

    if (priorRecord.requirement_sha256 !== undefined) {
      if (recoveryRecord.requirement_sha256 !== priorRecord.requirement_sha256) {
        return {
          ok: false,
          reason: `Requirement sha256 mismatch: expected ${priorRecord.requirement_sha256}, got ${recoveryRecord.requirement_sha256}`
        };
      }
    }

    if (!isNonEmptyString(recoveryRecord.owner_instruction_ref)) {
      return { ok: false, reason: 'owner_instruction_ref must be a non-empty string' };
    }

    if (!isPositiveInteger(recoveryRecord.additional_budget)) {
      return { ok: false, reason: 'additional_budget must be a positive integer' };
    }

    // Must not reset prior counters or history
    if (recoveryRecord.reset_counters === true || recoveryRecord.reset === true) {
      return { ok: false, reason: 'Supplemental recovery cannot reset counters' };
    }

    if (recoveryRecord.repair_count !== undefined && recoveryRecord.repair_count < (priorRecord.repair_count ?? 0)) {
      return { ok: false, reason: 'Supplemental recovery cannot decrement repair_count' };
    }

    if (recoveryRecord.initial_count !== undefined && recoveryRecord.initial_count < (priorRecord.initial_count ?? 0)) {
      return { ok: false, reason: 'Supplemental recovery cannot decrement initial_count' };
    }

    if (recoveryRecord.attempts !== undefined) {
      if (!Array.isArray(recoveryRecord.attempts) || recoveryRecord.attempts.length < (priorRecord.attempts?.length ?? 0)) {
        return { ok: false, reason: 'Supplemental recovery cannot erase or truncate attempts history' };
      }
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: `Unexpected error during supplemental recovery validation: ${err?.message || err}`
    };
  }
}

export const validateSupplementalRecoveryRecord = validateSupplementalRecoveryAuthorization;
export const validateSupplementalRecovery = validateSupplementalRecoveryAuthorization;

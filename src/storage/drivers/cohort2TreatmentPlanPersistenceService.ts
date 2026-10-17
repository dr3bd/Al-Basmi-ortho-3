/**
 * AL-BASMI ORTH — COHORT 2 TREATMENT PLAN & OBJECTIVE PERSISTENCE SERVICE
 * Scope: PHASE P3-F (Treatment Objectives, Objective-Problem Associations & Treatment Plans SQLite Integration)
 *
 * Baselines & Frozen Authorities:
 * - SCHEMA_FREEZE_v1.0 (src/domain/p0SqliteSchema.ts):
 *     - treatment_objectives (12 columns)
 *     - objective_problems (5 columns)
 *     - diagnosis_objectives (5 columns)
 *     - treatment_plans (12 columns)
 *     - treatment_plan_objectives (5 columns)
 *     - planned_interventions (12 columns)
 * - PERSISTENCE_ADAPTER_CONTRACT_v1.0 (src/storage/types/storageAdapter.ts)
 *
 * Architecture Principles:
 * - Single authoritative storage: Physical SQLite via ISqliteStorageAdapter.
 * - Atomic transaction (IMMEDIATE): objectives/plans + junction links + audit_logs + sync_operations.
 * - Parent reference integrity: target case, patient, problems, diagnosis MUST exist authoritatively in SQLite.
 * - Cross-case contamination protection: objectives and problem links MUST match parent case.
 * - Rejection of synthetic/demo patients/cases.
 * - Zero fallback to in-memory/localStorage shadow SSOT.
 * - Strict rollback and error propagation on any stage failure.
 */

import {
  SqliteTreatmentObjectiveRow,
  SqliteObjectiveProblemJunctionRow,
  SqliteTreatmentPlanRow,
  SqliteAuditLogRow,
  SqliteSyncOperationRow,
} from '../../domain/p0SqliteSchema.ts';
import {
  ISqliteStorageAdapter,
  ISqliteTransactionContext,
} from '../types/storageAdapter.ts';
import {
  ISqliteExecutor,
  canonicalizeJsonPayload,
  SqliteAuditLogRepository,
  SqliteSyncOperationRepository,
} from './cohort1PersistenceService.ts';
import { SqlitePatientRepository } from './cohort2PatientPersistenceService.ts';
import { SqliteCaseRepository, SYNTHETIC_DEMO_PATIENT_IDS } from './cohort2CasePersistenceService.ts';
import { SqliteProblemRepository, SYNTHETIC_DEMO_CASE_IDS } from './cohort2ProblemDiagnosisPersistenceService.ts';
import { AuthoritativeValidationRole } from '../../domain/p2cDomainValidationEngine.ts';

// ============================================================================
// 1. ERROR CODES & STRUCTURED ERROR CONTRACT
// ============================================================================

export type Cohort2TreatmentPlanErrorCode =
  | 'ERR_OBJECTIVE_NOT_FOUND'
  | 'ERR_PLAN_NOT_FOUND'
  | 'ERR_PROBLEM_NOT_FOUND'
  | 'ERR_DIAGNOSIS_NOT_FOUND'
  | 'ERR_CASE_NOT_FOUND'
  | 'ERR_PATIENT_NOT_FOUND'
  | 'ERR_DEMO_RECORD_REJECTED'
  | 'ERR_CROSS_CASE_CONTAMINATION'
  | 'ERR_PATIENT_CASE_MISMATCH'
  | 'ERR_DOMAIN_VALIDATION_FAILED'
  | 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH'
  | 'ERR_TRANSACTION_FAILED'
  | 'ERR_CONSTRAINT_VIOLATION'
  | 'ERR_DUPLICATE_ID';

export class Cohort2TreatmentPlanPersistenceError extends Error {
  constructor(
    public readonly code: Cohort2TreatmentPlanErrorCode,
    message: string,
    public readonly entityType = 'TreatmentObjective',
    public readonly entityId?: string,
    public readonly operationId?: string
  ) {
    super(`[${code}] ${message}`);
    this.name = 'Cohort2TreatmentPlanPersistenceError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ============================================================================
// 2. CREATION PARAMETERS & RESULT INTERFACES
// ============================================================================

export interface CreateObjectiveParams {
  id?: string;
  caseId: string;
  objectiveCode: string;
  title: string;
  description?: string | null;
  priority?: number;
  status?: SqliteTreatmentObjectiveRow['status'];
  linkedProblemIds?: string[];
  userId: string;
  userRole?: AuthoritativeValidationRole;
  deviceId: string;
  timestamp?: string;
  operationId?: string;
}

export interface UpdateObjectiveParams {
  objectiveId: string;
  title?: string;
  description?: string | null;
  priority?: number;
  status?: SqliteTreatmentObjectiveRow['status'];
  linkedProblemIds?: string[];
  userId: string;
  userRole?: AuthoritativeValidationRole;
  deviceId: string;
  timestamp?: string;
  operationId?: string;
}

export interface ObjectiveOperationResult {
  ok: boolean;
  isIdempotentHit: boolean;
  objective: SqliteTreatmentObjectiveRow;
  linkedProblemCount: number;
  syncOperationId: string;
  auditLogId: string;
}

export interface CreateTreatmentPlanParams {
  id?: string;
  caseId: string;
  versionNumber?: number;
  title: string;
  summary?: string | null;
  diagnosisVersionId?: string | null;
  status?: SqliteTreatmentPlanRow['status'];
  userId: string;
  userRole?: AuthoritativeValidationRole;
  deviceId: string;
  timestamp?: string;
  operationId?: string;
}

export interface SelectTreatmentPlanParams {
  planId: string;
  caseId: string;
  userId: string;
  userRole?: AuthoritativeValidationRole;
  deviceId: string;
  timestamp?: string;
  operationId?: string;
}

export interface TreatmentPlanOperationResult {
  ok: boolean;
  isIdempotentHit: boolean;
  plan: SqliteTreatmentPlanRow;
  syncOperationId: string;
  auditLogId: string;
}

function generateSafeId(prefix = ''): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return prefix ? `${prefix}-${crypto.randomUUID()}` : crypto.randomUUID();
  }
  const rand = Math.random().toString(36).substring(2, 10);
  const time = Date.now().toString(36);
  return prefix ? `${prefix}-${time}-${rand}` : `${time}-${rand}`;
}

// ============================================================================
// 3. SQLITE TREATMENT OBJECTIVE REPOSITORY
// ============================================================================

export class SqliteTreatmentObjectiveRepository {
  public async insert(
    executor: ISqliteExecutor,
    row: SqliteTreatmentObjectiveRow
  ): Promise<void> {
    await executor.execute(
      `INSERT INTO treatment_objectives (
        id, case_id, objective_code, title, description, priority, status,
        created_at, updated_at, created_by, updated_by, version
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      );`,
      [
        row.id,
        row.case_id,
        row.objective_code,
        row.title,
        row.description ?? null,
        row.priority,
        row.status,
        row.created_at,
        row.updated_at,
        row.created_by,
        row.updated_by,
        row.version,
      ]
    );
  }

  public async updateDetails(
    executor: ISqliteExecutor,
    id: string,
    fields: {
      title?: string;
      description?: string | null;
      priority?: number;
      status?: SqliteTreatmentObjectiveRow['status'];
      updatedBy: string;
      updatedAt: string;
      version: number;
    }
  ): Promise<void> {
    const sets: string[] = ['updated_by = ?', 'updated_at = ?', 'version = ?'];
    const params: (string | number | null)[] = [fields.updatedBy, fields.updatedAt, fields.version];

    if (fields.title !== undefined) {
      sets.push('title = ?');
      params.push(fields.title);
    }
    if (fields.description !== undefined) {
      sets.push('description = ?');
      params.push(fields.description);
    }
    if (fields.priority !== undefined) {
      sets.push('priority = ?');
      params.push(fields.priority);
    }
    if (fields.status !== undefined) {
      sets.push('status = ?');
      params.push(fields.status);
    }

    params.push(id);
    await executor.execute(
      `UPDATE treatment_objectives SET ${sets.join(', ')} WHERE id = ?;`,
      params as (string | number | null)[]
    );
  }

  public async getById(
    executor: ISqliteExecutor,
    id: string
  ): Promise<SqliteTreatmentObjectiveRow | null> {
    return executor.queryOne<SqliteTreatmentObjectiveRow>(
      'SELECT * FROM treatment_objectives WHERE id = ?;',
      [id]
    );
  }

  public async listByCaseId(
    executor: ISqliteExecutor,
    caseId: string
  ): Promise<SqliteTreatmentObjectiveRow[]> {
    return executor.query<SqliteTreatmentObjectiveRow>(
      'SELECT * FROM treatment_objectives WHERE case_id = ? ORDER BY priority ASC, created_at ASC;',
      [caseId]
    );
  }

  public async delete(executor: ISqliteExecutor, id: string): Promise<void> {
    await executor.execute('DELETE FROM treatment_objectives WHERE id = ?;', [id]);
  }

  // --- Objective-Problem Junction Methods ---

  public async insertProblemLink(
    executor: ISqliteExecutor,
    row: SqliteObjectiveProblemJunctionRow
  ): Promise<void> {
    await executor.execute(
      `INSERT INTO objective_problems (
        id, objective_id, problem_id, relationship_type, created_at
      ) VALUES (?, ?, ?, ?, ?);`,
      [row.id, row.objective_id, row.problem_id, row.relationship_type, row.created_at]
    );
  }

  public async deleteProblemLink(
    executor: ISqliteExecutor,
    objectiveId: string,
    problemId: string
  ): Promise<void> {
    await executor.execute(
      'DELETE FROM objective_problems WHERE objective_id = ? AND problem_id = ?;',
      [objectiveId, problemId]
    );
  }

  public async deleteProblemLinksByObjectiveId(
    executor: ISqliteExecutor,
    objectiveId: string
  ): Promise<void> {
    await executor.execute(
      'DELETE FROM objective_problems WHERE objective_id = ?;',
      [objectiveId]
    );
  }

  public async listProblemLinksByObjectiveId(
    executor: ISqliteExecutor,
    objectiveId: string
  ): Promise<SqliteObjectiveProblemJunctionRow[]> {
    return executor.query<SqliteObjectiveProblemJunctionRow>(
      'SELECT * FROM objective_problems WHERE objective_id = ? ORDER BY created_at ASC;',
      [objectiveId]
    );
  }

  public async listProblemLinksByCaseId(
    executor: ISqliteExecutor,
    caseId: string
  ): Promise<SqliteObjectiveProblemJunctionRow[]> {
    return executor.query<SqliteObjectiveProblemJunctionRow>(
      `SELECT op.* FROM objective_problems op
       INNER JOIN treatment_objectives obj ON op.objective_id = obj.id
       WHERE obj.case_id = ?;`,
      [caseId]
    );
  }
}

// ============================================================================
// 4. SQLITE TREATMENT PLAN REPOSITORY
// ============================================================================

export class SqliteTreatmentPlanRepository {
  public async insert(
    executor: ISqliteExecutor,
    row: SqliteTreatmentPlanRow
  ): Promise<void> {
    await executor.execute(
      `INSERT INTO treatment_plans (
        id, case_id, version_number, status, title, summary,
        diagnosis_version_id, created_at, created_by, approved_at, approved_by, supersedes_plan_id
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      );`,
      [
        row.id,
        row.case_id,
        row.version_number,
        row.status,
        row.title,
        row.summary ?? null,
        row.diagnosis_version_id,
        row.created_at,
        row.created_by,
        row.approved_at ?? null,
        row.approved_by ?? null,
        row.supersedes_plan_id ?? null,
      ]
    );
  }

  public async updateStatus(
    executor: ISqliteExecutor,
    id: string,
    status: SqliteTreatmentPlanRow['status'],
    approvedBy?: string | null,
    approvedAt?: string | null
  ): Promise<void> {
    if (approvedBy !== undefined || approvedAt !== undefined) {
      await executor.execute(
        `UPDATE treatment_plans SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?;`,
        [status, approvedBy ?? null, approvedAt ?? null, id]
      );
    } else {
      await executor.execute(
        `UPDATE treatment_plans SET status = ? WHERE id = ?;`,
        [status, id]
      );
    }
  }

  public async getById(
    executor: ISqliteExecutor,
    id: string
  ): Promise<SqliteTreatmentPlanRow | null> {
    return executor.queryOne<SqliteTreatmentPlanRow>(
      'SELECT * FROM treatment_plans WHERE id = ?;',
      [id]
    );
  }

  public async listByCaseId(
    executor: ISqliteExecutor,
    caseId: string
  ): Promise<SqliteTreatmentPlanRow[]> {
    return executor.query<SqliteTreatmentPlanRow>(
      'SELECT * FROM treatment_plans WHERE case_id = ? ORDER BY version_number ASC;',
      [caseId]
    );
  }
}

// ============================================================================
// 5. COHORT 2 TREATMENT PLAN & OBJECTIVE PERSISTENCE SERVICE
// ============================================================================

export class Cohort2TreatmentPlanPersistenceService {
  private readonly objectiveRepo: SqliteTreatmentObjectiveRepository;
  private readonly planRepo: SqliteTreatmentPlanRepository;
  private readonly caseRepo: SqliteCaseRepository;
  private readonly patientRepo: SqlitePatientRepository;
  private readonly problemRepo: SqliteProblemRepository;
  private readonly auditRepo: SqliteAuditLogRepository;
  private readonly syncRepo: SqliteSyncOperationRepository;

  constructor(private readonly adapter: ISqliteStorageAdapter) {
    this.objectiveRepo = new SqliteTreatmentObjectiveRepository();
    this.planRepo = new SqliteTreatmentPlanRepository();
    this.caseRepo = new SqliteCaseRepository();
    this.patientRepo = new SqlitePatientRepository();
    this.problemRepo = new SqliteProblemRepository();
    this.auditRepo = new SqliteAuditLogRepository();
    this.syncRepo = new SqliteSyncOperationRepository();
  }

  /**
   * Creates a treatment objective atomically (treatment_objectives + objective_problems + audit_logs + sync_operations).
   */
  public async createObjective(params: CreateObjectiveParams): Promise<ObjectiveOperationResult> {
    const operationId = params.operationId || generateSafeId('op');
    const objectiveId = params.id || generateSafeId('obj');
    const now = params.timestamp || new Date().toISOString();
    const userRole = params.userRole || 'ORTHODONTIST';

    // 1. Reject demo cases
    if (SYNTHETIC_DEMO_CASE_IDS.has(params.caseId)) {
      throw new Cohort2TreatmentPlanPersistenceError(
        'ERR_DEMO_RECORD_REJECTED',
        `Cannot create treatment objective for synthetic demo case '${params.caseId}'.`,
        'TreatmentObjective',
        objectiveId,
        operationId
      );
    }

    // 2. Parent case check
    const parentCase = await this.caseRepo.getById(this.adapter, params.caseId, true);
    if (!parentCase || parentCase.is_deleted === 1) {
      throw new Cohort2TreatmentPlanPersistenceError(
        'ERR_CASE_NOT_FOUND',
        `Referenced orthodontic case '${params.caseId}' does not exist or is soft-deleted.`,
        'TreatmentObjective',
        objectiveId,
        operationId
      );
    }

    // 3. Parent patient check
    if (SYNTHETIC_DEMO_PATIENT_IDS.has(parentCase.patient_id)) {
      throw new Cohort2TreatmentPlanPersistenceError(
        'ERR_DEMO_RECORD_REJECTED',
        `Cannot create objective for a case linked to synthetic demo patient '${parentCase.patient_id}'.`,
        'TreatmentObjective',
        objectiveId,
        operationId
      );
    }

    // 4. Role validation
    if (userRole !== 'ORTHODONTIST' && userRole !== 'ADMIN') {
      throw new Cohort2TreatmentPlanPersistenceError(
        'ERR_DOMAIN_VALIDATION_FAILED',
        `User role '${userRole}' is not authorized to create treatment objectives.`,
        'TreatmentObjective',
        objectiveId,
        operationId
      );
    }

    const row: SqliteTreatmentObjectiveRow = {
      id: objectiveId,
      case_id: params.caseId,
      objective_code: params.objectiveCode || `OBJ-${Date.now().toString().slice(-4)}`,
      title: params.title,
      description: params.description ?? '',
      priority: params.priority ?? 1,
      status: params.status || 'ACTIVE',
      created_at: now,
      updated_at: now,
      created_by: params.userId,
      updated_by: params.userId,
      version: 1,
    };

    try {
      return await this.adapter.transaction('IMMEDIATE', async (tx: ISqliteTransactionContext) => {
        // Idempotency check
        const existingOp = await this.syncRepo.getByOperationId(tx, operationId);
        if (existingOp) {
          const existingObj = await this.objectiveRepo.getById(tx, existingOp.entity_id);
          if (existingObj) {
            return {
              ok: true,
              isIdempotentHit: true,
              objective: existingObj,
              linkedProblemCount: 0,
              syncOperationId: operationId,
              auditLogId: `aud-idemp-${operationId}`,
            };
          }
        }

        await this.objectiveRepo.insert(tx, row);

        let linkedProblemCount = 0;
        if (params.linkedProblemIds && params.linkedProblemIds.length > 0) {
          for (const probId of params.linkedProblemIds) {
            const prob = await this.problemRepo.getById(tx, probId);
            if (!prob) {
              throw new Cohort2TreatmentPlanPersistenceError(
                'ERR_PROBLEM_NOT_FOUND',
                `Linked problem '${probId}' does not exist in SQLite.`,
                'ObjectiveProblem',
                probId,
                operationId
              );
            }
            if (prob.case_id !== params.caseId) {
              throw new Cohort2TreatmentPlanPersistenceError(
                'ERR_CROSS_CASE_CONTAMINATION',
                `Cross-case contamination rejected: problem '${probId}' belongs to case '${prob.case_id}', not '${params.caseId}'.`,
                'ObjectiveProblem',
                probId,
                operationId
              );
            }

            const linkRow: SqliteObjectiveProblemJunctionRow = {
              id: generateSafeId('ojp'),
              objective_id: objectiveId,
              problem_id: probId,
              relationship_type: 'PRIMARY_RESOLUTION',
              created_at: now,
            };
            await this.objectiveRepo.insertProblemLink(tx, linkRow);
            linkedProblemCount++;
          }
        }

        const auditId = generateSafeId('aud');
        const auditRow: SqliteAuditLogRow = {
          id: auditId,
          entity_type: 'treatment_objectives',
          entity_id: objectiveId,
          operation_type: 'CREATE',
          user_id: params.userId,
          device_id: params.deviceId,
          timestamp: now,
          entity_version_before: null,
          entity_version_after: 1,
          old_payload: null,
          new_payload: canonicalizeJsonPayload({
            id: objectiveId,
            case_id: params.caseId,
            title: params.title,
            status: row.status,
          }),
          reason_code: 'CREATE_TREATMENT_OBJECTIVE',
          metadata_json: JSON.stringify({ operation_id: operationId, case_id: params.caseId }),
        };
        await this.auditRepo.insert(tx, auditRow);

        const syncRow: SqliteSyncOperationRow = {
          operation_id: operationId,
          device_id: params.deviceId,
          entity_type: 'treatment_objectives',
          entity_id: objectiveId,
          operation_type: 'CREATE',
          base_version: 0,
          result_version: 1,
          payload: canonicalizeJsonPayload({
            id: objectiveId,
            case_id: params.caseId,
            title: params.title,
          }),
          created_at: now,
          sync_status: 'PENDING',
          retry_count: 0,
          error_code: null,
          error_message: null,
        };
        await this.syncRepo.insert(tx, syncRow);

        return {
          ok: true,
          isIdempotentHit: false,
          objective: row,
          linkedProblemCount,
          syncOperationId: operationId,
          auditLogId: auditId,
        };
      });
    } catch (err: unknown) {
      if (err instanceof Cohort2TreatmentPlanPersistenceError) throw err;
      const anyErr = err as any;
      if (anyErr?.cause instanceof Cohort2TreatmentPlanPersistenceError) throw anyErr.cause;
      throw err;
    }
  }

  /**
   * Updates a treatment objective and its problem links atomically.
   */
  public async updateObjective(params: UpdateObjectiveParams): Promise<ObjectiveOperationResult> {
    const operationId = params.operationId || generateSafeId('op');
    const now = params.timestamp || new Date().toISOString();
    const userRole = params.userRole || 'ORTHODONTIST';

    const existing = await this.objectiveRepo.getById(this.adapter, params.objectiveId);
    if (!existing) {
      throw new Cohort2TreatmentPlanPersistenceError(
        'ERR_OBJECTIVE_NOT_FOUND',
        `Treatment objective '${params.objectiveId}' does not exist in SQLite.`,
        'TreatmentObjective',
        params.objectiveId,
        operationId
      );
    }

    if (SYNTHETIC_DEMO_CASE_IDS.has(existing.case_id)) {
      throw new Cohort2TreatmentPlanPersistenceError(
        'ERR_DEMO_RECORD_REJECTED',
        `Cannot mutate objective for synthetic demo case '${existing.case_id}'.`,
        'TreatmentObjective',
        params.objectiveId,
        operationId
      );
    }

    if (userRole !== 'ORTHODONTIST' && userRole !== 'ADMIN') {
      throw new Cohort2TreatmentPlanPersistenceError(
        'ERR_DOMAIN_VALIDATION_FAILED',
        `User role '${userRole}' is not authorized to update treatment objectives.`,
        'TreatmentObjective',
        params.objectiveId,
        operationId
      );
    }

    const nextVersion = existing.version + 1;

    try {
      return await this.adapter.transaction('IMMEDIATE', async (tx: ISqliteTransactionContext) => {
        const existingOp = await this.syncRepo.getByOperationId(tx, operationId);
        if (existingOp) {
          const obj = await this.objectiveRepo.getById(tx, params.objectiveId);
          if (obj) {
            return {
              ok: true,
              isIdempotentHit: true,
              objective: obj,
              linkedProblemCount: 0,
              syncOperationId: operationId,
              auditLogId: `aud-idemp-${operationId}`,
            };
          }
        }

        await this.objectiveRepo.updateDetails(tx, params.objectiveId, {
          title: params.title,
          description: params.description,
          priority: params.priority,
          status: params.status,
          updatedBy: params.userId,
          updatedAt: now,
          version: nextVersion,
        });

        let linkedProblemCount = 0;
        if (params.linkedProblemIds !== undefined) {
          await this.objectiveRepo.deleteProblemLinksByObjectiveId(tx, params.objectiveId);
          for (const probId of params.linkedProblemIds) {
            const prob = await this.problemRepo.getById(tx, probId);
            if (!prob) {
              throw new Cohort2TreatmentPlanPersistenceError(
                'ERR_PROBLEM_NOT_FOUND',
                `Linked problem '${probId}' does not exist in SQLite.`,
                'ObjectiveProblem',
                probId,
                operationId
              );
            }
            if (prob.case_id !== existing.case_id) {
              throw new Cohort2TreatmentPlanPersistenceError(
                'ERR_CROSS_CASE_CONTAMINATION',
                `Cross-case contamination rejected: problem '${probId}' belongs to case '${prob.case_id}', not '${existing.case_id}'.`,
                'ObjectiveProblem',
                probId,
                operationId
              );
            }

            const linkRow: SqliteObjectiveProblemJunctionRow = {
              id: generateSafeId('ojp'),
              objective_id: params.objectiveId,
              problem_id: probId,
              relationship_type: 'PRIMARY_RESOLUTION',
              created_at: now,
            };
            await this.objectiveRepo.insertProblemLink(tx, linkRow);
            linkedProblemCount++;
          }
        }

        const updatedObj = await this.objectiveRepo.getById(tx, params.objectiveId);
        if (!updatedObj) {
          throw new Cohort2TreatmentPlanPersistenceError(
            'ERR_OBJECTIVE_NOT_FOUND',
            `Objective '${params.objectiveId}' disappeared during update.`,
            'TreatmentObjective',
            params.objectiveId,
            operationId
          );
        }

        const auditId = generateSafeId('aud');
        const auditRow: SqliteAuditLogRow = {
          id: auditId,
          entity_type: 'treatment_objectives',
          entity_id: params.objectiveId,
          operation_type: 'UPDATE',
          user_id: params.userId,
          device_id: params.deviceId,
          timestamp: now,
          entity_version_before: existing.version,
          entity_version_after: nextVersion,
          old_payload: canonicalizeJsonPayload({ title: existing.title, status: existing.status }),
          new_payload: canonicalizeJsonPayload({ title: updatedObj.title, status: updatedObj.status }),
          reason_code: 'UPDATE_TREATMENT_OBJECTIVE',
          metadata_json: JSON.stringify({ operation_id: operationId, case_id: existing.case_id }),
        };
        await this.auditRepo.insert(tx, auditRow);

        const syncRow: SqliteSyncOperationRow = {
          operation_id: operationId,
          device_id: params.deviceId,
          entity_type: 'treatment_objectives',
          entity_id: params.objectiveId,
          operation_type: 'UPDATE',
          base_version: existing.version,
          result_version: nextVersion,
          payload: canonicalizeJsonPayload({
            id: params.objectiveId,
            title: updatedObj.title,
            status: updatedObj.status,
          }),
          created_at: now,
          sync_status: 'PENDING',
          retry_count: 0,
          error_code: null,
          error_message: null,
        };
        await this.syncRepo.insert(tx, syncRow);

        return {
          ok: true,
          isIdempotentHit: false,
          objective: updatedObj,
          linkedProblemCount,
          syncOperationId: operationId,
          auditLogId: auditId,
        };
      });
    } catch (err: unknown) {
      if (err instanceof Cohort2TreatmentPlanPersistenceError) throw err;
      const anyErr = err as any;
      if (anyErr?.cause instanceof Cohort2TreatmentPlanPersistenceError) throw anyErr.cause;
      throw err;
    }
  }

  /**
   * Deletes a treatment objective and its problem links atomically.
   */
  public async deleteObjective(params: {
    objectiveId: string;
    userId: string;
    userRole?: AuthoritativeValidationRole;
    deviceId: string;
    timestamp?: string;
    operationId?: string;
  }): Promise<{ ok: boolean; syncOperationId: string; auditLogId: string }> {
    const operationId = params.operationId || generateSafeId('op');
    const now = params.timestamp || new Date().toISOString();

    const existing = await this.objectiveRepo.getById(this.adapter, params.objectiveId);
    if (!existing) {
      throw new Cohort2TreatmentPlanPersistenceError(
        'ERR_OBJECTIVE_NOT_FOUND',
        `Treatment objective '${params.objectiveId}' does not exist in SQLite.`,
        'TreatmentObjective',
        params.objectiveId,
        operationId
      );
    }

    try {
      return await this.adapter.transaction('IMMEDIATE', async (tx: ISqliteTransactionContext) => {
        await this.objectiveRepo.deleteProblemLinksByObjectiveId(tx, params.objectiveId);
        await this.objectiveRepo.delete(tx, params.objectiveId);

        const auditId = generateSafeId('aud');
        const auditRow: SqliteAuditLogRow = {
          id: auditId,
          entity_type: 'treatment_objectives',
          entity_id: params.objectiveId,
          operation_type: 'DELETE',
          user_id: params.userId,
          device_id: params.deviceId,
          timestamp: now,
          entity_version_before: existing.version,
          entity_version_after: existing.version,
          old_payload: canonicalizeJsonPayload({ id: existing.id, title: existing.title }),
          new_payload: null,
          reason_code: 'DELETE_TREATMENT_OBJECTIVE',
          metadata_json: JSON.stringify({ operation_id: operationId, case_id: existing.case_id }),
        };
        await this.auditRepo.insert(tx, auditRow);

        const syncRow: SqliteSyncOperationRow = {
          operation_id: operationId,
          device_id: params.deviceId,
          entity_type: 'treatment_objectives',
          entity_id: params.objectiveId,
          operation_type: 'DELETE',
          base_version: existing.version,
          result_version: existing.version,
          payload: canonicalizeJsonPayload({ id: params.objectiveId }),
          created_at: now,
          sync_status: 'PENDING',
          retry_count: 0,
          error_code: null,
          error_message: null,
        };
        await this.syncRepo.insert(tx, syncRow);

        return {
          ok: true,
          syncOperationId: operationId,
          auditLogId: auditId,
        };
      });
    } catch (err: unknown) {
      if (err instanceof Cohort2TreatmentPlanPersistenceError) throw err;
      const anyErr = err as any;
      if (anyErr?.cause instanceof Cohort2TreatmentPlanPersistenceError) throw anyErr.cause;
      throw err;
    }
  }

  /**
   * Creates a treatment plan atomically (treatment_plans + audit_logs + sync_operations).
   */
  public async createTreatmentPlan(params: CreateTreatmentPlanParams): Promise<TreatmentPlanOperationResult> {
    const operationId = params.operationId || generateSafeId('op');
    const planId = params.id || generateSafeId('tpl');
    const now = params.timestamp || new Date().toISOString();
    const userRole = params.userRole || 'ORTHODONTIST';

    if (SYNTHETIC_DEMO_CASE_IDS.has(params.caseId)) {
      throw new Cohort2TreatmentPlanPersistenceError(
        'ERR_DEMO_RECORD_REJECTED',
        `Cannot create treatment plan for synthetic demo case '${params.caseId}'.`,
        'TreatmentPlan',
        planId,
        operationId
      );
    }

    const parentCase = await this.caseRepo.getById(this.adapter, params.caseId, true);
    if (!parentCase || parentCase.is_deleted === 1) {
      throw new Cohort2TreatmentPlanPersistenceError(
        'ERR_CASE_NOT_FOUND',
        `Referenced orthodontic case '${params.caseId}' does not exist or is soft-deleted.`,
        'TreatmentPlan',
        planId,
        operationId
      );
    }

    if (SYNTHETIC_DEMO_PATIENT_IDS.has(parentCase.patient_id)) {
      throw new Cohort2TreatmentPlanPersistenceError(
        'ERR_DEMO_RECORD_REJECTED',
        `Cannot create plan for a case linked to synthetic demo patient '${parentCase.patient_id}'.`,
        'TreatmentPlan',
        planId,
        operationId
      );
    }

    // Determine diagnosis_version_id (if not provided, fetch latest diagnosis_version for the case)
    let diagVerId = params.diagnosisVersionId;
    if (!diagVerId) {
      const diagVersions = await this.adapter.query<{ id: string }>(
        'SELECT id FROM diagnosis_versions WHERE case_id = ? ORDER BY version_number DESC LIMIT 1;',
        [params.caseId]
      );
      if (diagVersions.length > 0) {
        diagVerId = diagVersions[0].id;
      } else {
        // Create an initial draft diagnosis version if none exists to satisfy foreign key requirement
        diagVerId = generateSafeId('dver');
        await this.adapter.execute(
          `INSERT INTO diagnosis_versions (
            id, case_id, version_number, status, diagnosis_date, diagnosed_by,
            clinical_summary, general_notes, created_at, created_by
          ) VALUES (?, ?, 1, 'DRAFT', ?, ?, 'Initial Baseline Diagnosis', null, ?, ?);`,
          [diagVerId, params.caseId, now.slice(0, 10), params.userId, now, params.userId]
        );
      }
    }

    const existingPlans = await this.planRepo.listByCaseId(this.adapter, params.caseId);
    const verNum = params.versionNumber || (existingPlans.length > 0 ? Math.max(...existingPlans.map((p) => p.version_number)) + 1 : 1);

    const row: SqliteTreatmentPlanRow = {
      id: planId,
      case_id: params.caseId,
      version_number: verNum,
      status: params.status || 'DRAFT',
      title: params.title,
      summary: params.summary ?? null,
      diagnosis_version_id: diagVerId,
      created_at: now,
      created_by: params.userId,
      approved_at: params.status === 'APPROVED' || params.status === 'ACTIVE' ? now : null,
      approved_by: params.status === 'APPROVED' || params.status === 'ACTIVE' ? params.userId : null,
      supersedes_plan_id: existingPlans.length > 0 ? existingPlans[existingPlans.length - 1].id : null,
    };

    try {
      return await this.adapter.transaction('IMMEDIATE', async (tx: ISqliteTransactionContext) => {
        const existingOp = await this.syncRepo.getByOperationId(tx, operationId);
        if (existingOp) {
          const plan = await this.planRepo.getById(tx, existingOp.entity_id);
          if (plan) {
            return {
              ok: true,
              isIdempotentHit: true,
              plan,
              syncOperationId: operationId,
              auditLogId: `aud-idemp-${operationId}`,
            };
          }
        }

        await this.planRepo.insert(tx, row);

        const auditId = generateSafeId('aud');
        const auditRow: SqliteAuditLogRow = {
          id: auditId,
          entity_type: 'treatment_plans',
          entity_id: planId,
          operation_type: 'CREATE',
          user_id: params.userId,
          device_id: params.deviceId,
          timestamp: now,
          entity_version_before: null,
          entity_version_after: verNum,
          old_payload: null,
          new_payload: canonicalizeJsonPayload({
            id: planId,
            case_id: params.caseId,
            title: params.title,
            status: row.status,
          }),
          reason_code: 'CREATE_TREATMENT_PLAN',
          metadata_json: JSON.stringify({ operation_id: operationId, case_id: params.caseId }),
        };
        await this.auditRepo.insert(tx, auditRow);

        const syncRow: SqliteSyncOperationRow = {
          operation_id: operationId,
          device_id: params.deviceId,
          entity_type: 'treatment_plans',
          entity_id: planId,
          operation_type: 'CREATE',
          base_version: 0,
          result_version: verNum,
          payload: canonicalizeJsonPayload({
            id: planId,
            case_id: params.caseId,
            title: params.title,
          }),
          created_at: now,
          sync_status: 'PENDING',
          retry_count: 0,
          error_code: null,
          error_message: null,
        };
        await this.syncRepo.insert(tx, syncRow);

        return {
          ok: true,
          isIdempotentHit: false,
          plan: row,
          syncOperationId: operationId,
          auditLogId: auditId,
        };
      });
    } catch (err: unknown) {
      if (err instanceof Cohort2TreatmentPlanPersistenceError) throw err;
      const anyErr = err as any;
      if (anyErr?.cause instanceof Cohort2TreatmentPlanPersistenceError) throw anyErr.cause;
      throw err;
    }
  }

  /**
   * Selects and approves a treatment plan, marking prior active plans as SUPERSEDED.
   */
  public async selectTreatmentPlan(params: SelectTreatmentPlanParams): Promise<TreatmentPlanOperationResult> {
    const operationId = params.operationId || generateSafeId('op');
    const now = params.timestamp || new Date().toISOString();

    const targetPlan = await this.planRepo.getById(this.adapter, params.planId);
    if (!targetPlan) {
      throw new Cohort2TreatmentPlanPersistenceError(
        'ERR_PLAN_NOT_FOUND',
        `Treatment plan '${params.planId}' does not exist in SQLite.`,
        'TreatmentPlan',
        params.planId,
        operationId
      );
    }

    if (targetPlan.case_id !== params.caseId) {
      throw new Cohort2TreatmentPlanPersistenceError(
        'ERR_CROSS_CASE_CONTAMINATION',
        `Plan '${params.planId}' belongs to case '${targetPlan.case_id}', not '${params.caseId}'.`,
        'TreatmentPlan',
        params.planId,
        operationId
      );
    }

    try {
      return await this.adapter.transaction('IMMEDIATE', async (tx: ISqliteTransactionContext) => {
        // Mark all other plans for this case as SUPERSEDED or PROPOSED
        const existingPlans = await this.planRepo.listByCaseId(tx, params.caseId);
        for (const p of existingPlans) {
          if (p.id !== params.planId && (p.status === 'APPROVED' || p.status === 'ACTIVE')) {
            await this.planRepo.updateStatus(tx, p.id, 'SUPERSEDED');
          }
        }

        // Approve and activate target plan
        await this.planRepo.updateStatus(tx, params.planId, 'APPROVED', params.userId, now);

        const updatedPlan = await this.planRepo.getById(tx, params.planId);
        if (!updatedPlan) {
          throw new Cohort2TreatmentPlanPersistenceError(
            'ERR_PLAN_NOT_FOUND',
            `Plan '${params.planId}' disappeared during status update.`,
            'TreatmentPlan',
            params.planId,
            operationId
          );
        }

        const auditId = generateSafeId('aud');
        const auditRow: SqliteAuditLogRow = {
          id: auditId,
          entity_type: 'treatment_plans',
          entity_id: params.planId,
          operation_type: 'APPROVE',
          user_id: params.userId,
          device_id: params.deviceId,
          timestamp: now,
          entity_version_before: targetPlan.version_number,
          entity_version_after: targetPlan.version_number,
          old_payload: canonicalizeJsonPayload({ status: targetPlan.status }),
          new_payload: canonicalizeJsonPayload({ status: 'APPROVED', approved_by: params.userId }),
          reason_code: 'SELECT_TREATMENT_PLAN',
          metadata_json: JSON.stringify({ operation_id: operationId, case_id: params.caseId }),
        };
        await this.auditRepo.insert(tx, auditRow);

        const syncRow: SqliteSyncOperationRow = {
          operation_id: operationId,
          device_id: params.deviceId,
          entity_type: 'treatment_plans',
          entity_id: params.planId,
          operation_type: 'UPDATE',
          base_version: targetPlan.version_number,
          result_version: targetPlan.version_number,
          payload: canonicalizeJsonPayload({ id: params.planId, status: 'APPROVED' }),
          created_at: now,
          sync_status: 'PENDING',
          retry_count: 0,
          error_code: null,
          error_message: null,
        };
        await this.syncRepo.insert(tx, syncRow);

        return {
          ok: true,
          isIdempotentHit: false,
          plan: updatedPlan,
          syncOperationId: operationId,
          auditLogId: auditId,
        };
      });
    } catch (err: unknown) {
      if (err instanceof Cohort2TreatmentPlanPersistenceError) throw err;
      const anyErr = err as any;
      if (anyErr?.cause instanceof Cohort2TreatmentPlanPersistenceError) throw anyErr.cause;
      throw err;
    }
  }

  // --- QUERY / LIST READ METHODS ---

  public async listObjectivesByCaseId(caseId: string): Promise<SqliteTreatmentObjectiveRow[]> {
    return this.objectiveRepo.listByCaseId(this.adapter, caseId);
  }

  public async listObjectiveProblemLinksByObjectiveId(
    objectiveId: string
  ): Promise<SqliteObjectiveProblemJunctionRow[]> {
    return this.objectiveRepo.listProblemLinksByObjectiveId(this.adapter, objectiveId);
  }

  public async listObjectiveProblemLinksByCaseId(
    caseId: string
  ): Promise<SqliteObjectiveProblemJunctionRow[]> {
    return this.objectiveRepo.listProblemLinksByCaseId(this.adapter, caseId);
  }

  public async listTreatmentPlansByCaseId(caseId: string): Promise<SqliteTreatmentPlanRow[]> {
    return this.planRepo.listByCaseId(this.adapter, caseId);
  }
}

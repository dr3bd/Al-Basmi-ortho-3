/**
 * AL-BASMI ORTH — COHORT 2 OUTCOMES & CLINICAL TIMELINE PERSISTENCE SERVICE
 * Scope: PHASE P3-I-R1 (Clinical Outcomes, Retention Monitoring & Timeline Stage Persistence)
 *
 * Baselines & Frozen Authorities:
 * - SCHEMA_FREEZE_v1.0 (src/domain/p0SqliteSchema.ts)
 * - PERSISTENCE_ADAPTER_CONTRACT_v1.0 (src/storage/types/storageAdapter.ts)
 * - P2A Domain Boundary Contract (src/domain/p2aDomainBoundaryContract.ts)
 * - P2C Domain Validation Engine (src/domain/p2cDomainValidationEngine.ts)
 *
 * Principles:
 * - Single authoritative persistence: Physical SQLite via ISqliteStorageAdapter.
 * - Atomic transactions (IMMEDIATE) for treatment_outcomes and case_status stage transitions.
 * - Mandatory parent verification: case_id and objective_id must exist and belong to the same case.
 * - Rejection of cross-case contamination (ERR_CROSS_CASE_CONTAMINATION).
 * - Rejection of invalid outcome stages (ERR_INVALID_OUTCOME_STAGE).
 * - Rejection of synthetic/demo case mutations (ERR_DEMO_RECORD_REJECTED).
 * - Audit logs (audit_logs) and sync outbox (sync_operations) recording for all mutations.
 * - Idempotency envelope support using operationId.
 * - Zero volatile memory/localStorage fallback in Clinical Mode.
 */

import {
  SqliteTreatmentOutcomeRow,
  SqliteOrthodonticCaseRow,
  SqliteTreatmentObjectiveRow,
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
import { SqliteCaseRepository } from './cohort2CasePersistenceService.ts';
import { SYNTHETIC_DEMO_CASE_IDS } from './cohort2ProblemDiagnosisPersistenceService.ts';
import { SqliteTreatmentObjectiveRepository } from './cohort2TreatmentPlanPersistenceService.ts';

function generateSafeId(prefix = ''): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 7);
  return prefix ? `${prefix}-${ts}-${rand}` : `${ts}-${rand}`;
}
import {
  DomainValidationEngine,
  AuthoritativeValidationRole,
} from '../../domain/p2cDomainValidationEngine.ts';

// ============================================================================
// 1. ERROR CODES & STRUCTURED ERROR CONTRACT
// ============================================================================

export type Cohort2OutcomeErrorCode =
  | 'ERR_OUTCOME_NOT_FOUND'
  | 'ERR_CASE_NOT_FOUND'
  | 'ERR_OBJECTIVE_NOT_FOUND'
  | 'ERR_CROSS_CASE_CONTAMINATION'
  | 'ERR_INVALID_OUTCOME_STAGE'
  | 'ERR_INVALID_STAGE_TRANSITION'
  | 'ERR_DEMO_RECORD_REJECTED'
  | 'ERR_DOMAIN_VALIDATION_FAILED'
  | 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH'
  | 'ERR_TRANSACTION_FAILED'
  | 'ERR_OUTCOME_CONSTRAINT_VIOLATION';

export class Cohort2OutcomePersistenceError extends Error {
  constructor(
    public readonly code: Cohort2OutcomeErrorCode,
    message: string,
    public readonly entityType = 'TreatmentOutcome',
    public readonly entityId?: string,
    public readonly operationId?: string
  ) {
    super(`[${code}] ${message}`);
    this.name = 'Cohort2OutcomePersistenceError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ============================================================================
// 2. PARAMETERS & RESULT INTERFACES
// ============================================================================

export const VALID_OUTCOME_STAGES = new Set([
  'T0',
  'T1',
  'T2',
  'T3',
  'T4',
  'RETENTION',
  'FOLLOW_UP',
]);

export const VALID_CASE_STATUSES = new Set([
  'CONSULTATION',
  'RECORDS',
  'DIAGNOSIS',
  'TREATMENT_PLANNING',
  'ACTIVE_TREATMENT',
  'FINISHING',
  'DEBOND',
  'RETENTION',
  'COMPLETED',
  'DISCONTINUED',
  'TRANSFERRED',
]);

export interface CreateOutcomeParams {
  id?: string;
  caseId: string;
  objectiveId: string;
  assessmentStage: SqliteTreatmentOutcomeRow['assessment_stage'];
  assessmentDate?: string;
  assessedBy?: string;
  status?: SqliteTreatmentOutcomeRow['status'];
  measurementValue?: string | null;
  measurementUnit?: string | null;
  clinicalAssessment?: string | null;
  evidenceSummary?: string | null;
  userId: string;
  userRole?: AuthoritativeValidationRole;
  deviceId: string;
  timestamp?: string;
  operationId?: string;
}

export interface UpdateOutcomeParams {
  id: string;
  caseId: string;
  assessmentStage?: SqliteTreatmentOutcomeRow['assessment_stage'];
  status?: SqliteTreatmentOutcomeRow['status'];
  measurementValue?: string | null;
  measurementUnit?: string | null;
  clinicalAssessment?: string | null;
  evidenceSummary?: string | null;
  userId: string;
  userRole?: AuthoritativeValidationRole;
  deviceId: string;
  timestamp?: string;
  operationId?: string;
}

export interface OutcomeOperationResult {
  ok: boolean;
  isIdempotentHit: boolean;
  outcome: SqliteTreatmentOutcomeRow;
  syncOperationId: string;
  auditLogId: string;
}

export interface TransitionCaseStageParams {
  caseId: string;
  targetStage: string; // 'T0'-'T4', 'RETENTION', or canonical case_status ('ACTIVE_TREATMENT', etc.)
  notes?: string | null;
  userId: string;
  userRole?: AuthoritativeValidationRole;
  deviceId: string;
  timestamp?: string;
  operationId?: string;
}

export interface StageTransitionResult {
  ok: boolean;
  isIdempotentHit: boolean;
  caseId: string;
  previousStage: string;
  newStage: string;
  version: number;
  syncOperationId: string;
  auditLogId: string;
}

export interface CaseTimelineMilestone {
  stage: string;
  timestamp: string;
  user_id: string;
  reason_code: string;
  metadata?: any;
}

// ============================================================================
// 3. REPOSITORIES
// ============================================================================

export class SqliteTreatmentOutcomeRepository {
  public async insert(
    executor: ISqliteExecutor,
    row: SqliteTreatmentOutcomeRow
  ): Promise<void> {
    await executor.execute(
      `INSERT INTO treatment_outcomes (
        id, case_id, objective_id, assessment_stage, assessment_date, assessed_by,
        status, measurement_value, measurement_unit, clinical_assessment, evidence_summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        row.id,
        row.case_id,
        row.objective_id,
        row.assessment_stage,
        row.assessment_date,
        row.assessed_by,
        row.status,
        row.measurement_value ?? null,
        row.measurement_unit ?? null,
        row.clinical_assessment ?? null,
        row.evidence_summary ?? null,
        row.created_at,
      ]
    );
  }

  public async update(
    executor: ISqliteExecutor,
    row: SqliteTreatmentOutcomeRow
  ): Promise<void> {
    await executor.execute(
      `UPDATE treatment_outcomes
       SET assessment_stage = ?, assessment_date = ?, status = ?, measurement_value = ?,
           measurement_unit = ?, clinical_assessment = ?, evidence_summary = ?
       WHERE id = ?;`,
      [
        row.assessment_stage,
        row.assessment_date,
        row.status,
        row.measurement_value ?? null,
        row.measurement_unit ?? null,
        row.clinical_assessment ?? null,
        row.evidence_summary ?? null,
        row.id,
      ]
    );
  }

  public async getById(
    executor: ISqliteExecutor,
    id: string
  ): Promise<SqliteTreatmentOutcomeRow | null> {
    return executor.queryOne<SqliteTreatmentOutcomeRow>(
      `SELECT * FROM treatment_outcomes WHERE id = ?;`,
      [id]
    );
  }

  public async listByCaseId(
    executor: ISqliteExecutor,
    caseId: string
  ): Promise<SqliteTreatmentOutcomeRow[]> {
    return executor.query<SqliteTreatmentOutcomeRow>(
      `SELECT * FROM treatment_outcomes WHERE case_id = ? ORDER BY assessment_date ASC, created_at ASC;`,
      [caseId]
    );
  }

  public async listByObjectiveId(
    executor: ISqliteExecutor,
    objectiveId: string
  ): Promise<SqliteTreatmentOutcomeRow[]> {
    return executor.query<SqliteTreatmentOutcomeRow>(
      `SELECT * FROM treatment_outcomes WHERE objective_id = ? ORDER BY assessment_date ASC, created_at ASC;`,
      [objectiveId]
    );
  }

  public async listByStage(
    executor: ISqliteExecutor,
    caseId: string,
    stage: string
  ): Promise<SqliteTreatmentOutcomeRow[]> {
    return executor.query<SqliteTreatmentOutcomeRow>(
      `SELECT * FROM treatment_outcomes WHERE case_id = ? AND assessment_stage = ? ORDER BY assessment_date ASC, created_at ASC;`,
      [caseId, stage]
    );
  }
}

// ============================================================================
// 4. COHORT 2 OUTCOMES & TIMELINE PERSISTENCE SERVICE
// ============================================================================

export class Cohort2OutcomeTimelinePersistenceService {
  private readonly outcomeRepo: SqliteTreatmentOutcomeRepository;
  private readonly caseRepo: SqliteCaseRepository;
  private readonly objectiveRepo: SqliteTreatmentObjectiveRepository;
  private readonly auditRepo: SqliteAuditLogRepository;
  private readonly syncRepo: SqliteSyncOperationRepository;

  constructor(private readonly adapter: ISqliteStorageAdapter) {
    this.outcomeRepo = new SqliteTreatmentOutcomeRepository();
    this.caseRepo = new SqliteCaseRepository();
    this.objectiveRepo = new SqliteTreatmentObjectiveRepository();
    this.auditRepo = new SqliteAuditLogRepository();
    this.syncRepo = new SqliteSyncOperationRepository();
  }

  /**
   * Helper: Maps timepoint codes ('T0'-'T4') or raw strings to canonical case_status.
   */
  public static mapStageToCaseStatus(stage: string): SqliteOrthodonticCaseRow['case_status'] {
    const s = stage.toUpperCase().trim();
    switch (s) {
      case 'T0':
        return 'DIAGNOSIS';
      case 'T1':
        return 'ACTIVE_TREATMENT';
      case 'T2':
        return 'RETENTION';
      case 'T3':
        return 'FINISHING';
      case 'T4':
        return 'COMPLETED';
      default:
        if (VALID_CASE_STATUSES.has(s)) return s as SqliteOrthodonticCaseRow['case_status'];
        return 'ACTIVE_TREATMENT';
    }
  }

  /**
   * Records a treatment outcome record atomically (treatment_outcomes + audit_logs + sync_operations).
   */
  public async recordOutcome(
    params: CreateOutcomeParams
  ): Promise<OutcomeOperationResult> {
    const operationId = params.operationId || generateSafeId('op');
    const outcomeId = params.id || generateSafeId('outc');
    const now = params.timestamp || new Date().toISOString();
    const userRole = params.userRole || 'ORTHODONTIST';

    // 1. Stage Code Validation
    if (!VALID_OUTCOME_STAGES.has(params.assessmentStage)) {
      throw new Cohort2OutcomePersistenceError(
        'ERR_INVALID_OUTCOME_STAGE',
        `Outcome assessment stage '${params.assessmentStage}' is not a valid frozen stage code. Must be one of: ${Array.from(VALID_OUTCOME_STAGES).join(', ')}.`,
        'TreatmentOutcome',
        outcomeId,
        operationId
      );
    }

    // 2. Synthetic Demo Case Check
    if (SYNTHETIC_DEMO_CASE_IDS.has(params.caseId)) {
      throw new Cohort2OutcomePersistenceError(
        'ERR_DEMO_RECORD_REJECTED',
        `Cannot record outcome for synthetic demo case '${params.caseId}'.`,
        'TreatmentOutcome',
        outcomeId,
        operationId
      );
    }

    // 3. Parent Case Check
    const parentCase = await this.caseRepo.getById(this.adapter, params.caseId, true);
    if (!parentCase || parentCase.is_deleted === 1) {
      throw new Cohort2OutcomePersistenceError(
        'ERR_CASE_NOT_FOUND',
        `Referenced case '${params.caseId}' does not exist or is soft-deleted.`,
        'TreatmentOutcome',
        outcomeId,
        operationId
      );
    }

    // 4. Parent Objective Check
    const parentObjective = await this.objectiveRepo.getById(this.adapter, params.objectiveId);
    if (!parentObjective) {
      throw new Cohort2OutcomePersistenceError(
        'ERR_OBJECTIVE_NOT_FOUND',
        `Referenced treatment objective '${params.objectiveId}' does not exist in SQLite.`,
        'TreatmentOutcome',
        outcomeId,
        operationId
      );
    }

    if (parentObjective.case_id !== params.caseId) {
      throw new Cohort2OutcomePersistenceError(
        'ERR_CROSS_CASE_CONTAMINATION',
        `Objective '${params.objectiveId}' belongs to case '${parentObjective.case_id}', not '${params.caseId}'.`,
        'TreatmentOutcome',
        outcomeId,
        operationId
      );
    }

    // 5. Domain Validation Engine
    const valResult = DomainValidationEngine.validate({
      context: {
        operation_id: operationId,
        command_id: 'RecordOutcome',
        user_id: params.userId,
        user_role: userRole,
        device_id: params.deviceId,
        patient_id: parentCase.patient_id,
        timestamp: now,
        mode: 'STRICT',
      },
      payload: {
        entityType: 'TreatmentOutcome',
        outcomeStage: params.assessmentStage,
        referencedEntities: [
          { label: 'Case', entityId: params.caseId, exists: true, caseId: params.caseId },
          { label: 'Objective', entityId: params.objectiveId, exists: true, caseId: parentObjective.case_id },
        ],
      },
    });

    if (!valResult.valid) {
      const errMsgs = valResult.errors.map((e) => `[${e.code}] ${e.message}`).join('; ');
      throw new Cohort2OutcomePersistenceError(
        'ERR_DOMAIN_VALIDATION_FAILED',
        `Domain validation rejected RecordOutcome: ${errMsgs}`,
        'TreatmentOutcome',
        outcomeId,
        operationId
      );
    }

    const row: SqliteTreatmentOutcomeRow = {
      id: outcomeId,
      case_id: params.caseId,
      objective_id: params.objectiveId,
      assessment_stage: params.assessmentStage,
      assessment_date: params.assessmentDate || now.slice(0, 10),
      assessed_by: params.assessedBy || params.userId,
      status: params.status || 'ACHIEVED',
      measurement_value: params.measurementValue ?? null,
      measurement_unit: params.measurementUnit ?? null,
      clinical_assessment: params.clinicalAssessment ?? null,
      evidence_summary: params.evidenceSummary ?? null,
      created_at: now,
    };

    try {
      return await this.adapter.transaction('IMMEDIATE', async (tx: ISqliteTransactionContext) => {
        // A. Idempotency Check
        const existingOp = await this.syncRepo.getByOperationId(tx, operationId);
        if (existingOp) {
          const targetPayload = canonicalizeJsonPayload({
            id: outcomeId,
            case_id: params.caseId,
            objective_id: params.objectiveId,
            assessment_stage: params.assessmentStage,
            status: row.status,
          });

          if (existingOp.payload !== targetPayload) {
            throw new Cohort2OutcomePersistenceError(
              'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH',
              `Operation ID '${operationId}' was already committed with a different payload.`,
              'TreatmentOutcome',
              existingOp.entity_id,
              operationId
            );
          }

          const existingOutcome = await this.outcomeRepo.getById(tx, existingOp.entity_id);
          if (existingOutcome) {
            return {
              ok: true,
              isIdempotentHit: true,
              outcome: existingOutcome,
              syncOperationId: operationId,
              auditLogId: `aud-idemp-${operationId}`,
            };
          }
        }

        // B. Insert Outcome
        await this.outcomeRepo.insert(tx, row);

        // C. Insert Audit Log
        const auditId = generateSafeId('aud');
        const auditRow: SqliteAuditLogRow = {
          id: auditId,
          entity_type: 'treatment_outcomes',
          entity_id: outcomeId,
          operation_type: 'CREATE',
          user_id: params.userId,
          device_id: params.deviceId,
          timestamp: now,
          entity_version_before: null,
          entity_version_after: 1,
          old_payload: null,
          new_payload: canonicalizeJsonPayload({
            id: outcomeId,
            case_id: params.caseId,
            objective_id: params.objectiveId,
            assessment_stage: params.assessmentStage,
            status: row.status,
          }),
          reason_code: 'RECORD_CLINICAL_OUTCOME',
          metadata_json: JSON.stringify({ operation_id: operationId, case_id: params.caseId }),
        };
        await this.auditRepo.insert(tx, auditRow);

        // D. Insert Sync Operations Outbox
        const syncRow: SqliteSyncOperationRow = {
          operation_id: operationId,
          device_id: params.deviceId,
          entity_type: 'treatment_outcomes',
          entity_id: outcomeId,
          operation_type: 'CREATE',
          base_version: 0,
          result_version: 1,
          payload: canonicalizeJsonPayload({
            id: outcomeId,
            case_id: params.caseId,
            objective_id: params.objectiveId,
            assessment_stage: params.assessmentStage,
            status: row.status,
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
          outcome: row,
          syncOperationId: operationId,
          auditLogId: auditId,
        };
      });
    } catch (err: unknown) {
      if (err instanceof Cohort2OutcomePersistenceError) throw err;
      const anyErr = err as any;
      if (anyErr?.cause instanceof Cohort2OutcomePersistenceError) throw anyErr.cause;
      throw err;
    }
  }

  /**
   * Updates an existing outcome record.
   */
  public async updateOutcome(
    params: UpdateOutcomeParams
  ): Promise<OutcomeOperationResult> {
    const operationId = params.operationId || generateSafeId('op');
    const now = params.timestamp || new Date().toISOString();

    const existing = await this.outcomeRepo.getById(this.adapter, params.id);
    if (!existing) {
      throw new Cohort2OutcomePersistenceError(
        'ERR_OUTCOME_NOT_FOUND',
        `Treatment outcome '${params.id}' does not exist in SQLite.`,
        'TreatmentOutcome',
        params.id,
        operationId
      );
    }

    if (existing.case_id !== params.caseId) {
      throw new Cohort2OutcomePersistenceError(
        'ERR_CROSS_CASE_CONTAMINATION',
        `Outcome '${params.id}' belongs to case '${existing.case_id}', not '${params.caseId}'.`,
        'TreatmentOutcome',
        params.id,
        operationId
      );
    }

    if (params.assessmentStage && !VALID_OUTCOME_STAGES.has(params.assessmentStage)) {
      throw new Cohort2OutcomePersistenceError(
        'ERR_INVALID_OUTCOME_STAGE',
        `Assessment stage '${params.assessmentStage}' is not valid.`,
        'TreatmentOutcome',
        params.id,
        operationId
      );
    }

    const updatedRow: SqliteTreatmentOutcomeRow = {
      ...existing,
      assessment_stage: params.assessmentStage || existing.assessment_stage,
      status: params.status || existing.status,
      measurement_value: params.measurementValue !== undefined ? params.measurementValue : existing.measurement_value,
      measurement_unit: params.measurementUnit !== undefined ? params.measurementUnit : existing.measurement_unit,
      clinical_assessment: params.clinicalAssessment !== undefined ? params.clinicalAssessment : existing.clinical_assessment,
      evidence_summary: params.evidenceSummary !== undefined ? params.evidenceSummary : existing.evidence_summary,
    };

    try {
      return await this.adapter.transaction('IMMEDIATE', async (tx: ISqliteTransactionContext) => {
        await this.outcomeRepo.update(tx, updatedRow);

        const auditId = generateSafeId('aud');
        const auditRow: SqliteAuditLogRow = {
          id: auditId,
          entity_type: 'treatment_outcomes',
          entity_id: params.id,
          operation_type: 'UPDATE',
          user_id: params.userId,
          device_id: params.deviceId,
          timestamp: now,
          entity_version_before: 1,
          entity_version_after: 2,
          old_payload: canonicalizeJsonPayload({ status: existing.status, assessment_stage: existing.assessment_stage }),
          new_payload: canonicalizeJsonPayload({ status: updatedRow.status, assessment_stage: updatedRow.assessment_stage }),
          reason_code: 'UPDATE_CLINICAL_OUTCOME',
          metadata_json: JSON.stringify({ operation_id: operationId, case_id: params.caseId }),
        };
        await this.auditRepo.insert(tx, auditRow);

        const syncRow: SqliteSyncOperationRow = {
          operation_id: operationId,
          device_id: params.deviceId,
          entity_type: 'treatment_outcomes',
          entity_id: params.id,
          operation_type: 'UPDATE',
          base_version: 1,
          result_version: 2,
          payload: canonicalizeJsonPayload({ id: params.id, status: updatedRow.status, assessment_stage: updatedRow.assessment_stage }),
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
          outcome: updatedRow,
          syncOperationId: operationId,
          auditLogId: auditId,
        };
      });
    } catch (err: unknown) {
      if (err instanceof Cohort2OutcomePersistenceError) throw err;
      const anyErr = err as any;
      if (anyErr?.cause instanceof Cohort2OutcomePersistenceError) throw anyErr.cause;
      throw err;
    }
  }

  /**
   * Executes a case stage transition atomically in orthodontic_cases with audit_logs + sync_operations.
   */
  public async transitionCaseStage(
    params: TransitionCaseStageParams
  ): Promise<StageTransitionResult> {
    const operationId = params.operationId || generateSafeId('op');
    const now = params.timestamp || new Date().toISOString();

    if (SYNTHETIC_DEMO_CASE_IDS.has(params.caseId)) {
      throw new Cohort2OutcomePersistenceError(
        'ERR_DEMO_RECORD_REJECTED',
        `Cannot transition stage for synthetic demo case '${params.caseId}'.`,
        'OrthodonticCase',
        params.caseId,
        operationId
      );
    }

    const parentCase = await this.caseRepo.getById(this.adapter, params.caseId, true);
    if (!parentCase || parentCase.is_deleted === 1) {
      throw new Cohort2OutcomePersistenceError(
        'ERR_CASE_NOT_FOUND',
        `Orthodontic case '${params.caseId}' does not exist in SQLite.`,
        'OrthodonticCase',
        params.caseId,
        operationId
      );
    }

    const canonicalStatus = Cohort2OutcomeTimelinePersistenceService.mapStageToCaseStatus(params.targetStage);
    const previousStatus = parentCase.case_status;

    try {
      return await this.adapter.transaction('IMMEDIATE', async (tx: ISqliteTransactionContext) => {
        // A. Idempotency envelope
        const existingOp = await this.syncRepo.getByOperationId(tx, operationId);
        if (existingOp) {
          const currentCase = await this.caseRepo.getById(tx, params.caseId);
          if (currentCase) {
            return {
              ok: true,
              isIdempotentHit: true,
              caseId: params.caseId,
              previousStage: previousStatus,
              newStage: currentCase.case_status,
              version: currentCase.version,
              syncOperationId: operationId,
              auditLogId: `aud-idemp-${operationId}`,
            };
          }
        }

        // B. Update Case Status & Version
        const newVersion = parentCase.version + 1;
        await tx.execute(
          `UPDATE orthodontic_cases
           SET case_status = ?, updated_at = ?, updated_by = ?, version = ?
           WHERE id = ?;`,
          [canonicalStatus, now, params.userId, newVersion, params.caseId]
        );

        // C. Audit Log Entry
        const auditId = generateSafeId('aud');
        const auditRow: SqliteAuditLogRow = {
          id: auditId,
          entity_type: 'orthodontic_cases',
          entity_id: params.caseId,
          operation_type: 'UPDATE',
          user_id: params.userId,
          device_id: params.deviceId,
          timestamp: now,
          entity_version_before: parentCase.version,
          entity_version_after: newVersion,
          old_payload: canonicalizeJsonPayload({ case_status: previousStatus }),
          new_payload: canonicalizeJsonPayload({ case_status: canonicalStatus, notes: params.notes ?? null }),
          reason_code: 'TRANSITION_CASE_STAGE',
          metadata_json: JSON.stringify({
            operation_id: operationId,
            previous_stage: previousStatus,
            new_stage: canonicalStatus,
            requested_stage: params.targetStage,
          }),
        };
        await this.auditRepo.insert(tx, auditRow);

        // D. Sync Outbox Entry
        const syncRow: SqliteSyncOperationRow = {
          operation_id: operationId,
          device_id: params.deviceId,
          entity_type: 'orthodontic_cases',
          entity_id: params.caseId,
          operation_type: 'UPDATE',
          base_version: parentCase.version,
          result_version: newVersion,
          payload: canonicalizeJsonPayload({
            id: params.caseId,
            case_status: canonicalStatus,
            version: newVersion,
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
          caseId: params.caseId,
          previousStage: previousStatus,
          newStage: canonicalStatus,
          version: newVersion,
          syncOperationId: operationId,
          auditLogId: auditId,
        };
      });
    } catch (err: unknown) {
      if (err instanceof Cohort2OutcomePersistenceError) throw err;
      const anyErr = err as any;
      if (anyErr?.cause instanceof Cohort2OutcomePersistenceError) throw anyErr.cause;
      throw err;
    }
  }

  // --- QUERY READ METHODS ---

  public async getOutcomeById(id: string): Promise<SqliteTreatmentOutcomeRow | null> {
    return this.outcomeRepo.getById(this.adapter, id);
  }

  public async listOutcomesByCaseId(caseId: string): Promise<SqliteTreatmentOutcomeRow[]> {
    return this.outcomeRepo.listByCaseId(this.adapter, caseId);
  }

  public async listOutcomesByObjectiveId(objectiveId: string): Promise<SqliteTreatmentOutcomeRow[]> {
    return this.outcomeRepo.listByObjectiveId(this.adapter, objectiveId);
  }

  public async listOutcomesByStage(caseId: string, stage: string): Promise<SqliteTreatmentOutcomeRow[]> {
    return this.outcomeRepo.listByStage(this.adapter, caseId, stage);
  }

  public async getCaseTimelineMilestones(caseId: string): Promise<CaseTimelineMilestone[]> {
    const audits = await this.adapter.query<SqliteAuditLogRow>(
      `SELECT * FROM audit_logs
       WHERE entity_id = ? OR (entity_type = 'orthodontic_cases' AND entity_id = ?)
       ORDER BY timestamp ASC;`,
      [caseId, caseId]
    );

    return audits.map((a) => {
      let meta: any = null;
      if (a.metadata_json) {
        try {
          meta = JSON.parse(a.metadata_json);
        } catch {
          meta = null;
        }
      }
      return {
        stage: meta?.new_stage || a.reason_code,
        timestamp: a.timestamp,
        user_id: a.user_id,
        reason_code: a.reason_code,
        metadata: meta,
      };
    });
  }
}

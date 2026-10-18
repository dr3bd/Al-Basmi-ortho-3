/**
 * AL-BASMI ORTH — COHORT 2 CEPHALOMETRIC PERSISTENCE SERVICE
 * Scope: PHASE P3-J/K-R1 (Cephalometric Studies, Landmarks, Measurements & Analysis Engine Integration)
 *
 * Baselines & Frozen Authorities:
 * - SCHEMA_FREEZE_v1.0 (src/domain/p0SqliteSchema.ts)
 * - PERSISTENCE_ADAPTER_CONTRACT_v1.0 (src/storage/types/storageAdapter.ts)
 * - P2A Domain Boundary Contract (src/domain/p2aDomainBoundaryContract.ts)
 * - P2C Domain Validation Engine (src/domain/p2cDomainValidationEngine.ts)
 *
 * Principles:
 * - Single authoritative persistence: Physical SQLite via ISqliteStorageAdapter.
 * - Atomic transactions (IMMEDIATE) for cephalometric_studies + landmarks + measurements.
 * - Mandatory parent verification: case_id must exist and be valid in SQLite.
 * - Rejection of synthetic/demo case mutations (ERR_DEMO_RECORD_REJECTED).
 * - Audit logs (audit_logs) and sync outbox (sync_operations) recording for all mutations.
 * - Idempotency envelope support using operationId.
 * - Deterministic calculation analysis read integration using CEPHALOMETRIC_DEFINITIONS.
 * - Zero volatile memory/localStorage fallback in Clinical Mode.
 */

import {
  SqliteCephalometricStudyRow,
  SqliteCephalometricLandmarkRow,
  SqliteCephalometricMeasurementRow,
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
import {
  DomainValidationEngine,
  AuthoritativeValidationRole,
} from '../../domain/p2cDomainValidationEngine.ts';
import {
  CEPHALOMETRIC_DEFINITIONS,
  evaluateCephalometricValue,
  CephDeviationEvaluation,
} from '../../domain/cephalometricEngine.ts';
import { TimepointStage } from '../../types/orthodontics.ts';

function generateSafeId(prefix = ''): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 7);
  return prefix ? `${prefix}-${ts}-${rand}` : `${ts}-${rand}`;
}

// ============================================================================
// 1. ERROR CODES & STRUCTURED ERROR CONTRACT
// ============================================================================

export type Cohort2CephErrorCode =
  | 'ERR_STUDY_NOT_FOUND'
  | 'ERR_CASE_NOT_FOUND'
  | 'ERR_CROSS_CASE_CONTAMINATION'
  | 'ERR_INVALID_STUDY_STAGE'
  | 'ERR_DEMO_RECORD_REJECTED'
  | 'ERR_DOMAIN_VALIDATION_FAILED'
  | 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH'
  | 'ERR_TRANSACTION_FAILED'
  | 'ERR_MISSING_REQUIRED_LANDMARKS';

export class Cohort2CephalometricPersistenceError extends Error {
  constructor(
    public readonly code: Cohort2CephErrorCode,
    message: string,
    public readonly entityType = 'CephalometricStudy',
    public readonly entityId?: string,
    public readonly operationId?: string
  ) {
    super(`[${code}] ${message}`);
    this.name = 'Cohort2CephalometricPersistenceError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ============================================================================
// 2. PARAMETERS & RESULT INTERFACES
// ============================================================================

export const VALID_STUDY_STAGES = new Set([
  'T0',
  'T1',
  'T2',
  'T3',
  'T4',
  'OTHER',
]);

export interface CreateCephStudyParams {
  id?: string;
  caseId: string;
  mediaId?: string | null;
  studyStage: SqliteCephalometricStudyRow['study_stage'];
  studyDate?: string;
  analysisStatus?: string;
  landmarkReviewStatus?: string;
  landmarks?: Array<{
    id?: string;
    landmarkCode: string;
    x: number;
    y: number;
    confidence?: number | null;
    source?: SqliteCephalometricLandmarkRow['source'];
    reviewStatus?: string;
  }>;
  measurements?: Array<{
    id?: string;
    analysisCode: string;
    measurementCode: string;
    value: number;
    unit?: string;
    referenceValue?: number | null;
    normalRange?: string | null;
    interpretation?: string | null;
  }>;
  userId: string;
  userRole?: AuthoritativeValidationRole;
  deviceId: string;
  timestamp?: string;
  operationId?: string;
}

export interface CephStudyOperationResult {
  ok: boolean;
  isIdempotentHit: boolean;
  study: SqliteCephalometricStudyRow;
  landmarksCount: number;
  measurementsCount: number;
  syncOperationId: string;
  auditLogId: string;
}

// ============================================================================
// 3. REPOSITORIES
// ============================================================================

export class SqliteCephalometricStudyRepository {
  public async insert(
    executor: ISqliteExecutor,
    row: SqliteCephalometricStudyRow
  ): Promise<void> {
    await executor.execute(
      `INSERT INTO cephalometric_studies (
        id, case_id, media_id, study_stage, study_date, analysis_status,
        landmark_review_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        row.id,
        row.case_id,
        row.media_id ?? null,
        row.study_stage,
        row.study_date,
        row.analysis_status,
        row.landmark_review_status,
        row.created_at,
        row.updated_at,
      ]
    );
  }

  public async getById(
    executor: ISqliteExecutor,
    id: string
  ): Promise<SqliteCephalometricStudyRow | null> {
    return executor.queryOne<SqliteCephalometricStudyRow>(
      `SELECT * FROM cephalometric_studies WHERE id = ?;`,
      [id]
    );
  }

  public async update(
    executor: ISqliteExecutor,
    row: SqliteCephalometricStudyRow
  ): Promise<void> {
    await executor.execute(
      `UPDATE cephalometric_studies SET
        media_id = ?,
        study_stage = ?,
        study_date = ?,
        analysis_status = ?,
        landmark_review_status = ?,
        updated_at = ?
      WHERE id = ?;`,
      [
        row.media_id ?? null,
        row.study_stage,
        row.study_date,
        row.analysis_status,
        row.landmark_review_status,
        row.updated_at,
        row.id,
      ]
    );
  }

  public async listByCaseId(
    executor: ISqliteExecutor,
    caseId: string
  ): Promise<SqliteCephalometricStudyRow[]> {
    return executor.query<SqliteCephalometricStudyRow>(
      `SELECT * FROM cephalometric_studies WHERE case_id = ? ORDER BY study_date ASC, created_at ASC;`,
      [caseId]
    );
  }
}

export class SqliteCephalometricLandmarkRepository {
  public async insertOrReplace(
    executor: ISqliteExecutor,
    row: SqliteCephalometricLandmarkRow
  ): Promise<void> {
    await executor.execute(
      `INSERT OR REPLACE INTO cephalometric_landmarks (
        id, study_id, landmark_code, x, y, confidence, source,
        review_status, corrected_by, corrected_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        row.id,
        row.study_id,
        row.landmark_code,
        row.x,
        row.y,
        row.confidence ?? null,
        row.source,
        row.review_status,
        row.corrected_by ?? null,
        row.corrected_at ?? null,
        row.created_at,
        row.updated_at,
      ]
    );
  }

  public async deleteByStudyId(
    executor: ISqliteExecutor,
    studyId: string
  ): Promise<void> {
    await executor.execute(
      `DELETE FROM cephalometric_landmarks WHERE study_id = ?;`,
      [studyId]
    );
  }

  public async listByStudyId(
    executor: ISqliteExecutor,
    studyId: string
  ): Promise<SqliteCephalometricLandmarkRow[]> {
    return executor.query<SqliteCephalometricLandmarkRow>(
      `SELECT * FROM cephalometric_landmarks WHERE study_id = ? ORDER BY landmark_code ASC;`,
      [studyId]
    );
  }
}

export class SqliteCephalometricMeasurementRepository {
  public async insertOrReplace(
    executor: ISqliteExecutor,
    row: SqliteCephalometricMeasurementRow
  ): Promise<void> {
    await executor.execute(
      `INSERT OR REPLACE INTO cephalometric_measurements (
        id, study_id, analysis_code, measurement_code, value, unit,
        reference_value, normal_range, interpretation, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        row.id,
        row.study_id,
        row.analysis_code,
        row.measurement_code,
        row.value,
        row.unit,
        row.reference_value ?? null,
        row.normal_range ?? null,
        row.interpretation ?? null,
        row.created_at,
      ]
    );
  }

  public async deleteByStudyId(
    executor: ISqliteExecutor,
    studyId: string
  ): Promise<void> {
    await executor.execute(
      `DELETE FROM cephalometric_measurements WHERE study_id = ?;`,
      [studyId]
    );
  }

  public async listByStudyId(
    executor: ISqliteExecutor,
    studyId: string
  ): Promise<SqliteCephalometricMeasurementRow[]> {
    return executor.query<SqliteCephalometricMeasurementRow>(
      `SELECT * FROM cephalometric_measurements WHERE study_id = ? ORDER BY measurement_code ASC;`,
      [studyId]
    );
  }
}

// ============================================================================
// 4. COHORT 2 CEPHALOMETRIC PERSISTENCE SERVICE
// ============================================================================

export class Cohort2CephalometricPersistenceService {
  private readonly studyRepo: SqliteCephalometricStudyRepository;
  private readonly landmarkRepo: SqliteCephalometricLandmarkRepository;
  private readonly measurementRepo: SqliteCephalometricMeasurementRepository;
  private readonly caseRepo: SqliteCaseRepository;
  private readonly auditRepo: SqliteAuditLogRepository;
  private readonly syncRepo: SqliteSyncOperationRepository;

  constructor(private readonly adapter: ISqliteStorageAdapter) {
    this.studyRepo = new SqliteCephalometricStudyRepository();
    this.landmarkRepo = new SqliteCephalometricLandmarkRepository();
    this.measurementRepo = new SqliteCephalometricMeasurementRepository();
    this.caseRepo = new SqliteCaseRepository();
    this.auditRepo = new SqliteAuditLogRepository();
    this.syncRepo = new SqliteSyncOperationRepository();
  }

  /**
   * Creates a cephalometric study with optional landmarks and measurements atomically.
   */
  public async createStudy(
    params: CreateCephStudyParams
  ): Promise<CephStudyOperationResult> {
    const operationId = params.operationId || generateSafeId('op');
    const studyId = params.id || generateSafeId('csth');
    const now = params.timestamp || new Date().toISOString();
    const userRole = params.userRole || 'ORTHODONTIST';

    // 1. Stage Code Validation
    if (!VALID_STUDY_STAGES.has(params.studyStage)) {
      throw new Cohort2CephalometricPersistenceError(
        'ERR_INVALID_STUDY_STAGE',
        `Cephalometric study stage '${params.studyStage}' is not a valid frozen stage code. Must be one of: ${Array.from(VALID_STUDY_STAGES).join(', ')}.`,
        'CephalometricStudy',
        studyId,
        operationId
      );
    }

    // 2. Synthetic Demo Case Check
    if (SYNTHETIC_DEMO_CASE_IDS.has(params.caseId)) {
      throw new Cohort2CephalometricPersistenceError(
        'ERR_DEMO_RECORD_REJECTED',
        `Cannot record cephalometric study for synthetic demo case '${params.caseId}'.`,
        'CephalometricStudy',
        studyId,
        operationId
      );
    }

    // 3. Parent Case Check
    const parentCase = await this.caseRepo.getById(this.adapter, params.caseId, true);
    if (!parentCase || parentCase.is_deleted === 1) {
      throw new Cohort2CephalometricPersistenceError(
        'ERR_CASE_NOT_FOUND',
        `Referenced case '${params.caseId}' does not exist or is soft-deleted.`,
        'CephalometricStudy',
        studyId,
        operationId
      );
    }

    // 4. Domain Validation Engine
    const valResult = DomainValidationEngine.validate({
      context: {
        operation_id: operationId,
        command_id: 'CreateCephalometricStudy',
        user_id: params.userId,
        user_role: userRole,
        device_id: params.deviceId,
        patient_id: parentCase.patient_id,
        timestamp: now,
        mode: 'STRICT',
      },
      payload: {
        entityType: 'CephalometricStudy',
        referencedEntities: [
          { label: 'Case', entityId: params.caseId, exists: true, caseId: params.caseId },
        ],
      },
    });

    if (!valResult.valid) {
      const errMsgs = valResult.errors.map((e) => `[${e.code}] ${e.message}`).join('; ');
      throw new Cohort2CephalometricPersistenceError(
        'ERR_DOMAIN_VALIDATION_FAILED',
        `Domain validation rejected CreateCephalometricStudy: ${errMsgs}`,
        'CephalometricStudy',
        studyId,
        operationId
      );
    }

    const row: SqliteCephalometricStudyRow = {
      id: studyId,
      case_id: params.caseId,
      media_id: params.mediaId ?? null,
      study_stage: params.studyStage,
      study_date: params.studyDate || now.slice(0, 10),
      analysis_status: params.analysisStatus || 'COMPLETED',
      landmark_review_status: params.landmarkReviewStatus || 'DOCTOR_APPROVED',
      created_at: now,
      updated_at: now,
    };

    try {
      return await this.adapter.transaction('IMMEDIATE', async (tx: ISqliteTransactionContext) => {
        // A. Idempotency Check
        const existingOp = await this.syncRepo.getByOperationId(tx, operationId);
        if (existingOp) {
          const targetPayload = canonicalizeJsonPayload({
            id: studyId,
            case_id: params.caseId,
            study_stage: params.studyStage,
            landmarks_count: (params.landmarks || []).length,
            measurements_count: (params.measurements || []).length,
          });

          if (existingOp.payload !== targetPayload) {
            throw new Cohort2CephalometricPersistenceError(
              'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH',
              `Operation ID '${operationId}' was already committed with a different payload.`,
              'CephalometricStudy',
              existingOp.entity_id,
              operationId
            );
          }

          const existingStudy = await this.studyRepo.getById(tx, existingOp.entity_id);
          if (existingStudy) {
            const existingLmCount = (await this.landmarkRepo.listByStudyId(tx, existingStudy.id)).length;
            const existingMeCount = (await this.measurementRepo.listByStudyId(tx, existingStudy.id)).length;
            return {
              ok: true,
              isIdempotentHit: true,
              study: existingStudy,
              landmarksCount: existingLmCount,
              measurementsCount: existingMeCount,
              syncOperationId: operationId,
              auditLogId: `aud-idemp-${operationId}`,
            };
          }
        }

        // B. Insert Study
        await this.studyRepo.insert(tx, row);

        // C. Insert Landmarks
        let lmCount = 0;
        if (params.landmarks && params.landmarks.length > 0) {
          for (const lm of params.landmarks) {
            const lmRow: SqliteCephalometricLandmarkRow = {
              id: lm.id || generateSafeId('clm'),
              study_id: studyId,
              landmark_code: lm.landmarkCode,
              x: lm.x,
              y: lm.y,
              confidence: lm.confidence ?? null,
              source: lm.source || 'MANUAL',
              review_status: lm.reviewStatus || 'APPROVED',
              corrected_by: params.userId,
              corrected_at: now,
              created_at: now,
              updated_at: now,
            };
            await this.landmarkRepo.insertOrReplace(tx, lmRow);
            lmCount++;
          }
        }

        // D. Insert Measurements
        let meCount = 0;
        if (params.measurements && params.measurements.length > 0) {
          for (const me of params.measurements) {
            const meRow: SqliteCephalometricMeasurementRow = {
              id: me.id || generateSafeId('cme'),
              study_id: studyId,
              analysis_code: me.analysisCode || 'STEINER',
              measurement_code: me.measurementCode,
              value: me.value,
              unit: me.unit || '°',
              reference_value: me.referenceValue ?? null,
              normal_range: me.normalRange ?? null,
              interpretation: me.interpretation ?? null,
              created_at: now,
            };
            await this.measurementRepo.insertOrReplace(tx, meRow);
            meCount++;
          }
        }

        // E. Insert Audit Log
        const auditId = generateSafeId('aud');
        const auditRow: SqliteAuditLogRow = {
          id: auditId,
          entity_type: 'cephalometric_studies',
          entity_id: studyId,
          operation_type: 'CREATE',
          user_id: params.userId,
          device_id: params.deviceId,
          timestamp: now,
          entity_version_before: null,
          entity_version_after: 1,
          old_payload: null,
          new_payload: canonicalizeJsonPayload({
            id: studyId,
            case_id: params.caseId,
            study_stage: params.studyStage,
            landmarks_count: lmCount,
            measurements_count: meCount,
          }),
          reason_code: 'RECORD_CEPHALOMETRIC_STUDY',
          metadata_json: JSON.stringify({ operation_id: operationId, case_id: params.caseId }),
        };
        await this.auditRepo.insert(tx, auditRow);

        // F. Insert Sync Operations Outbox
        const syncRow: SqliteSyncOperationRow = {
          operation_id: operationId,
          device_id: params.deviceId,
          entity_type: 'cephalometric_studies',
          entity_id: studyId,
          operation_type: 'CREATE',
          base_version: 0,
          result_version: 1,
          payload: canonicalizeJsonPayload({
            id: studyId,
            case_id: params.caseId,
            study_stage: params.studyStage,
            landmarks_count: lmCount,
            measurements_count: meCount,
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
          study: row,
          landmarksCount: lmCount,
          measurementsCount: meCount,
          syncOperationId: operationId,
          auditLogId: auditId,
        };
      });
    } catch (err: unknown) {
      if (err instanceof Cohort2CephalometricPersistenceError) throw err;
      const anyErr = err as any;
      if (anyErr?.cause instanceof Cohort2CephalometricPersistenceError) throw anyErr.cause;
      throw err;
    }
  }

  /**
   * Reads measurements for a study and evaluates them against CEPHALOMETRIC_DEFINITIONS.
   */
  public async evaluateAnalysisByStudyId(
    studyId: string
  ): Promise<CephDeviationEvaluation[]> {
    const study = await this.studyRepo.getById(this.adapter, studyId);
    if (!study) {
      throw new Cohort2CephalometricPersistenceError(
        'ERR_STUDY_NOT_FOUND',
        `Cephalometric study '${studyId}' does not exist in SQLite.`,
        'CephalometricStudy',
        studyId
      );
    }

    const measurements = await this.measurementRepo.listByStudyId(this.adapter, studyId);
    const results: CephDeviationEvaluation[] = [];

    const measMap = new Map<string, number>();
    for (const m of measurements) {
      measMap.set(m.measurement_code.toUpperCase(), m.value);
    }

    for (const def of CEPHALOMETRIC_DEFINITIONS) {
      const codeKey = def.code.toUpperCase();
      if (measMap.has(codeKey)) {
        const val = measMap.get(codeKey)!;
        results.push(evaluateCephalometricValue(def, val));
      }
    }

    return results;
  }

  // --- QUERY READ METHODS ---

  public async getStudyById(id: string): Promise<SqliteCephalometricStudyRow | null> {
    return this.studyRepo.getById(this.adapter, id);
  }

  public async listStudiesByCaseId(caseId: string): Promise<SqliteCephalometricStudyRow[]> {
    return this.studyRepo.listByCaseId(this.adapter, caseId);
  }

  public async listLandmarksByStudyId(studyId: string): Promise<SqliteCephalometricLandmarkRow[]> {
    return this.landmarkRepo.listByStudyId(this.adapter, studyId);
  }

  public async listMeasurementsByStudyId(studyId: string): Promise<SqliteCephalometricMeasurementRow[]> {
    return this.measurementRepo.listByStudyId(this.adapter, studyId);
  }

  /**
   * Creates a new cephalometric study or atomically updates an existing study,
   * replacing its landmarks and measurements without orphaned rows.
   */
  public async saveOrUpdateStudy(
    params: CreateCephStudyParams
  ): Promise<CephStudyOperationResult> {
    const operationId = params.operationId || generateSafeId('op');
    const now = params.timestamp || new Date().toISOString();
    const userRole = params.userRole || 'ORTHODONTIST';

    // 1. Stage Code Validation
    if (!VALID_STUDY_STAGES.has(params.studyStage)) {
      throw new Cohort2CephalometricPersistenceError(
        'ERR_INVALID_STUDY_STAGE',
        `Cephalometric study stage '${params.studyStage}' is not a valid frozen stage code. Must be one of: ${Array.from(VALID_STUDY_STAGES).join(', ')}.`,
        'CephalometricStudy',
        params.id,
        operationId
      );
    }

    // 2. Synthetic Demo Case Check
    if (SYNTHETIC_DEMO_CASE_IDS.has(params.caseId)) {
      throw new Cohort2CephalometricPersistenceError(
        'ERR_DEMO_RECORD_REJECTED',
        `Cannot record cephalometric study for synthetic demo case '${params.caseId}'.`,
        'CephalometricStudy',
        params.id,
        operationId
      );
    }

    // 3. Parent Case Check
    const parentCase = await this.caseRepo.getById(this.adapter, params.caseId, true);
    if (!parentCase || parentCase.is_deleted === 1) {
      throw new Cohort2CephalometricPersistenceError(
        'ERR_CASE_NOT_FOUND',
        `Referenced case '${params.caseId}' does not exist or is soft-deleted.`,
        'CephalometricStudy',
        params.id,
        operationId
      );
    }

    // 4. Determine if study exists (by ID or by caseId + studyStage)
    let existingStudy: SqliteCephalometricStudyRow | null = null;
    if (params.id) {
      existingStudy = await this.studyRepo.getById(this.adapter, params.id);
      if (existingStudy && existingStudy.case_id !== params.caseId) {
        throw new Cohort2CephalometricPersistenceError(
          'ERR_CROSS_CASE_CONTAMINATION',
          `Cephalometric study '${params.id}' belongs to case '${existingStudy.case_id}', not '${params.caseId}'.`,
          'CephalometricStudy',
          params.id,
          operationId
        );
      }
    }

    if (!existingStudy) {
      const caseStudies = await this.studyRepo.listByCaseId(this.adapter, params.caseId);
      const stageMatch = caseStudies.find((s) => s.study_stage === params.studyStage);
      if (stageMatch) {
        existingStudy = stageMatch;
      }
    }

    const isUpdate = existingStudy !== null;
    const studyId = existingStudy ? existingStudy.id : (params.id || generateSafeId('csth'));

    // 5. Domain Validation Engine
    const valResult = DomainValidationEngine.validate({
      context: {
        operation_id: operationId,
        command_id: 'CreateCephalometricStudy',
        user_id: params.userId,
        user_role: userRole,
        device_id: params.deviceId,
        patient_id: parentCase.patient_id,
        timestamp: now,
        mode: 'STRICT',
      },
      payload: {
        entityType: 'CephalometricStudy',
        referencedEntities: [
          { label: 'Case', entityId: params.caseId, exists: true, caseId: params.caseId },
        ],
      },
    });

    if (!valResult.valid) {
      const errMsgs = valResult.errors.map((e) => `[${e.code}] ${e.message}`).join('; ');
      throw new Cohort2CephalometricPersistenceError(
        'ERR_DOMAIN_VALIDATION_FAILED',
        `Domain validation rejected study operation: ${errMsgs}`,
        'CephalometricStudy',
        studyId,
        operationId
      );
    }

    const targetRow: SqliteCephalometricStudyRow = {
      id: studyId,
      case_id: params.caseId,
      media_id: params.mediaId !== undefined ? (params.mediaId ?? null) : (existingStudy?.media_id ?? null),
      study_stage: params.studyStage,
      study_date: params.studyDate || existingStudy?.study_date || now.slice(0, 10),
      analysis_status: params.analysisStatus || existingStudy?.analysis_status || 'COMPLETED',
      landmark_review_status: params.landmarkReviewStatus || existingStudy?.landmark_review_status || 'DOCTOR_APPROVED',
      created_at: existingStudy?.created_at || now,
      updated_at: now,
    };

    try {
      return await this.adapter.transaction('IMMEDIATE', async (tx: ISqliteTransactionContext) => {
        // A. Idempotency Check
        const existingOp = await this.syncRepo.getByOperationId(tx, operationId);
        if (existingOp) {
          const targetPayload = canonicalizeJsonPayload({
            id: studyId,
            case_id: params.caseId,
            study_stage: params.studyStage,
            landmarks_count: (params.landmarks || []).length,
            measurements_count: (params.measurements || []).length,
          });

          if (existingOp.payload !== targetPayload) {
            throw new Cohort2CephalometricPersistenceError(
              'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH',
              `Operation ID '${operationId}' was already committed with a different payload.`,
              'CephalometricStudy',
              existingOp.entity_id,
              operationId
            );
          }

          const persistedStudy = await this.studyRepo.getById(tx, existingOp.entity_id);
          if (persistedStudy) {
            const existingLmCount = (await this.landmarkRepo.listByStudyId(tx, persistedStudy.id)).length;
            const existingMeCount = (await this.measurementRepo.listByStudyId(tx, persistedStudy.id)).length;
            return {
              ok: true,
              isIdempotentHit: true,
              study: persistedStudy,
              landmarksCount: existingLmCount,
              measurementsCount: existingMeCount,
              syncOperationId: operationId,
              auditLogId: `aud-idemp-${operationId}`,
            };
          }
        }

        // B. Insert or Update Study
        if (isUpdate) {
          await this.studyRepo.update(tx, targetRow);
          // Clean replacement semantics for child records: delete previous landmarks and measurements
          await this.landmarkRepo.deleteByStudyId(tx, studyId);
          await this.measurementRepo.deleteByStudyId(tx, studyId);
        } else {
          await this.studyRepo.insert(tx, targetRow);
        }

        // C. Insert Landmarks
        let lmCount = 0;
        if (params.landmarks && params.landmarks.length > 0) {
          for (const lm of params.landmarks) {
            const lmRow: SqliteCephalometricLandmarkRow = {
              id: lm.id || generateSafeId('clm'),
              study_id: studyId,
              landmark_code: lm.landmarkCode,
              x: lm.x,
              y: lm.y,
              confidence: lm.confidence ?? null,
              source: lm.source || 'MANUAL',
              review_status: lm.reviewStatus || 'APPROVED',
              corrected_by: params.userId,
              corrected_at: now,
              created_at: now,
              updated_at: now,
            };
            await this.landmarkRepo.insertOrReplace(tx, lmRow);
            lmCount++;
          }
        }

        // D. Insert Measurements
        let meCount = 0;
        if (params.measurements && params.measurements.length > 0) {
          for (const me of params.measurements) {
            const meRow: SqliteCephalometricMeasurementRow = {
              id: me.id || generateSafeId('cme'),
              study_id: studyId,
              analysis_code: me.analysisCode || 'STEINER',
              measurement_code: me.measurementCode,
              value: me.value,
              unit: me.unit || '°',
              reference_value: me.referenceValue ?? null,
              normal_range: me.normalRange ?? null,
              interpretation: me.interpretation ?? null,
              created_at: now,
            };
            await this.measurementRepo.insertOrReplace(tx, meRow);
            meCount++;
          }
        }

        // E. Insert Audit Log
        const auditId = generateSafeId('aud');
        const auditRow: SqliteAuditLogRow = {
          id: auditId,
          entity_type: 'cephalometric_studies',
          entity_id: studyId,
          operation_type: isUpdate ? 'UPDATE' : 'CREATE',
          user_id: params.userId,
          device_id: params.deviceId,
          timestamp: now,
          entity_version_before: isUpdate ? 1 : null,
          entity_version_after: isUpdate ? 2 : 1,
          old_payload: isUpdate && existingStudy ? canonicalizeJsonPayload({
            id: existingStudy.id,
            case_id: existingStudy.case_id,
            study_stage: existingStudy.study_stage,
          }) : null,
          new_payload: canonicalizeJsonPayload({
            id: studyId,
            case_id: params.caseId,
            study_stage: params.studyStage,
            landmarks_count: lmCount,
            measurements_count: meCount,
          }),
          reason_code: isUpdate ? 'UPDATE_CEPHALOMETRIC_STUDY' : 'RECORD_CEPHALOMETRIC_STUDY',
          metadata_json: JSON.stringify({ operation_id: operationId, case_id: params.caseId, is_update: isUpdate }),
        };
        await this.auditRepo.insert(tx, auditRow);

        // F. Insert Sync Operations Outbox
        const syncRow: SqliteSyncOperationRow = {
          operation_id: operationId,
          device_id: params.deviceId,
          entity_type: 'cephalometric_studies',
          entity_id: studyId,
          operation_type: isUpdate ? 'UPDATE' : 'CREATE',
          base_version: isUpdate ? 1 : 0,
          result_version: isUpdate ? 2 : 1,
          payload: canonicalizeJsonPayload({
            id: studyId,
            case_id: params.caseId,
            study_stage: params.studyStage,
            landmarks_count: lmCount,
            measurements_count: meCount,
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
          study: targetRow,
          landmarksCount: lmCount,
          measurementsCount: meCount,
          syncOperationId: operationId,
          auditLogId: auditId,
        };
      });
    } catch (err: unknown) {
      if (err instanceof Cohort2CephalometricPersistenceError) throw err;
      const anyErr = err as any;
      if (anyErr?.cause instanceof Cohort2CephalometricPersistenceError) throw anyErr.cause;
      throw err;
    }
  }
}

export function timepointStageToStudyStage(
  stage: string
): SqliteCephalometricStudyRow['study_stage'] {
  if (stage === 'T0_Initial' || stage === 'T0') return 'T0';
  if (stage === 'T1_Progress' || stage === 'T1') return 'T1';
  if (stage === 'T2_PreFinishing' || stage === 'T2') return 'T2';
  if (stage === 'T3_Final' || stage === 'T3') return 'T3';
  if (stage === 'T4_Retention' || stage === 'T4') return 'T4';
  return 'OTHER';
}

export function studyStageToTimepointStage(stage: string): TimepointStage {
  if (stage === 'T0') return 'T0_Initial';
  if (stage === 'T1') return 'T1_Progress';
  if (stage === 'T2') return 'T2_PreFinishing';
  if (stage === 'T3') return 'T3_Final';
  if (stage === 'T4') return 'T4_Retention';
  return 'T0_Initial';
}

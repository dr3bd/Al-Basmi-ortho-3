/**
 * AL-BASMI ORTH — COHORT 2 MEDIA PERSISTENCE SERVICE
 * Scope: PHASE P3-J (Clinical Media & Radiographs SQLite & Blob Integration Vertical Slice)
 *
 * Baselines & Frozen Authorities:
 * - SCHEMA_FREEZE_v1.0 (src/domain/p0SqliteSchema.ts): media_assets (20 columns)
 * - PERSISTENCE_ADAPTER_CONTRACT_v1.0 (src/storage/types/storageAdapter.ts)
 * - P2A Domain Boundary Contract (src/domain/p2aDomainBoundaryContract.ts, Section 10: MediaDomain)
 * - P2D Repository Contract (src/domain/p2dRepositoryContract.ts, Section 3 RD-02 & Section 31: MediaRepository)
 *
 * Architecture Principles:
 * - Metadata SSOT: Physical SQLite via ISqliteStorageAdapter (table `media_assets`).
 * - Binary SSOT: Durable local file / Blob store via IBrowserMediaBlobStore (OPFS / IndexedDB).
 * - Two-phase staged commit: Staged binary write -> SQLite IMMEDIATE transaction (media_assets + audit + sync outbox) -> Binary promotion.
 * - Staged purge on failure: If SQLite fails, staged binary is automatically purged.
 * - Parent case & patient integrity: Target case and patient MUST exist in SQLite.
 * - Rejection of synthetic/demo patients/cases.
 * - Cross-case contamination protection: media_assets.case_id MUST match parent case.
 * - Controlled lifecycle: Soft-delete preserves binary and sets `is_deleted = 1` for clinical audit.
 */

import {
  SqliteMediaAssetRow,
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
import { SqliteCaseRepository, SYNTHETIC_DEMO_PATIENT_IDS } from './cohort2CasePersistenceService.ts';
import { SYNTHETIC_DEMO_CASE_IDS as BASE_DEMO_CASE_IDS } from './cohort2VisitPersistenceService.ts';
import { IBrowserMediaBlobStore } from './browserMediaBlobStore.ts';

export const SYNTHETIC_DEMO_CASE_IDS = new Set([
  ...BASE_DEMO_CASE_IDS,
  'ORT-2026-00104',
  'ORT-2026-00105',
]);

// ============================================================================
// 1. ERROR CODES & STRUCTURED ERROR CONTRACT
// ============================================================================

export type Cohort2MediaPersistenceErrorCode =
  | 'ERR_MEDIA_ASSET_NOT_FOUND'
  | 'ERR_CASE_NOT_FOUND'
  | 'ERR_PATIENT_NOT_FOUND'
  | 'ERR_DEMO_RECORD_REJECTED'
  | 'ERR_CROSS_CASE_CONTAMINATION'
  | 'ERR_PATIENT_CASE_MISMATCH'
  | 'ERR_BINARY_STORAGE_FAILED'
  | 'ERR_TRANSACTION_FAILED'
  | 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH'
  | 'ERR_CONSTRAINT_VIOLATION'
  | 'ERR_DUPLICATE_ID';

export class Cohort2MediaPersistenceError extends Error {
  constructor(
    public readonly code: Cohort2MediaPersistenceErrorCode,
    message: string,
    public readonly entityType = 'MediaAsset',
    public readonly entityId?: string,
    public readonly operationId?: string
  ) {
    super(`[${code}] ${message}`);
    this.name = 'Cohort2MediaPersistenceError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ============================================================================
// 2. CREATION & LIFECYCLE PARAMETERS
// ============================================================================

export interface CreateMediaAssetParams {
  id?: string;
  caseId: string;
  patientId: string;
  mediaType: 'PHOTO' | 'RADIOGRAPH' | 'CBCT';
  stage?: string; // e.g. 'T0_Initial'
  category: string; // e.g. 'Extraoral Frontal', 'Panoramic X-Ray'
  fileName: string;
  mimeType: string;
  binaryData: Uint8Array | Blob;
  captionEn?: string;
  captionAr?: string;
  svgType?: string;
  parentAssetId?: string;
  editingRecipe?: any;
  userId: string;
  userRole: 'ORTHODONTIST' | 'CLINICAL_ASSISTANT';
  deviceId: string;
  timestamp?: string;
  operationId?: string;
}

export interface SoftDeleteMediaAssetParams {
  assetId: string;
  caseId: string;
  userId: string;
  userRole: 'ORTHODONTIST' | 'CLINICAL_ASSISTANT';
  deviceId: string;
  timestamp?: string;
  operationId?: string;
  reason?: string;
}

export interface RestoreMediaAssetParams {
  assetId: string;
  caseId: string;
  userId: string;
  userRole: 'ORTHODONTIST' | 'CLINICAL_ASSISTANT';
  deviceId: string;
  timestamp?: string;
  operationId?: string;
}

export interface MediaAssetResult {
  mediaAsset: SqliteMediaAssetRow;
  auditId: string;
  syncOperationId: string;
  isIdempotentHit: boolean;
}

// ============================================================================
// 3. PHYSICAL SQLITE MEDIA ASSET REPOSITORY (MediaRepository)
// ============================================================================

export class SqliteMediaAssetRepository {
  public async getById(
    executor: ISqliteExecutor,
    id: string
  ): Promise<SqliteMediaAssetRow | null> {
    return executor.queryOne<SqliteMediaAssetRow>(
      'SELECT * FROM media_assets WHERE id = ?;',
      [id]
    );
  }

  public async getByIdForCase(
    executor: ISqliteExecutor,
    id: string,
    caseId: string
  ): Promise<SqliteMediaAssetRow | null> {
    return executor.queryOne<SqliteMediaAssetRow>(
      'SELECT * FROM media_assets WHERE id = ? AND case_id = ?;',
      [id, caseId]
    );
  }

  public async listByCaseId(
    executor: ISqliteExecutor,
    caseId: string,
    includeDeleted = false
  ): Promise<SqliteMediaAssetRow[]> {
    if (includeDeleted) {
      return executor.query<SqliteMediaAssetRow>(
        'SELECT * FROM media_assets WHERE case_id = ? ORDER BY captured_at DESC, created_at DESC;',
        [caseId]
      );
    }
    return executor.query<SqliteMediaAssetRow>(
      'SELECT * FROM media_assets WHERE case_id = ? AND is_deleted = 0 ORDER BY captured_at DESC, created_at DESC;',
      [caseId]
    );
  }

  public async listByCaseAndStage(
    executor: ISqliteExecutor,
    caseId: string,
    stage: string,
    includeDeleted = false
  ): Promise<SqliteMediaAssetRow[]> {
    const all = await this.listByCaseId(executor, caseId, includeDeleted);
    return all.filter((row) => {
      if (!row.metadata_json) return false;
      try {
        const parsed = JSON.parse(row.metadata_json);
        return parsed.stage === stage;
      } catch {
        return false;
      }
    });
  }

  public async insert(
    executor: ISqliteExecutor,
    row: SqliteMediaAssetRow
  ): Promise<void> {
    await executor.execute(
      `INSERT INTO media_assets (
        id, case_id, patient_id, media_type, captured_at, captured_by,
        file_name, mime_type, file_size, storage_provider, storage_path,
        thumbnail_path, upload_status, remote_id, checksum, metadata_json,
        created_at, updated_at, is_deleted, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        row.id,
        row.case_id,
        row.patient_id,
        row.media_type,
        row.captured_at,
        row.captured_by,
        row.file_name,
        row.mime_type,
        row.file_size,
        row.storage_provider,
        row.storage_path,
        row.thumbnail_path,
        row.upload_status,
        row.remote_id,
        row.checksum,
        row.metadata_json,
        row.created_at,
        row.updated_at,
        row.is_deleted,
        row.deleted_at,
      ]
    );
  }

  public async softDelete(
    executor: ISqliteExecutor,
    id: string,
    caseId: string,
    deletedAt: string
  ): Promise<number> {
    const res = await executor.execute(
      `UPDATE media_assets 
       SET is_deleted = 1, deleted_at = ?, updated_at = ?
       WHERE id = ? AND case_id = ? AND is_deleted = 0;`,
      [deletedAt, deletedAt, id, caseId]
    );
    return res.changes;
  }

  public async restore(
    executor: ISqliteExecutor,
    id: string,
    caseId: string,
    updatedAt: string
  ): Promise<number> {
    const res = await executor.execute(
      `UPDATE media_assets 
       SET is_deleted = 0, deleted_at = NULL, updated_at = ?
       WHERE id = ? AND case_id = ? AND is_deleted = 1;`,
      [updatedAt, id, caseId]
    );
    return res.changes;
  }
}

// ============================================================================
// 4. COHORT 2 MEDIA PERSISTENCE SERVICE
// ============================================================================

export class Cohort2MediaPersistenceService {
  private readonly _mediaRepo = new SqliteMediaAssetRepository();
  private readonly _caseRepo = new SqliteCaseRepository();
  private readonly _auditRepo = new SqliteAuditLogRepository();
  private readonly _syncRepo = new SqliteSyncOperationRepository();

  constructor(
    private readonly _adapter: ISqliteStorageAdapter,
    private readonly _blobStore: IBrowserMediaBlobStore
  ) {}

  public get mediaRepository(): SqliteMediaAssetRepository {
    return this._mediaRepo;
  }

  public get blobStore(): IBrowserMediaBlobStore {
    return this._blobStore;
  }

  /**
   * Stores a clinical media asset durably:
   * 1. Validates parent case & patient non-demo existence.
   * 2. Stages binary data in local blob store.
   * 3. Executes atomic SQLite transaction: media_assets + audit_logs + sync_operations.
   * 4. On commit, promotes staged binary to canonical path.
   * 5. On abort, purges staged binary.
   */
  public async storeMediaAsset(params: CreateMediaAssetParams): Promise<MediaAssetResult> {
    const nowIso = params.timestamp || new Date().toISOString();
    const assetId = params.id || `med-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const operationId = params.operationId || `op-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const auditId = `aud-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // Anti-demo guard
    if (SYNTHETIC_DEMO_CASE_IDS.has(params.caseId) || SYNTHETIC_DEMO_PATIENT_IDS.has(params.patientId)) {
      throw new Cohort2MediaPersistenceError(
        'ERR_DEMO_RECORD_REJECTED',
        `Cannot attach durable clinical media to synthetic demo case '${params.caseId}' or patient '${params.patientId}'.`,
        'MediaAsset',
        assetId,
        operationId
      );
    }

    // Verify parent case exists in SQLite
    const parentCase = await this._caseRepo.getById(this._adapter, params.caseId);
    if (!parentCase || parentCase.is_deleted === 1) {
      throw new Cohort2MediaPersistenceError(
        'ERR_CASE_NOT_FOUND',
        `Parent case '${params.caseId}' does not exist or is soft-deleted. Cannot store media.`,
        'MediaAsset',
        assetId,
        operationId
      );
    }

    // Verify patient match
    if (parentCase.patient_id !== params.patientId) {
      throw new Cohort2MediaPersistenceError(
        'ERR_PATIENT_CASE_MISMATCH',
        `Patient '${params.patientId}' does not match case '${params.caseId}' patient owner '${parentCase.patient_id}'.`,
        'MediaAsset',
        assetId,
        operationId
      );
    }

    // Check idempotency in sync_operations
    const existingOp = await this._syncRepo.getByOperationId(this._adapter, operationId);
    if (existingOp) {
      const existingMedia = await this._mediaRepo.getById(this._adapter, assetId);
      if (existingMedia) {
        // Verify whether the canonical binary exists
        const hasPermanent = await this._blobStore.hasBlob(existingMedia.storage_path);
        if (hasPermanent) {
          return {
            mediaAsset: existingMedia,
            auditId,
            syncOperationId: operationId,
            isIdempotentHit: true,
          };
        }

        // Canonical binary missing: Check if it is still in staging to resume promotion
        const hasStaged = await this._blobStore.hasBlob(`staging/${assetId}.bin`);
        if (hasStaged) {
          const promoted = await this._blobStore.promoteStagedBlob(assetId, existingMedia.case_id);
          if (promoted.storageProvider !== existingMedia.storage_provider) {
            await this._adapter.execute(
              'UPDATE media_assets SET storage_provider = ? WHERE id = ?;',
              [promoted.storageProvider, assetId]
            );
            existingMedia.storage_provider = promoted.storageProvider;
          }
          return {
            mediaAsset: existingMedia,
            auditId,
            syncOperationId: operationId,
            isIdempotentHit: true,
          };
        }

        // Neither permanent nor staged binary exists
        throw new Cohort2MediaPersistenceError(
          'ERR_BINARY_STORAGE_FAILED',
          `Idempotency hit for operation '${operationId}', but media binary is missing from both permanent path '${existingMedia.storage_path}' and staging. Upload must be repeated with valid binary data.`,
          'MediaAsset',
          assetId,
          operationId
        );
      }
    }

    // Phase 1: Stage binary bytes in local blob store (OPFS / IndexedDB)
    let staged;
    try {
      staged = await this._blobStore.stageBlob(assetId, params.binaryData, params.mimeType);
    } catch (err: unknown) {
      throw new Cohort2MediaPersistenceError(
        'ERR_BINARY_STORAGE_FAILED',
        `Failed to write binary data to local blob store: ${err instanceof Error ? err.message : String(err)}`,
        'MediaAsset',
        assetId,
        operationId
      );
    }

    const metadataPayload = {
      category: params.category,
      stage: params.stage || 'T0_Initial',
      captionEn: params.captionEn || '',
      captionAr: params.captionAr || '',
      svgType: params.svgType || 'photo_custom',
      parentAssetId: params.parentAssetId || undefined,
      editingRecipe: params.editingRecipe || undefined,
    };

    const mediaRow: SqliteMediaAssetRow = {
      id: assetId,
      case_id: params.caseId,
      patient_id: params.patientId,
      media_type: params.mediaType,
      captured_at: nowIso,
      captured_by: params.userId,
      file_name: params.fileName,
      mime_type: params.mimeType,
      file_size: staged.fileSize,
      storage_provider: 'LOCAL_FS', // Will be finalized after promotion
      storage_path: `media/${params.caseId}/${assetId}.bin`,
      thumbnail_path: null,
      upload_status: 'LOCAL_ONLY',
      remote_id: null,
      checksum: staged.checksum,
      metadata_json: JSON.stringify(metadataPayload),
      created_at: nowIso,
      updated_at: nowIso,
      is_deleted: 0,
      deleted_at: null,
    };

    // Phase 2: Atomic SQLite Transaction
    try {
      await this._adapter.transaction('IMMEDIATE', async (tx: ISqliteTransactionContext) => {
        // 1. Insert media_assets metadata
        await this._mediaRepo.insert(tx, mediaRow);

        // 2. Insert audit_logs entry
        const auditRow: SqliteAuditLogRow = {
          id: auditId,
          entity_type: 'MediaAsset',
          entity_id: assetId,
          operation_type: 'CREATE',
          user_id: params.userId,
          device_id: params.deviceId,
          timestamp: nowIso,
          entity_version_before: null,
          entity_version_after: 1,
          old_payload: null,
          new_payload: canonicalizeJsonPayload({
            id: assetId,
            case_id: params.caseId,
            category: params.category,
            stage: params.stage,
            checksum: staged.checksum,
            file_size: staged.fileSize,
          }),
          reason_code: 'CLINICAL_MEDIA_ATTACHED',
          metadata_json: JSON.stringify({
            category: params.category,
            stage: params.stage,
            fileName: params.fileName,
          }),
        };
        await this._auditRepo.insert(tx, auditRow);

        // 3. Insert sync_operations outbox
        const syncRow: SqliteSyncOperationRow = {
          operation_id: operationId,
          device_id: params.deviceId,
          entity_type: 'MediaAsset',
          entity_id: assetId,
          operation_type: 'CREATE',
          base_version: 0,
          result_version: 1,
          payload: canonicalizeJsonPayload(mediaRow),
          created_at: nowIso,
          sync_status: 'PENDING',
          retry_count: 0,
          error_code: null,
          error_message: null,
        };
        await this._syncRepo.insert(tx, syncRow);
      });
    } catch (txErr: unknown) {
      // Rollback compensation: Purge staged binary so no untracked file is left!
      await this._blobStore.purgeStagedBlob(assetId).catch(() => {});
      throw new Cohort2MediaPersistenceError(
        'ERR_TRANSACTION_FAILED',
        `SQLite transaction failed (staged binary purged): ${txErr instanceof Error ? txErr.message : String(txErr)}`,
        'MediaAsset',
        assetId,
        operationId
      );
    }

    // Phase 3: Promote staged binary to canonical storage
    try {
      const promoted = await this._blobStore.promoteStagedBlob(assetId, params.caseId);
      // Update storage_provider if OPFS or IDB_BLOB was used
      if (promoted.storageProvider !== 'LOCAL_FS') {
        mediaRow.storage_provider = promoted.storageProvider;
        await this._adapter.execute(
          'UPDATE media_assets SET storage_provider = ? WHERE id = ?;',
          [promoted.storageProvider, assetId]
        );
      }
    } catch (promoteErr) {
      // Promotion failed after SQLite commit! Do NOT claim success; return explicit error
      // Note: staged binary is preserved at staging/${assetId}.bin for recovery retry
      throw new Cohort2MediaPersistenceError(
        'ERR_BINARY_STORAGE_FAILED',
        `SQLite metadata committed, but binary promotion to canonical path failed: ${promoteErr instanceof Error ? promoteErr.message : String(promoteErr)}. Staged binary preserved at 'staging/${assetId}.bin' for recovery retry.`,
        'MediaAsset',
        assetId,
        operationId
      );
    }

    return {
      mediaAsset: mediaRow,
      auditId,
      syncOperationId: operationId,
      isIdempotentHit: false,
    };
  }

  /**
   * Soft-deletes a clinical media asset (sets is_deleted = 1).
   * Preserves binary for audit & clinical retention per Constitution Section 19.
   */
  public async softDeleteMediaAsset(params: SoftDeleteMediaAssetParams): Promise<void> {
    const nowIso = params.timestamp || new Date().toISOString();
    const operationId = params.operationId || `op-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const auditId = `aud-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const existing = await this._mediaRepo.getByIdForCase(this._adapter, params.assetId, params.caseId);
    if (!existing || existing.is_deleted === 1) {
      throw new Cohort2MediaPersistenceError(
        'ERR_MEDIA_ASSET_NOT_FOUND',
        `Media asset '${params.assetId}' not found for case '${params.caseId}' or already deleted.`,
        'MediaAsset',
        params.assetId,
        operationId
      );
    }

    await this._adapter.transaction('IMMEDIATE', async (tx: ISqliteTransactionContext) => {
      const changes = await this._mediaRepo.softDelete(tx, params.assetId, params.caseId, nowIso);
      if (changes === 0) {
        throw new Error(`Failed to soft delete media asset ${params.assetId}.`);
      }

      await this._auditRepo.insert(tx, {
        id: auditId,
        entity_type: 'MediaAsset',
        entity_id: params.assetId,
        operation_type: 'DELETE',
        user_id: params.userId,
        device_id: params.deviceId,
        timestamp: nowIso,
        entity_version_before: 1,
        entity_version_after: 2,
        old_payload: canonicalizeJsonPayload(existing),
        new_payload: null,
        reason_code: params.reason || 'CLINICAL_MEDIA_SOFT_DELETED',
        metadata_json: JSON.stringify({ caseId: params.caseId }),
      });

      await this._syncRepo.insert(tx, {
        operation_id: operationId,
        device_id: params.deviceId,
        entity_type: 'MediaAsset',
        entity_id: params.assetId,
        operation_type: 'DELETE',
        base_version: 1,
        result_version: 2,
        payload: canonicalizeJsonPayload({ id: params.assetId, is_deleted: 1, deleted_at: nowIso }),
        created_at: nowIso,
        sync_status: 'PENDING',
        retry_count: 0,
        error_code: null,
        error_message: null,
      });
    });
  }

  /**
   * Restores a soft-deleted media asset.
   */
  public async restoreMediaAsset(params: RestoreMediaAssetParams): Promise<void> {
    const nowIso = params.timestamp || new Date().toISOString();
    const operationId = params.operationId || `op-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const auditId = `aud-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const existing = await this._mediaRepo.getByIdForCase(this._adapter, params.assetId, params.caseId);
    if (!existing || existing.is_deleted === 0) {
      throw new Cohort2MediaPersistenceError(
        'ERR_MEDIA_ASSET_NOT_FOUND',
        `Media asset '${params.assetId}' not found or is not soft-deleted.`,
        'MediaAsset',
        params.assetId,
        operationId
      );
    }

    await this._adapter.transaction('IMMEDIATE', async (tx: ISqliteTransactionContext) => {
      const changes = await this._mediaRepo.restore(tx, params.assetId, params.caseId, nowIso);
      if (changes === 0) {
        throw new Error(`Failed to restore media asset ${params.assetId}.`);
      }

      await this._auditRepo.insert(tx, {
        id: auditId,
        entity_type: 'MediaAsset',
        entity_id: params.assetId,
        operation_type: 'RESTORE',
        user_id: params.userId,
        device_id: params.deviceId,
        timestamp: nowIso,
        entity_version_before: 2,
        entity_version_after: 3,
        old_payload: canonicalizeJsonPayload(existing),
        new_payload: canonicalizeJsonPayload({ ...existing, is_deleted: 0, deleted_at: null }),
        reason_code: 'CLINICAL_MEDIA_RESTORED',
        metadata_json: JSON.stringify({ caseId: params.caseId }),
      });

      await this._syncRepo.insert(tx, {
        operation_id: operationId,
        device_id: params.deviceId,
        entity_type: 'MediaAsset',
        entity_id: params.assetId,
        operation_type: 'RESTORE',
        base_version: 2,
        result_version: 3,
        payload: canonicalizeJsonPayload({ id: params.assetId, is_deleted: 0, deleted_at: null }),
        created_at: nowIso,
        sync_status: 'PENDING',
        retry_count: 0,
        error_code: null,
        error_message: null,
      });
    });
  }

  public async getMediaAssetById(assetId: string): Promise<SqliteMediaAssetRow | null> {
    return this._mediaRepo.getById(this._adapter, assetId);
  }

  public async listMediaAssetsByCaseId(caseId: string, includeDeleted = false): Promise<SqliteMediaAssetRow[]> {
    return this._mediaRepo.listByCaseId(this._adapter, caseId, includeDeleted);
  }

  public async listMediaAssetsByCaseAndStage(
    caseId: string,
    stage: string,
    includeDeleted = false
  ): Promise<SqliteMediaAssetRow[]> {
    return this._mediaRepo.listByCaseAndStage(this._adapter, caseId, stage, includeDeleted);
  }

  /**
   * Reconciles staged blobs at startup or on demand against SQLite media_assets:
   * 1. If metadata row was committed in SQLite:
   *    - If permanent binary is missing, promotes staged blob.
   *    - If permanent binary exists, purges stale staged blob.
   * 2. If no SQLite metadata row exists (aborted tx or interrupted upload):
   *    - Purges orphan staged blob.
   */
  public async reconcileStagedMedia(): Promise<{
    reconciledCount: number;
    purgedCount: number;
    errors: string[];
  }> {
    const stagedAssetIds = await this._blobStore.listStagedBlobs();
    let reconciledCount = 0;
    let purgedCount = 0;
    const errors: string[] = [];

    for (const assetId of stagedAssetIds) {
      try {
        const mediaRow = await this._mediaRepo.getById(this._adapter, assetId);
        if (mediaRow && mediaRow.is_deleted === 0) {
          const hasPermanent = await this._blobStore.hasBlob(mediaRow.storage_path);
          if (!hasPermanent) {
            const promoted = await this._blobStore.promoteStagedBlob(assetId, mediaRow.case_id);
            if (promoted.storageProvider !== mediaRow.storage_provider) {
              await this._adapter.execute(
                'UPDATE media_assets SET storage_provider = ? WHERE id = ?;',
                [promoted.storageProvider, assetId]
              );
              mediaRow.storage_provider = promoted.storageProvider;
            }
            reconciledCount++;
          } else {
            await this._blobStore.purgeStagedBlob(assetId);
            purgedCount++;
          }
        } else {
          // No active SQLite row exists for this staged file (aborted transaction or uncommitted upload)
          await this._blobStore.purgeStagedBlob(assetId);
          purgedCount++;
        }
      } catch (err: unknown) {
        errors.push(`Failed to reconcile asset ${assetId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { reconciledCount, purgedCount, errors };
  }

  /**
   * Retrieves a media asset with binary data and validates SHA-256 integrity.
   */
  public async getMediaAssetWithBinary(assetId: string): Promise<{
    mediaAsset: SqliteMediaAssetRow;
    blob: Blob;
  }> {
    const mediaRow = await this._mediaRepo.getById(this._adapter, assetId);
    if (!mediaRow) {
      throw new Cohort2MediaPersistenceError(
        'ERR_MEDIA_ASSET_NOT_FOUND',
        `Media asset '${assetId}' not found in SQLite.`,
        'MediaAsset',
        assetId
      );
    }

    const blob = await this._blobStore.getBlob(mediaRow.storage_path, mediaRow.checksum);
    if (!blob) {
      throw new Cohort2MediaPersistenceError(
        'ERR_BINARY_STORAGE_FAILED',
        `Authoritative binary for media asset '${assetId}' is missing at '${mediaRow.storage_path}'.`,
        'MediaAsset',
        assetId
      );
    }

    return { mediaAsset: mediaRow, blob };
  }
}


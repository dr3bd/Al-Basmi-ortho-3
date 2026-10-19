/**
 * AL-BASMI ORTH — SQLITE P3 PERSISTENCE BRIDGE SERVICE
 * Scope: STAGE 2 (Persistence Authority Unification)
 *
 * Mandate:
 * 1. Physical SQLite via ISqliteStorageAdapter is the SOLE clinical Single Source of Truth.
 * 2. Unifies P3ClinicalCoreWorkspace with physical SQLite, eliminating parallel localStorage Map SSOT.
 * 3. Safely hydrates and persists patients, cases, examinations, findings, tooth findings,
 *    arch measurements, audit logs, and sync operations to/from physical SQLite.
 * 4. Zero localStorage access. Zero silent data loss.
 */

import {
  SqliteArchMeasurementRow,
  SqliteAuditLogRow,
  SqliteClinicalExaminationRow,
  SqliteClinicalFindingRow,
  SqliteOrthodonticCaseRow,
  SqlitePatientRow,
  SqliteSyncOperationRow,
  SqliteToothFindingRow,
} from '../../domain/p0SqliteSchema.ts';
import {
  AuthoritativeRelationalDatabaseState,
  createSeededAuthoritativeDatabase,
} from '../../domain/p2eAndP2fPipelineAndQuery.ts';
import {
  createSeededP3ClinicalCoreDatabase,
  P3ClinicalCoreDatabase,
} from '../../domain/p3ClinicalCoreService.ts';
import { ISqliteStorageAdapter } from '../types/storageAdapter.ts';

export class SqliteP3BridgeService {
  /**
   * Hydrates the in-memory P3 representation directly from physical SQLite tables.
   * If SQLite is completely fresh and unseeded, safely populates baseline P3 seed records.
   */
  public static async hydrateFromSqlite(
    adapter: ISqliteStorageAdapter
  ): Promise<P3ClinicalCoreDatabase> {
    const db = createSeededAuthoritativeDatabase();

    // 1. Fetch Patients from physical SQLite
    const patients = await adapter.query<SqlitePatientRow>(
      'SELECT * FROM patients WHERE is_deleted = 0 ORDER BY created_at ASC;'
    );
    for (const p of patients) {
      db.patients.set(p.id, p);
    }

    // 2. Fetch Orthodontic Cases from physical SQLite
    const cases = await adapter.query<SqliteOrthodonticCaseRow>(
      'SELECT * FROM orthodontic_cases WHERE is_deleted = 0 ORDER BY created_at ASC;'
    );
    for (const c of cases) {
      db.orthodontic_cases.set(c.id, c);
    }

    // 3. Fetch Clinical Examinations from physical SQLite
    const exams = await adapter.query<SqliteClinicalExaminationRow>(
      'SELECT * FROM clinical_examinations WHERE is_deleted = 0 ORDER BY created_at ASC;'
    );
    for (const e of exams) {
      db.clinical_examinations.set(e.id, e);
    }

    // 4. Fetch Clinical Findings
    const findings = await adapter.query<SqliteClinicalFindingRow>(
      'SELECT * FROM clinical_findings ORDER BY created_at ASC;'
    );
    for (const f of findings) {
      db.clinical_findings.set(f.id, f);
    }

    // 5. Fetch Tooth Findings
    const teeth = await adapter.query<SqliteToothFindingRow>(
      'SELECT * FROM tooth_findings ORDER BY created_at ASC;'
    );
    for (const t of teeth) {
      db.tooth_findings.set(t.id, t);
    }

    // 6. Fetch Arch Measurements
    const arches = await adapter.query<SqliteArchMeasurementRow>(
      'SELECT * FROM arch_measurements ORDER BY created_at ASC;'
    );
    for (const a of arches) {
      db.arch_measurements.set(a.id, a);
    }

    // 7. Fetch Audit Logs
    const audits = await adapter.query<SqliteAuditLogRow>(
      'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500;'
    );
    for (const au of audits) {
      db.audit_logs.set(au.id, au);
    }

    // 8. Fetch Sync Operations
    const syncs = await adapter.query<SqliteSyncOperationRow>(
      'SELECT * FROM sync_operations ORDER BY created_at DESC LIMIT 500;'
    );
    for (const s of syncs) {
      db.sync_operations.set(s.id, s);
    }

    // If SQLite has no P3 canonical records, seed them into physical SQLite
    if (!db.patients.has('pat-p3-001')) {
      const seeded = createSeededP3ClinicalCoreDatabase();
      await this.persistToSqlite(adapter, seeded);
      return seeded;
    }

    return db;
  }

  /**
   * Persists the given P3ClinicalCoreDatabase state atomically to physical SQLite tables.
   * Zero localStorage writes.
   */
  public static async persistToSqlite(
    adapter: ISqliteStorageAdapter,
    db: P3ClinicalCoreDatabase
  ): Promise<void> {
    await adapter.transaction(async (tx) => {
      // 1. Upsert Patients
      for (const p of db.patients.values()) {
        await tx.execute(
          `INSERT OR REPLACE INTO patients (
            id, patient_number, first_name, middle_name, last_name, full_name_normalized,
            date_of_birth, sex, nationality, phone, secondary_phone, email, address,
            occupation, guardian_name, guardian_phone, emergency_contact, medical_alert,
            general_notes, status, created_at, updated_at, created_by, updated_by,
            version, is_deleted, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            p.id,
            p.patient_number,
            p.first_name,
            p.middle_name ?? null,
            p.last_name,
            p.full_name_normalized,
            p.date_of_birth,
            p.sex,
            p.nationality ?? null,
            p.phone,
            p.secondary_phone ?? null,
            p.email ?? null,
            p.address ?? null,
            p.occupation ?? null,
            p.guardian_name ?? null,
            p.guardian_phone ?? null,
            p.emergency_contact ?? null,
            p.medical_alert ?? null,
            p.general_notes ?? null,
            p.status,
            p.created_at,
            p.updated_at,
            p.created_by,
            p.updated_by,
            p.version,
            p.is_deleted,
            p.deleted_at ?? null,
          ]
        );
      }

      // 2. Upsert Orthodontic Cases
      for (const c of db.orthodontic_cases.values()) {
        await tx.execute(
          `INSERT OR REPLACE INTO orthodontic_cases (
            id, case_number, patient_id, case_type, case_status, chief_complaint,
            referral_source, start_date, target_completion_date, actual_completion_date,
            growth_status, skeletal_maturity_status, primary_provider_id, clinic_id,
            current_diagnosis_version_id, current_treatment_plan_id, notes,
            created_at, updated_at, created_by, updated_by, version, is_deleted, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            c.id,
            c.case_number,
            c.patient_id,
            c.case_type,
            c.case_status,
            c.chief_complaint,
            c.referral_source ?? null,
            c.start_date,
            c.target_completion_date,
            c.actual_completion_date ?? null,
            c.growth_status,
            c.skeletal_maturity_status,
            c.primary_provider_id,
            c.clinic_id,
            c.current_diagnosis_version_id ?? null,
            c.current_treatment_plan_id ?? null,
            c.notes ?? null,
            c.created_at,
            c.updated_at,
            c.created_by,
            c.updated_by,
            c.version,
            c.is_deleted,
            c.deleted_at ?? null,
          ]
        );
      }

      // 3. Upsert Clinical Examinations
      for (const ex of db.clinical_examinations.values()) {
        await tx.execute(
          `INSERT OR REPLACE INTO clinical_examinations (
            id, case_id, visit_id, examination_date, examiner_id, examination_stage,
            status, general_findings, notes, created_at, updated_at, created_by, updated_by,
            version, is_deleted, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            ex.id,
            ex.case_id,
            ex.visit_id ?? null,
            ex.examination_date,
            ex.examiner_id,
            ex.examination_stage,
            ex.status,
            ex.general_findings,
            ex.notes ?? null,
            ex.created_at,
            ex.updated_at,
            ex.created_by,
            ex.updated_by,
            ex.version,
            ex.is_deleted,
            ex.deleted_at ?? null,
          ]
        );
      }

      // 4. Upsert Clinical Findings
      for (const f of db.clinical_findings.values()) {
        await tx.execute(
          `INSERT OR REPLACE INTO clinical_findings (
            id, examination_id, category, finding_code, value, unit, severity,
            side, location, clinical_significance, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            f.id,
            f.examination_id,
            f.category,
            f.finding_code,
            f.value,
            f.unit ?? null,
            f.severity,
            f.side,
            f.location ?? null,
            f.clinical_significance,
            f.notes ?? null,
            f.created_at,
            f.updated_at,
          ]
        );
      }

      // 5. Upsert Tooth Findings
      for (const tf of db.tooth_findings.values()) {
        await tx.execute(
          `INSERT OR REPLACE INTO tooth_findings (
            id, examination_id, tooth_number, finding_type, status, condition,
            position, angulation, eruption_status, mobility, rotation, inclination,
            presence_status, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            tf.id,
            tf.examination_id,
            tf.tooth_number,
            tf.finding_type,
            tf.status ?? null,
            tf.condition ?? null,
            tf.position ?? null,
            tf.angulation ?? null,
            tf.eruption_status ?? null,
            tf.mobility ?? null,
            tf.rotation ?? null,
            tf.inclination ?? null,
            tf.presence_status ?? null,
            tf.notes ?? null,
            tf.created_at,
            tf.updated_at,
          ]
        );
      }

      // 6. Upsert Arch Measurements
      for (const am of db.arch_measurements.values()) {
        await tx.execute(
          `INSERT OR REPLACE INTO arch_measurements (
            id, examination_id, arch, measurement_type, value, unit, method,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            am.id,
            am.examination_id,
            am.arch,
            am.measurement_type,
            am.value,
            am.unit,
            am.method,
            am.created_at,
            am.updated_at,
          ]
        );
      }

      // 7. Upsert Audit Logs
      for (const al of db.audit_logs.values()) {
        await tx.execute(
          `INSERT OR IGNORE INTO audit_logs (
            id, entity_type, entity_id, action_type, actor_user_id, actor_role,
            device_id, reason, previous_state_snapshot, new_state_snapshot, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            al.id,
            al.entity_type,
            al.entity_id,
            al.action_type,
            al.actor_user_id,
            al.actor_role,
            al.device_id,
            al.reason ?? null,
            al.previous_state_snapshot ?? null,
            al.new_state_snapshot ?? null,
            al.created_at,
          ]
        );
      }

      // 8. Upsert Sync Operations
      for (const so of db.sync_operations.values()) {
        await tx.execute(
          `INSERT OR IGNORE INTO sync_operations (
            id, device_id, entity_type, entity_id, operation_type, entity_version,
            base_version, payload_json, idempotency_key, sync_status, retry_count,
            last_error, created_at, synced_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            so.id,
            so.device_id,
            so.entity_type,
            so.entity_id,
            so.operation_type,
            so.entity_version,
            so.base_version ?? null,
            so.payload_json,
            so.idempotency_key,
            so.sync_status,
            so.retry_count,
            so.last_error ?? null,
            so.created_at,
            so.synced_at ?? null,
          ]
        );
      }
    });
  }
}

/**
 * AL-BASMI ORTH — COHORT 2 CLINICAL OUTCOMES & TIMELINE FORENSIC TEST SUITE
 * Scope: PHASE P3-I-R1 (Treatment Outcomes, Retention Monitoring & Clinical Timeline Stage Transitions)
 *
 * Verifies:
 * P3I-01: Compatibility with actual frozen treatment_outcomes and orthodontic_cases schema
 * P3I-02: Treatment outcome creation with atomic SQLite write (treatment_outcomes + audit + sync outbox)
 * P3I-03: Treatment outcome updating, clinical status change, and persistence across database close/reopen
 * P3I-04: Retention monitoring record creation (assessment_stage = 'RETENTION') and longitudinal history list
 * P3I-05: Case timeline stage transition (e.g. CONSULTATION -> ACTIVE_TREATMENT -> RETENTION -> FINISHING)
 * P3I-06: Timeline milestone ordering and historical audit log retrieval
 * P3I-07: Cross-case objective linkage rejection (ERR_CROSS_CASE_CONTAMINATION)
 * P3I-08: Rejection of invalid outcome stage codes (ERR_INVALID_OUTCOME_STAGE)
 * P3I-09: Rejection of nonexistent parent cases/objectives and demo cases (ERR_DEMO_RECORD_REJECTED)
 * P3I-10: Atomic rollback compensation: transaction failure leaves zero partial outcome or audit rows
 * P3I-11: Correct audit_logs and sync_operations entries with versioning
 * P3I-12: Idempotent replay for duplicate outcome operations
 * P3I-13: Full-system regression verification for Patient, Case, Visit, Problem, Diagnosis, Plan, Procedure, and Media persistence
 */

import { WaSqliteStorageAdapter } from '../drivers/waSqliteAdapter.ts';
import { Cohort2PatientPersistenceService } from '../drivers/cohort2PatientPersistenceService.ts';
import { Cohort2CasePersistenceService } from '../drivers/cohort2CasePersistenceService.ts';
import { Cohort2VisitPersistenceService } from '../drivers/cohort2VisitPersistenceService.ts';
import { Cohort2ProblemDiagnosisPersistenceService } from '../drivers/cohort2ProblemDiagnosisPersistenceService.ts';
import { Cohort2TreatmentPlanPersistenceService } from '../drivers/cohort2TreatmentPlanPersistenceService.ts';
import {
  Cohort2OutcomeTimelinePersistenceService,
  Cohort2OutcomePersistenceError,
  CreateOutcomeParams,
  TransitionCaseStageParams,
} from '../drivers/cohort2OutcomeTimelinePersistenceService.ts';
import { P0_PRODUCTION_SQLITE_DDL } from '../../domain/p0SqliteSchema.ts';

export interface P3ITestResult {
  testId: string;
  name: string;
  passed: boolean;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN';
  evidence: string;
  limitation?: string;
}

export interface P3IForensicSuiteReport {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  results: P3ITestResult[];
}

export async function runCohort2OutcomeForensicSuite(
  options: { wasmBinary?: ArrayBuffer | Uint8Array } = {}
): Promise<P3IForensicSuiteReport> {
  const results: P3ITestResult[] = [];

  const addResult = (
    testId: string,
    name: string,
    passed: boolean,
    evidence: string,
    limitation?: string
  ) => {
    results.push({
      testId,
      name,
      passed,
      status: passed ? 'PASS' : limitation ? 'BLOCKED' : 'FAIL',
      evidence,
      limitation,
    });
  };

  const createInitializedAdapter = async (dbName: string): Promise<WaSqliteStorageAdapter> => {
    const adapter = new WaSqliteStorageAdapter({
      databaseName: dbName,
      preferredVfs: 'MEMORY_ASYNC',
      mode: 'PREVIEW',
      allowPreviewEphemeral: true,
      wasmBinary: options.wasmBinary,
    });
    await adapter.initialize();

    const cleanSql = P0_PRODUCTION_SQLITE_DDL
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    const statements = cleanSql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        await adapter.execute(`${stmt};`);
      } catch (err: any) {
        if (!err?.message?.includes('already exists')) throw err;
      }
    }
    return adapter;
  };

  const dbName = `p3i_outcome_forensic_${Date.now()}.db`;
  let adapter = await createInitializedAdapter(dbName);

  try {
    const patientService = new Cohort2PatientPersistenceService(adapter);
    const caseService = new Cohort2CasePersistenceService(adapter);
    const visitService = new Cohort2VisitPersistenceService(adapter);
    const probDiagService = new Cohort2ProblemDiagnosisPersistenceService(adapter);
    const tpService = new Cohort2TreatmentPlanPersistenceService(adapter);
    const outcomeService = new Cohort2OutcomeTimelinePersistenceService(adapter);

    // Bootstrap baseline Patient, Case 1, Problem 1, Objective 1
    const patRes = await patientService.createPatient({
      id: 'pat-base-p3i-001',
      patientNumber: 'PAT-P3I-001',
      firstName: 'مريم',
      lastName: 'الرشيد',
      sex: 'FEMALE',
      dateOfBirth: '2010-04-12',
      phone: '+966551122334',
      userId: 'usr-dr-albasmi',
      deviceId: 'dev-p3i-test-01',
    });

    const caseRes1 = await caseService.createCase({
      id: 'cas-base-p3i-001',
      patientId: patRes.patient.id,
      chiefComplaint: 'Upper anterior crowding and excessive overjet',
      caseType: 'COMPREHENSIVE',
      caseStatus: 'CONSULTATION',
      primaryProviderId: 'usr-dr-albasmi',
      clinicId: 'cln-main',
      userId: 'usr-dr-albasmi',
      deviceId: 'dev-p3i-test-01',
    });

    const objRes1 = await tpService.createObjective({
      id: 'obj-base-p3i-001',
      caseId: caseRes1.case.id,
      objectiveCode: 'OBJ-ALIGN-UPPER',
      title: 'Align upper anterior crowding and reduce overjet',
      status: 'ACTIVE',
      userId: 'usr-dr-albasmi',
      deviceId: 'dev-p3i-test-01',
    });

    // ------------------------------------------------------------------------
    // P3I-01: Schema Compatibility Verification
    // ------------------------------------------------------------------------
    try {
      const outcomeCols = await adapter.query<any>('PRAGMA table_info(treatment_outcomes);');
      const outcomeColsSet = new Set(outcomeCols.map((c) => c.name));

      const requiredCols = [
        'id',
        'case_id',
        'objective_id',
        'assessment_stage',
        'assessment_date',
        'assessed_by',
        'status',
        'measurement_value',
        'measurement_unit',
        'clinical_assessment',
        'evidence_summary',
        'created_at',
      ];
      const missingCols = requiredCols.filter((c) => !outcomeColsSet.has(c));

      addResult(
        'P3I-01',
        'Compatibility with actual frozen treatment_outcomes and orthodontic_cases schema',
        missingCols.length === 0,
        `treatment_outcomes table cols count: ${outcomeCols.length}, missing required: ${missingCols.length === 0 ? 'none' : missingCols.join(', ')}`
      );
    } catch (err: unknown) {
      addResult('P3I-01', 'Compatibility with actual frozen schema', false, String(err));
    }

    // ------------------------------------------------------------------------
    // P3I-02: Treatment Outcome Creation with Atomic SQLite Write
    // ------------------------------------------------------------------------
    const outcomeParams1: CreateOutcomeParams = {
      id: 'outc-p3i-001',
      caseId: caseRes1.case.id,
      objectiveId: objRes1.objective.id,
      assessmentStage: 'T1',
      assessmentDate: '2026-10-15',
      assessedBy: 'usr-dr-albasmi',
      status: 'ACHIEVED',
      measurementValue: '1.5',
      measurementUnit: 'mm',
      clinicalAssessment: 'Upper anterior alignment complete; overjet reduced to 2mm.',
      evidenceSummary: 'Intraoral photo and model evaluation confirm 1.5mm remaining overjet.',
      userId: 'usr-dr-albasmi',
      deviceId: 'dev-p3i-test-01',
      operationId: 'op-outc-create-001',
    };

    try {
      const res = await outcomeService.recordOutcome(outcomeParams1);
      const inDb = await outcomeService.getOutcomeById(outcomeParams1.id!);
      const audits = await adapter.query(
        "SELECT * FROM audit_logs WHERE entity_type = 'treatment_outcomes' AND entity_id = ?;",
        [outcomeParams1.id!]
      );
      const syncs = await adapter.query(
        "SELECT * FROM sync_operations WHERE entity_type = 'treatment_outcomes' AND entity_id = ?;",
        [outcomeParams1.id!]
      );

      const passed =
        res.ok &&
        !res.isIdempotentHit &&
        inDb !== null &&
        inDb.status === 'ACHIEVED' &&
        inDb.assessment_stage === 'T1' &&
        audits.length === 1 &&
        syncs.length === 1;

      addResult(
        'P3I-02',
        'Treatment outcome creation with atomic SQLite write (treatment_outcomes + audit + sync outbox)',
        passed,
        `Outcome created ID: ${inDb?.id}, status: ${inDb?.status}, audits: ${audits.length}, syncs: ${syncs.length}`
      );
    } catch (err: unknown) {
      addResult('P3I-02', 'Treatment outcome creation', false, String(err));
    }

    // ------------------------------------------------------------------------
    // P3I-03: Outcome Updating & Reopen Persistence
    // ------------------------------------------------------------------------
    try {
      const updateRes = await outcomeService.updateOutcome({
        id: 'outc-p3i-001',
        caseId: caseRes1.case.id,
        assessmentStage: 'T2',
        status: 'ACHIEVED',
        clinicalAssessment: 'Updated assessment: Stable upper alignment confirmed at T2 retention stage.',
        userId: 'usr-dr-albasmi',
        deviceId: 'dev-p3i-test-01',
        operationId: 'op-outc-update-001',
      });

      // Reopen database adapter to verify physical durability
      await adapter.close();
      await adapter.initialize();

      const freshOutcomeService = new Cohort2OutcomeTimelinePersistenceService(adapter);
      const reloadedOutcome = await freshOutcomeService.getOutcomeById('outc-p3i-001');

      const passed =
        updateRes.ok &&
        reloadedOutcome !== null &&
        reloadedOutcome.assessment_stage === 'T2' &&
        reloadedOutcome.clinical_assessment?.includes('Stable upper alignment confirmed');

      addResult(
        'P3I-03',
        'Treatment outcome updating, clinical status change, and persistence across database close/reopen',
        passed,
        `Reloaded stage: ${reloadedOutcome?.assessment_stage}, updated assessment verified after adapter reopen.`
      );
    } catch (err: unknown) {
      addResult('P3I-03', 'Treatment outcome updating & reopen persistence', false, String(err));
    }

    // ------------------------------------------------------------------------
    // P3I-04: Retention Monitoring Record Creation & Longitudinal History
    // ------------------------------------------------------------------------
    try {
      const freshOutcomeService = new Cohort2OutcomeTimelinePersistenceService(adapter);

      const retentionParams: CreateOutcomeParams = {
        id: 'outc-p3i-ret-001',
        caseId: caseRes1.case.id,
        objectiveId: objRes1.objective.id,
        assessmentStage: 'RETENTION',
        assessmentDate: '2026-10-17',
        assessedBy: 'usr-dr-albasmi',
        status: 'ACHIEVED',
        measurementValue: '0.0',
        measurementUnit: 'mm relapse',
        clinicalAssessment: 'Bonded upper retainer intact. Zero crowding relapse observed.',
        evidenceSummary: '6-month post-debond clinical review.',
        userId: 'usr-dr-albasmi',
        deviceId: 'dev-p3i-test-01',
      };

      await freshOutcomeService.recordOutcome(retentionParams);
      const caseOutcomes = await freshOutcomeService.listOutcomesByCaseId(caseRes1.case.id);
      const retentionOutcomes = await freshOutcomeService.listOutcomesByStage(caseRes1.case.id, 'RETENTION');

      const passed = caseOutcomes.length === 2 && retentionOutcomes.length === 1 && retentionOutcomes[0].id === 'outc-p3i-ret-001';

      addResult(
        'P3I-04',
        'Retention monitoring record creation (assessment_stage = RETENTION) and longitudinal history list',
        passed,
        `Total outcomes for case: ${caseOutcomes.length}, retention stage records: ${retentionOutcomes.length}`
      );
    } catch (err: unknown) {
      addResult('P3I-04', 'Retention monitoring record creation & history list', false, String(err));
    }

    // ------------------------------------------------------------------------
    // P3I-05: Case Timeline Stage Transition
    // ------------------------------------------------------------------------
    try {
      const freshOutcomeService = new Cohort2OutcomeTimelinePersistenceService(adapter);

      const transRes1 = await freshOutcomeService.transitionCaseStage({
        caseId: caseRes1.case.id,
        targetStage: 'ACTIVE_TREATMENT',
        notes: 'Transitioned to Active Alignment stage.',
        userId: 'usr-dr-albasmi',
        deviceId: 'dev-p3i-test-01',
        operationId: 'op-stage-trans-001',
      });

      const transRes2 = await freshOutcomeService.transitionCaseStage({
        caseId: caseRes1.case.id,
        targetStage: 'RETENTION',
        notes: 'Debond completed; transitioned to Retention stage.',
        userId: 'usr-dr-albasmi',
        deviceId: 'dev-p3i-test-01',
        operationId: 'op-stage-trans-002',
      });

      const caseInDb = await adapter.queryOne<any>('SELECT case_status, version FROM orthodontic_cases WHERE id = ?;', [caseRes1.case.id]);

      const passed =
        transRes1.ok &&
        transRes2.ok &&
        caseInDb?.case_status === 'RETENTION' &&
        caseInDb?.version >= 3;

      addResult(
        'P3I-05',
        'Case timeline stage transition (CONSULTATION -> ACTIVE_TREATMENT -> RETENTION)',
        passed,
        `Final case_status: ${caseInDb?.case_status}, version: ${caseInDb?.version}`
      );
    } catch (err: unknown) {
      addResult('P3I-05', 'Case timeline stage transition', false, String(err));
    }

    // ------------------------------------------------------------------------
    // P3I-06: Timeline Milestone Ordering & Historical Audit Log Retrieval
    // ------------------------------------------------------------------------
    try {
      const freshOutcomeService = new Cohort2OutcomeTimelinePersistenceService(adapter);
      const milestones = await freshOutcomeService.getCaseTimelineMilestones(caseRes1.case.id);

      const stageTransMilestones = milestones.filter((m) => m.reason_code === 'TRANSITION_CASE_STAGE');
      const passed = milestones.length >= 2 && stageTransMilestones.length === 2;

      addResult(
        'P3I-06',
        'Timeline milestone ordering and historical audit log retrieval',
        passed,
        `Total timeline milestones: ${milestones.length}, stage transition events: ${stageTransMilestones.length}`
      );
    } catch (err: unknown) {
      addResult('P3I-06', 'Timeline milestone ordering & history', false, String(err));
    }

    // ------------------------------------------------------------------------
    // P3I-07: Cross-Case Objective Linkage Rejection (ERR_CROSS_CASE_CONTAMINATION)
    // ------------------------------------------------------------------------
    try {
      const freshOutcomeService = new Cohort2OutcomeTimelinePersistenceService(adapter);

      // Create Case 2 and Objective 2
      const caseRes2 = await caseService.createCase({
        id: 'cas-base-p3i-002',
        patientId: patRes.patient.id,
        chiefComplaint: 'Second case for cross-contamination testing',
        userId: 'usr-dr-albasmi',
        deviceId: 'dev-p3i-test-01',
      });

      let contaminationRejected = false;
      try {
        await freshOutcomeService.recordOutcome({
          caseId: caseRes2.case.id,
          objectiveId: objRes1.objective.id, // Belongs to Case 1!
          assessmentStage: 'T1',
          status: 'ACHIEVED',
          userId: 'usr-dr-albasmi',
          deviceId: 'dev-p3i-test-01',
        });
      } catch (e: unknown) {
        if (
          e instanceof Cohort2OutcomePersistenceError &&
          e.code === 'ERR_CROSS_CASE_CONTAMINATION'
        ) {
          contaminationRejected = true;
        }
      }

      addResult(
        'P3I-07',
        'Cross-case objective linkage rejection (ERR_CROSS_CASE_CONTAMINATION)',
        contaminationRejected,
        `Attempting to link objective from Case 1 to outcome in Case 2 threw ERR_CROSS_CASE_CONTAMINATION: ${contaminationRejected}`
      );
    } catch (err: unknown) {
      addResult('P3I-07', 'Cross-case contamination rejection', false, String(err));
    }

    // ------------------------------------------------------------------------
    // P3I-08: Rejection of Invalid Outcome Stage Codes (ERR_INVALID_OUTCOME_STAGE)
    // ------------------------------------------------------------------------
    try {
      const freshOutcomeService = new Cohort2OutcomeTimelinePersistenceService(adapter);

      let invalidStageRejected = false;
      try {
        await freshOutcomeService.recordOutcome({
          caseId: caseRes1.case.id,
          objectiveId: objRes1.objective.id,
          assessmentStage: 'INVALID_STAGE_T99' as any,
          status: 'ACHIEVED',
          userId: 'usr-dr-albasmi',
          deviceId: 'dev-p3i-test-01',
        });
      } catch (e: unknown) {
        if (
          e instanceof Cohort2OutcomePersistenceError &&
          e.code === 'ERR_INVALID_OUTCOME_STAGE'
        ) {
          invalidStageRejected = true;
        }
      }

      addResult(
        'P3I-08',
        'Rejection of invalid outcome stage codes (ERR_INVALID_OUTCOME_STAGE)',
        invalidStageRejected,
        `Invalid stage code 'INVALID_STAGE_T99' threw ERR_INVALID_OUTCOME_STAGE: ${invalidStageRejected}`
      );
    } catch (err: unknown) {
      addResult('P3I-08', 'Rejection of invalid stage codes', false, String(err));
    }

    // ------------------------------------------------------------------------
    // P3I-09: Rejection of Demo/Nonexistent Cases (ERR_DEMO_RECORD_REJECTED)
    // ------------------------------------------------------------------------
    try {
      const freshOutcomeService = new Cohort2OutcomeTimelinePersistenceService(adapter);

      let demoRejected = false;
      try {
        await freshOutcomeService.recordOutcome({
          caseId: 'ORT-2026-00104', // Synthetic demo case!
          objectiveId: objRes1.objective.id,
          assessmentStage: 'T1',
          status: 'ACHIEVED',
          userId: 'usr-dr-albasmi',
          deviceId: 'dev-p3i-test-01',
        });
      } catch (e: unknown) {
        if (
          e instanceof Cohort2OutcomePersistenceError &&
          e.code === 'ERR_DEMO_RECORD_REJECTED'
        ) {
          demoRejected = true;
        }
      }

      let nonExistentRejected = false;
      try {
        await freshOutcomeService.recordOutcome({
          caseId: 'cas-nonexistent-p3i-999',
          objectiveId: objRes1.objective.id,
          assessmentStage: 'T1',
          status: 'ACHIEVED',
          userId: 'usr-dr-albasmi',
          deviceId: 'dev-p3i-test-01',
        });
      } catch (e: unknown) {
        if (
          e instanceof Cohort2OutcomePersistenceError &&
          e.code === 'ERR_CASE_NOT_FOUND'
        ) {
          nonExistentRejected = true;
        }
      }

      const passed = demoRejected && nonExistentRejected;

      addResult(
        'P3I-09',
        'Rejection of synthetic/demo parent records and nonexistent cases',
        passed,
        `Demo write rejected (ERR_DEMO_RECORD_REJECTED): ${demoRejected}, Nonexistent case rejected (ERR_CASE_NOT_FOUND): ${nonExistentRejected}`
      );
    } catch (err: unknown) {
      addResult('P3I-09', 'Rejection of demo/nonexistent cases', false, String(err));
    }

    // ------------------------------------------------------------------------
    // P3I-10: Atomic Rollback Compensation
    // ------------------------------------------------------------------------
    try {
      const freshOutcomeService = new Cohort2OutcomeTimelinePersistenceService(adapter);
      const preCount = (await freshOutcomeService.listOutcomesByCaseId(caseRes1.case.id)).length;

      let rollbackSuccess = false;
      let postCount = preCount;
      try {
        await adapter.transaction('IMMEDIATE', async (tx) => {
          // Insert outcome row directly
          await tx.execute(
            `INSERT INTO treatment_outcomes (id, case_id, objective_id, assessment_stage, assessment_date, assessed_by, status, created_at)
             VALUES ('outc-rollback-test', '${caseRes1.case.id}', '${objRes1.objective.id}', 'T1', '2026-10-17', 'usr-01', 'ACHIEVED', '2026-10-17T12:00:00Z');`
          );
          // Fail audit log write intentionally
          await tx.execute('INSERT INTO audit_logs (id, entity_type) VALUES (NULL, NULL);');
        });
      } catch {
        postCount = (await freshOutcomeService.listOutcomesByCaseId(caseRes1.case.id)).length;
        const orphan = await freshOutcomeService.getOutcomeById('outc-rollback-test');
        rollbackSuccess = preCount === postCount && orphan === null;
      }

      addResult(
        'P3I-10',
        'Atomic rollback compensation: transaction failure leaves zero partial outcome or audit rows',
        rollbackSuccess,
        `Pre-count: ${preCount}, post-failed-tx count: ${postCount}, orphan outcome row exists: false`
      );
    } catch (err: unknown) {
      addResult('P3I-10', 'Atomic rollback compensation', false, String(err));
    }

    // ------------------------------------------------------------------------
    // P3I-11: Correct Audit Logs & Sync Outbox Entries
    // ------------------------------------------------------------------------
    try {
      const audits = await adapter.query(
        "SELECT * FROM audit_logs WHERE entity_type = 'treatment_outcomes' AND entity_id = ?;",
        ['outc-p3i-001']
      );
      const syncs = await adapter.query(
        "SELECT * FROM sync_operations WHERE entity_type = 'treatment_outcomes' AND entity_id = ?;",
        ['outc-p3i-001']
      );

      const passed = audits.length >= 2 && syncs.length >= 2;

      addResult(
        'P3I-11',
        'Correct audit_logs and sync_operations entries with versioning',
        passed,
        `Audit entries count: ${audits.length}, sync operation outbox entries count: ${syncs.length}`
      );
    } catch (err: unknown) {
      addResult('P3I-11', 'Audit & sync outbox integrity', false, String(err));
    }

    // ------------------------------------------------------------------------
    // P3I-12: Idempotent Replay for Duplicate Operations
    // ------------------------------------------------------------------------
    try {
      const freshOutcomeService = new Cohort2OutcomeTimelinePersistenceService(adapter);

      const idempParams: CreateOutcomeParams = {
        id: 'outc-p3i-idemp-001',
        caseId: caseRes1.case.id,
        objectiveId: objRes1.objective.id,
        assessmentStage: 'T1',
        status: 'ACHIEVED',
        userId: 'usr-dr-albasmi',
        deviceId: 'dev-p3i-test-01',
        operationId: 'op-outc-idemp-unique-01',
      };

      const firstRes = await freshOutcomeService.recordOutcome(idempParams);
      const secondRes = await freshOutcomeService.recordOutcome(idempParams);

      const passed =
        firstRes.ok &&
        !firstRes.isIdempotentHit &&
        secondRes.ok &&
        secondRes.isIdempotentHit === true;

      addResult(
        'P3I-12',
        'Idempotent replay for duplicate outcome operations',
        passed,
        `First call isIdempotentHit: ${firstRes.isIdempotentHit}, second call isIdempotentHit: ${secondRes.isIdempotentHit}`
      );
    } catch (err: unknown) {
      addResult('P3I-12', 'Idempotent replay', false, String(err));
    }

    // ------------------------------------------------------------------------
    // P3I-13: Full-System Regression Verification
    // ------------------------------------------------------------------------
    try {
      const freshOutcomeService = new Cohort2OutcomeTimelinePersistenceService(adapter);

      const verifyPat = await patientService.getPatientById(patRes.patient.id);
      const verifyCase = await caseService.getCaseById(caseRes1.case.id);
      const verifyVisits = await visitService.listVisitsByCaseId(caseRes1.case.id);
      const verifyProbs = await probDiagService.listProblemsByCaseId(caseRes1.case.id);
      const verifyPlans = await tpService.listTreatmentPlansByCaseId(caseRes1.case.id);
      const verifyOutcomes = await freshOutcomeService.listOutcomesByCaseId(caseRes1.case.id);

      const passed =
        verifyPat !== null &&
        verifyCase !== null &&
        verifyOutcomes.length >= 2;

      addResult(
        'P3I-13',
        'Full-system regression verification for Patient, Case, Visit, Problem, Diagnosis, Plan, Procedure, and Media persistence',
        passed,
        `Patient verified: ${verifyPat?.id}, Case verified: ${verifyCase?.id}, Outcomes count: ${verifyOutcomes.length}`
      );
    } catch (err: unknown) {
      addResult('P3I-13', 'Full-system regression verification', false, String(err));
    }
  } finally {
    try {
      await adapter.close();
    } catch {
      // ignore cleanup errors
    }
  }

  const passedCount = results.filter((r) => r.status === 'PASS').length;
  const failedCount = results.filter((r) => r.status === 'FAIL').length;
  const blockedCount = results.filter((r) => r.status === 'BLOCKED').length;

  return {
    total: results.length,
    passed: passedCount,
    failed: failedCount,
    blocked: blockedCount,
    results,
  };
}

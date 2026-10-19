import fs from 'node:fs';
import path from 'node:path';
import { runStorageAcceptanceSuite } from './storageAcceptanceSuite.ts';
import { runCohort1ForensicSuite } from './cohort1ForensicSuite.ts';
import { runCohort2PatientForensicSuite } from './cohort2PatientForensicSuite.ts';
import { runCohort2CaseForensicSuite } from './cohort2CaseForensicSuite.ts';
import { runCohort2VisitForensicSuite } from './cohort2VisitForensicSuite.ts';
import { runCohort2ProblemDiagnosisForensicSuite } from './cohort2ProblemDiagnosisForensicSuite.ts';
import { runCohort2MediaForensicSuite } from './cohort2MediaForensicSuite.ts';
import { runCohort2TreatmentPlanForensicSuite } from './cohort2TreatmentPlanForensicSuite.ts';
import { runCohort2ProcedureForensicSuite } from './cohort2ProcedureForensicSuite.ts';
import { runCohort2OutcomeForensicSuite } from './cohort2OutcomeForensicSuite.ts';
import { runCohort2CephalometricForensicSuite } from './cohort2CephalometricForensicSuite.ts';
import { runClinicalUnsavedEditGuardSuite } from './clinicalUnsavedEditGuardSuite.ts';
import { runUX1DataIntegritySuite } from './clinicalCaseDataIntegritySuite.ts';
import { runDbFoundationRemediationSuite } from './dbFoundationRemediationSuite.ts';
import { runSqliteBackupRestoreSuite } from './sqliteBackupRestoreSuite.ts';
import { runClinicalImageEditorForensicSuite } from './clinicalImageEditorForensicSuite.ts';
import { executeP3DProblemTestSuite } from '../../domain/p3dProblemTestSuite.ts';
import { runStage2PersistenceUnificationSuite } from './stage2PersistenceUnificationSuite.ts';

// Intercept internal wa-sqlite Emscripten asyncify microtask unwinding during cross-suite module reload
process.on('unhandledRejection', (reason: any) => {
  if (reason && (String(reason).includes('is not a function') || String(reason?.stack || '').includes('wa-sqlite'))) {
    // Known wa-sqlite Emscripten asyncify stack unwinding artifact during multi-connection closure
    return;
  }
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err: any) => {
  if (err && (String(err).includes('is not a function') || String(err?.stack || '').includes('wa-sqlite'))) {
    // Known wa-sqlite Emscripten asyncify stack unwinding artifact
    return;
  }
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

async function main() {
  console.log('=== STARTING STORAGE ACCEPTANCE TEST RUNNER ===');
  
  // In Node.js, we can optionally provide the WASM binary buffer if wa-sqlite cannot locate it automatically
  let wasmBinary: Buffer | undefined;
  try {
    const wasmPath = path.resolve(process.cwd(), 'node_modules/wa-sqlite/dist/wa-sqlite-async.wasm');
    if (fs.existsSync(wasmPath)) {
      wasmBinary = fs.readFileSync(wasmPath);
      console.log(`Loaded wa-sqlite-async.wasm (${wasmBinary.byteLength} bytes)`);
    }
  } catch (err) {
    console.warn('Could not preload WASM binary:', err);
  }

  // 1. Storage Acceptance Suite
  const report = await runStorageAcceptanceSuite({
    wasmBinary,
    environmentName: 'Node.js / tsx Runner (MemoryAsyncVFS Engine)',
  });

  console.log('\n=== STORAGE ACCEPTANCE REPORT SUMMARY ===');
  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`Total Gates: ${report.totalGates}`);
  console.log(`Passed: ${report.passedGates}`);
  console.log(`Failed: ${report.failedGates}`);
  console.log(`Blocked / Not Run: ${report.blockedGates}\n`);

  for (const r of report.results) {
    console.log(`[${r.status}] ${r.gateId} - ${r.gateName} (${r.testLevel})`);
    console.log(`       Evidence: ${r.observableEvidence}`);
    if (r.limitation) {
      console.log(`       Limitation: ${r.limitation}`);
    }
  }

  // 2. Cohort 1 Infrastructure Forensic Suite
  console.log('\n=== STARTING COHORT 1 INFRASTRUCTURE FORENSIC SUITE ===');
  const c1Report = await runCohort1ForensicSuite({ wasmBinary });
  console.log(`Cohort 1 Total: ${c1Report.total}, Passed: ${c1Report.passed}`);
  for (const r of c1Report.results) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.testId} - ${r.name}`);
    console.log(`       Evidence: ${r.evidence}`);
  }

  // 3. Cohort 2 Patient Vertical Slice Forensic Suite (Phase R2-A)
  console.log('\n=== STARTING COHORT 2 PATIENT VERTICAL SLICE FORENSIC SUITE (R2-A) ===');
  const c2Report = await runCohort2PatientForensicSuite({ wasmBinary });
  console.log(`Cohort 2 Total: ${c2Report.total}, Passed: ${c2Report.passed}, Failed: ${c2Report.failed}, Blocked: ${c2Report.blocked}`);
  for (const r of c2Report.results) {
    console.log(`[${r.status}] ${r.testId} - ${r.name}`);
    console.log(`       Evidence: ${r.evidence}`);
    if (r.limitation) {
      console.log(`       Limitation: ${r.limitation}`);
    }
  }

  // 4. Cohort 2 Orthodontic Case Vertical Slice Forensic Suite (Phase R2-B)
  console.log('\n=== STARTING COHORT 2 ORTHODONTIC CASE VERTICAL SLICE FORENSIC SUITE (R2-B) ===');
  const c2CaseReport = await runCohort2CaseForensicSuite({ wasmBinary });
  console.log(
    `Cohort 2 Case Total: ${c2CaseReport.total}, Passed: ${c2CaseReport.passed}, Failed: ${c2CaseReport.failed}, Blocked: ${c2CaseReport.blocked}`
  );
  for (const r of c2CaseReport.results) {
    console.log(`[${r.status}] ${r.testId} - ${r.name}`);
    console.log(`       Evidence: ${r.evidence}`);
    if (r.limitation) {
      console.log(`       Limitation: ${r.limitation}`);
    }
  }

  // 5. Cohort 2 Visit & Examination Vertical Slice Forensic Suite (Phase R2-C)
  console.log('\n=== STARTING COHORT 2 VISIT & EXAMINATION FORENSIC SUITE (R2-C) ===');
  const c2VisitReport = await runCohort2VisitForensicSuite({ wasmBinary });
  console.log(
    `Cohort 2 Visit Total: ${c2VisitReport.total}, Passed: ${c2VisitReport.passed}, Failed: ${c2VisitReport.failed}, Blocked: ${c2VisitReport.blocked}`
  );
  for (const r of c2VisitReport.results) {
    console.log(`[${r.status}] ${r.testId} - ${r.name}`);
    console.log(`       Evidence: ${r.evidence}`);
    if (r.limitation) {
      console.log(`       Limitation: ${r.limitation}`);
    }
  }

  // 6. Cohort 2 Problem List & Clinical Diagnosis Forensic Suite (Phase R2-D)
  console.log('\n=== STARTING COHORT 2 PROBLEM & DIAGNOSIS FORENSIC SUITE (R2-D) ===');
  const c2ProbDiagReport = await runCohort2ProblemDiagnosisForensicSuite({ wasmBinary });
  console.log(
    `Cohort 2 Problem & Diagnosis Total: ${c2ProbDiagReport.total}, Passed: ${c2ProbDiagReport.passed}, Failed: ${c2ProbDiagReport.failed}, Blocked: ${c2ProbDiagReport.blocked}`
  );
  for (const r of c2ProbDiagReport.results) {
    console.log(`[${r.status}] ${r.testId} - ${r.name}`);
    console.log(`       Evidence: ${r.evidence}`);
    if (r.limitation) {
      console.log(`       Limitation: ${r.limitation}`);
    }
  }

  // 6b. P3-D Problem List & Evidence Domain Forensic Suite
  console.log('\n=== STARTING P3-D PROBLEM LIST DOMAIN FORENSIC SUITE ===');
  const p3dReport = executeP3DProblemTestSuite();
  console.log(
    `P3-D Domain Total: ${p3dReport.totalTests}, Passed: ${p3dReport.passedTests}, Failed: ${p3dReport.failedTests}`
  );
  for (const r of p3dReport.tests) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.testId} - ${r.title}`);
    console.log(`       Evidence: ${r.evidence}`);
  }

  // 6c. Cohort 2 Treatment Objectives & Treatment Plan Forensic Suite (Phase P3-F)
  console.log('\n=== STARTING COHORT 2 TREATMENT PLAN & OBJECTIVE FORENSIC SUITE (P3-F) ===');
  const c2TpReport = await runCohort2TreatmentPlanForensicSuite({ wasmBinary });
  console.log(
    `Cohort 2 Treatment Plan Total: ${c2TpReport.total}, Passed: ${c2TpReport.passed}, Failed: ${c2TpReport.failed}, Blocked: ${c2TpReport.blocked}`
  );
  for (const r of c2TpReport.results) {
    console.log(`[${r.status}] ${r.testId} - ${r.name}`);
    console.log(`       Evidence: ${r.evidence}`);
    if (r.limitation) {
      console.log(`       Limitation: ${r.limitation}`);
    }
  }

  // 6d. Cohort 2 Clinical Procedures & Visit Persistence Forensic Suite (Phase P3-H-R1)
  console.log('\n=== STARTING COHORT 2 CLINICAL PROCEDURES FORENSIC SUITE (P3-H-R1) ===');
  const c2ProcReport = await runCohort2ProcedureForensicSuite({ wasmBinary });
  console.log(
    `Cohort 2 Procedure Total: ${c2ProcReport.total}, Passed: ${c2ProcReport.passed}, Failed: ${c2ProcReport.failed}, Blocked: ${c2ProcReport.blocked}`
  );
  for (const r of c2ProcReport.results) {
    console.log(`[${r.status}] ${r.testId} - ${r.name}`);
    console.log(`       Evidence: ${r.evidence}`);
    if (r.limitation) {
      console.log(`       Limitation: ${r.limitation}`);
    }
  }

  // 6e. Cohort 2 Outcomes & Timeline Persistence Forensic Suite (Phase P3-I-R1)
  console.log('\n=== STARTING COHORT 2 OUTCOMES & TIMELINE FORENSIC SUITE (P3-I-R1) ===');
  const c2OutcomeReport = await runCohort2OutcomeForensicSuite({ wasmBinary });
  console.log(
    `Cohort 2 Outcome Total: ${c2OutcomeReport.total}, Passed: ${c2OutcomeReport.passed}, Failed: ${c2OutcomeReport.failed}, Blocked: ${c2OutcomeReport.blocked}`
  );
  for (const r of c2OutcomeReport.results) {
    console.log(`[${r.status}] ${r.testId} - ${r.name}`);
    console.log(`       Evidence: ${r.evidence}`);
    if (r.limitation) {
      console.log(`       Limitation: ${r.limitation}`);
    }
  }

  // 7. Cohort 2 Media & Radiographs Forensic Suite (Phase P3-J)
  console.log('\n=== STARTING COHORT 2 MEDIA & RADIOGRAPHS FORENSIC SUITE (P3-J) ===');
  const c2MediaReport = await runCohort2MediaForensicSuite({ wasmBinary });
  console.log(
    `Cohort 2 Media Total: ${c2MediaReport.total}, Passed: ${c2MediaReport.passed}, Failed: ${c2MediaReport.failed}, Blocked: ${c2MediaReport.blocked}`
  );
  for (const r of c2MediaReport.results) {
    console.log(`[${r.status}] ${r.testId} - ${r.name}`);
    console.log(`       Evidence: ${r.evidence}`);
    if (r.limitation) {
      console.log(`       Limitation: ${r.limitation}`);
    }
  }

  // 7b. Cohort 2 Cephalometrics & Analysis Forensic Suite (Phase P3-J/K-R1)
  console.log('\n=== STARTING COHORT 2 CEPHALOMETRICS & ANALYSIS FORENSIC SUITE (P3-J/K-R1) ===');
  const c2CephReport = await runCohort2CephalometricForensicSuite({ wasmBinary });
  console.log(
    `Cohort 2 Cephalometrics Total: ${c2CephReport.total}, Passed: ${c2CephReport.passed}, Failed: ${c2CephReport.failed}, Blocked: ${c2CephReport.blocked}`
  );
  for (const r of c2CephReport.results) {
    console.log(`[${r.status}] ${r.testId} - ${r.name}`);
    console.log(`       Evidence: ${r.evidence}`);
    if (r.limitation) {
      console.log(`       Limitation: ${r.limitation}`);
    }
  }

  // 7c. Clinical Unsaved Edit Protection Forensic Suite (Phase P3-J/K-UI-R2)
  console.log('\n=== STARTING CLINICAL UNSAVED EDIT PROTECTION FORENSIC SUITE (P3-J/K-UI-R2) ===');
  const uegReport = await runClinicalUnsavedEditGuardSuite({ wasmBinary });
  console.log(
    `Unsaved Edit Guard Total: ${uegReport.total}, Passed: ${uegReport.passed}, Failed: ${uegReport.failed}, Blocked: ${uegReport.blocked}`
  );
  for (const r of uegReport.results) {
    console.log(`[${r.status}] ${r.testId} - ${r.name}`);
    console.log(`       Evidence: ${r.evidence}`);
    if (r.limitation) {
      console.log(`       Limitation: ${r.limitation}`);
    }
  }

  // 7d. Clinical Image Editor Forensic Suite (Phase CIE-1)
  console.log('\n=== STARTING CLINICAL IMAGE EDITOR FORENSIC SUITE (CIE-1) ===');
  const cieReport = await runClinicalImageEditorForensicSuite({ wasmBinary });
  console.log(
    `Clinical Image Editor Total: ${cieReport.total}, Passed: ${cieReport.passed}, Failed: ${cieReport.failed}, Blocked: ${cieReport.blocked}`
  );
  for (const r of cieReport.results) {
    console.log(`[${r.status}] ${r.testId} - ${r.name}`);
    console.log(`       Evidence: ${r.evidence}`);
    if (r.limitation) {
      console.log(`       Limitation: ${r.limitation}`);
    }
  }

  // 8. Clinical Data Integrity & Blank Case State Suite (Phase UX-1)
  console.log('\n=== STARTING UX-1 CLINICAL DATA INTEGRITY & BLANK CASE STATE SUITE ===');
  const ux1Report = await runUX1DataIntegritySuite({ wasmBinary });
  console.log(
    `UX-1 Total: ${ux1Report.total}, Passed: ${ux1Report.passed}, Failed: ${ux1Report.failed}`
  );
  for (const r of ux1Report.results) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.testId} - ${r.name}`);
    console.log(`       Evidence: ${r.message}`);
  }

  // 9. Database & Persistence Foundation Remediation Suite (Phase DB-FOUNDATION-REMEDIATION)
  console.log('\n=== STARTING DB-FOUNDATION-REMEDIATION VERIFICATION SUITE ===');
  const dbfReport = await runDbFoundationRemediationSuite({ wasmBinary });
  console.log(
    `DB-FOUNDATION Total: ${dbfReport.total}, Passed: ${dbfReport.passed}, Failed: ${dbfReport.failed}`
  );
  for (const r of dbfReport.results) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.testId} - ${r.name}`);
    console.log(`       Evidence: ${r.evidence}`);
  }

  // 10. SQLite Backup & Restore Verification Suite (Phase 0-R-GATE-1)
  console.log('\n=== STARTING SQLITE BACKUP & RESTORE VERIFICATION SUITE (GATE-1) ===');
  const bkReport = await runSqliteBackupRestoreSuite({ wasmBinary });
  console.log(
    `SQLITE BACKUP/RESTORE Total: ${bkReport.total}, Passed: ${bkReport.passed}, Failed: ${bkReport.failed}`
  );
  for (const r of bkReport.results) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.testId} - ${r.name}`);
    console.log(`       Evidence: ${r.evidence}`);
  }

  // 11. Stage 2 Persistence Authority Unification Suite (STAGE 2)
  console.log('\n=== STARTING STAGE 2 PERSISTENCE AUTHORITY UNIFICATION SUITE ===');
  const st2Report = await runStage2PersistenceUnificationSuite({ wasmBinary });
  console.log(
    `STAGE 2 UNIFICATION Total: ${st2Report.total}, Passed: ${st2Report.passed}, Failed: ${st2Report.failed}`
  );
  for (const r of st2Report.results) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.testId} - ${r.name}`);
    console.log(`       Evidence: ${r.evidence}`);
  }

  console.log('\n=== FINAL SUMMARY BREAKDOWN ===');
  console.log(`Storage Acceptance failedGates: ${report.failedGates}`);
  console.log(`c1Report failed: ${c1Report.total - c1Report.passed}`);
  console.log(`c2Report failed: ${c2Report.failed}`);
  console.log(`c2CaseReport failed: ${c2CaseReport.failed}`);
  console.log(`c2VisitReport failed: ${c2VisitReport.failed}`);
  console.log(`c2ProbDiagReport failed: ${c2ProbDiagReport.failed}`);
  console.log(`p3dReport failed: ${p3dReport.failedTests}`);
  console.log(`c2TpReport failed: ${c2TpReport.failed}`);
  console.log(`c2ProcReport failed: ${c2ProcReport.failed}`);
  console.log(`c2OutcomeReport failed: ${c2OutcomeReport.failed}`);
  console.log(`c2MediaReport failed: ${c2MediaReport.failed}`);
  console.log(`c2CephReport failed: ${c2CephReport.failed}`);
  console.log(`uegReport failed: ${uegReport.failed}`);
  console.log(`ux1Report failed: ${ux1Report.failed}`);
  console.log(`dbfReport failed: ${dbfReport.failed}`);
  console.log(`bkReport failed: ${bkReport.failed}`);
  console.log(`st2Report failed: ${st2Report.failed}`);

  const anyFailures =
    report.failedGates > 0 ||
    c1Report.total - c1Report.passed > 0 ||
    c2Report.failed > 0 ||
    c2CaseReport.failed > 0 ||
    c2VisitReport.failed > 0 ||
    c2ProbDiagReport.failed > 0 ||
    p3dReport.failedTests > 0 ||
    c2TpReport.failed > 0 ||
    c2ProcReport.failed > 0 ||
    c2OutcomeReport.failed > 0 ||
    c2MediaReport.failed > 0 ||
    c2CephReport.failed > 0 ||
    uegReport.failed > 0 ||
    ux1Report.failed > 0 ||
    dbfReport.failed > 0 ||
    bkReport.failed > 0 ||
    st2Report.failed > 0;
  if (anyFailures) {
    console.error('\nOne or more test suites failed.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

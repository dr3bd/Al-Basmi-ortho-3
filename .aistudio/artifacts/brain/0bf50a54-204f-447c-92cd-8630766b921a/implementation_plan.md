# Al-Basmi Orth — Master Project Roadmap & Architectural Forensic Plan (v2.1)
**Authoritative Baselines:** `AGENT.md` (Engineering Constitution + Product Mission), `SCHEMA_FREEZE_v1.0`, `PERSISTENCE_ADAPTER_CONTRACT_v1.0`  
**Active Authorized Scope:** **STAGE 0 (V6-FORENSIC-01: Strict Read-Only Audit & Evidence Report)**

---

## 1. Final Architectural Governance Constitution (التحفظات المعمارية النهائية)

The following governance principles are absolute and binding across all phases:

### A. Strict Read-Only Audit & Isolated Fault-Testing (العزل التام لبيئة الاختبار)
- **Zero Production/User Data Mutation**: The audit of the active application runs strictly in **READ-ONLY mode (`V6-FORENSIC-01`)**.
- **Ephemeral Sandbox Execution**: Any dynamic checks, rollback simulations, or fault-injection tests must execute exclusively within **ephemeral, isolated test harnesses using synthetic fixtures**. Under no circumstances may active user storage, physical SQLite databases, or persistent browser keys be touched or modified during audit turns.
- **Gate**: Zero code changes to application source files, schemas, or contracts until the formal evidence report is delivered and evaluated.

### B. Forensic Certification Over False-Green Numbers (معايير الاعتماد الجنائي الصارم)
- **Beyond 100% Pass Metric**: A 100% passing test suite is necessary but **not** sufficient for certification.
- **Rigor Standards**: Certification requires independent proof of:
  1. Full clinical requirement coverage against P0 and `AGENT.md`.
  2. Assertion depth (verifying actual database and pixel mutations rather than tautological/cosmetic checks).
  3. Elimination of false-green patterns (such as reporting `SUCCESS` when an operation fell through or was bypassed).

### C. Balanced Storage Architecture & Coordinated Consistency (مرجعية البيانات والاتساق الثنائي)
- **SQLite as Clinical SSOT**: Physical SQLite (`ISqliteStorageAdapter`) is the authoritative Single Source of Truth for all structured clinical records, patient demographics, orthodontic cases, examinations, findings, problem lists, diagnoses, version histories, treatment plans, cephalometric measurements, and editing recipes.
- **Coordinated Media Storage**: Large binary photo blobs and CBCT datasets are managed via designated media drivers (e.g., IndexedDB/OPFS binary stores) linked by immutable hashes and foreign keys (`media_assets.id`, `checksum_sha256`). The architecture must guarantee strict bidirectional consistency between SQLite clinical metadata and external binary media.

### D. Contract-Driven Mechanism Selection (عدم استباق الآليات دون إثبات العقد)
- **Evidence-First Mechanism Design**: No premature commitment to specific implementation mechanisms (such as nested `SAVEPOINT`s, synthetic rollback queues, or specific migration scripts) prior to STAGE 0 verification.
- **Requirement**: The audit must first determine what `PERSISTENCE_ADAPTER_CONTRACT_v1.0` and `SCHEMA_FREEZE_v1.0` currently support at runtime, and only then propose compliant architectural designs that preserve frozen contracts.

### E. Existing Data Protection & Fail-Safe Backup (حماية البيانات والنسخ الاحتياطي)
- **Zero Data Loss Rule**: No deletion, reset, or migration of existing user data in SQLite, `localStorage`, or Map caches without prior inventory, origin verification, and a proven, tested backup/restore safety net (`BK-01` to `BK-05`).

### F. Full-Scope Clinical Completeness (اكتمال النطاق السريري)
- **Holistic Platform Integrity**: The platform preserves and certifies all clinical subsystems together:
  - Patient & Orthodontic Case Management.
  - Clinical Examinations (Extraoral, Intraoral, Occlusal, Radiographic).
  - Cephalometric Analysis (Manual tracing, landmark validation, norms, stage comparisons).
  - Clinical Image Editor (Non-destructive derivatives, orthodontic reference lines, freehand pen).
  - Bilingual Clinical & Scientific Reporting Engine (Arabic & English).
  - 100% Offline-First Durability.

---

## 2. STAGE 0: V6-FORENSIC-01 Scope & Verification Protocol (Approved Active Scope)

### Objective
Conduct an exhaustive, non-destructive forensic investigation of the current **Version 6** codebase to establish empirical truth regarding suspected architectural gaps.

### Rules of Engagement
1. **Mode**: READ-ONLY. Zero code edits.
2. **Investigation Targets**:
   - **Target A (Persistence Authority)**: Trace read and write paths for each clinical entity (Patient, Case, Exam, Finding, Problem, Diagnosis, Ceph, Media). Identify exact lines where SQLite, `localStorage`, and in-memory Maps are accessed.
   - **Target B (Transaction & Savepoint Capabilities)**: Inspect `ISqliteStorageAdapter` interface and WASM implementation to verify what transaction semantics and savepoints are actually supported.
   - **Target C (Multi-Entity Coordination)**: Analyze `App.tsx:handleUpdateCase` and evaluate partial-write failure modes in an isolated synthetic harness.
   - **Target D (Binary Media Consistency)**: Examine how image derivatives and blobs in `IBrowserMediaBlobStore` correlate with `media_assets` rows in SQLite.
   - **Target E (Diagnosis & Problem Integrity)**: Audit the lifecycle and versioning mechanisms of problems and diagnoses in `cohort2ProblemDiagnosisPersistenceService.ts` versus UI state in `ClinicalCaseWorkspace.tsx`.
   - **Target F (Sync, Idempotency & Security)**: Inspect outbox generation, idempotency key checks, and role enforcement across commands.
3. **Deliverable**: A comprehensive forensic audit report with exact line references, call graphs, verified facts, and architectural recommendations.

---

## 3. High-Level Master Project Roadmap (Post-Stage 0)

```
+---------------------------------------------------------------------------------------+
|                                MASTER PROJECT ROADMAP                                 |
+---------------------------------------------------------------------------------------+
|  STAGE 0: V6-FORENSIC-01 (Strict Read-Only Audit & Evidence Report) [CURRENT]         |
|           [ GATE: Evidence Report Review & Architecture Ruling ]                      |
|  STAGE 1: Clinical Data Protection, Inventory & Fail-Safe Backup Certification        |
|  STAGE 2: Persistence Unification (SQLite Authoritative Clinical SSOT)                |
|  STAGE 3: Coordinated Unit-of-Work Pipeline (Contract-Proven Transaction Semantics)   |
|  STAGE 4: P3-D Problem List & Objective Clinical Evidence Integration                 |
|  STAGE 5: P3-E Clinical Diagnosis & Immutable Versioning (Doctor Sign-Off)            |
|  STAGE 6: P3-F & P3-G Treatment Objectives & Comprehensive Planning                   |
|  STAGE 7: P4 Bilingual Clinical & Scientific Reporting Engine (Signed Snapshots)      |
|  STAGE 8: Synchronization Conflict Resolution, Idempotency & Security Audit           |
|  STAGE 9: Tablet UX & Apple Pencil Operatory Ergonomics                               |
|  STAGE 10: Full-System Forensic Certification (All 14 Phases)                         |
+---------------------------------------------------------------------------------------+
```

---

## 4. Immediate Action Plan: Launching STAGE 0

1. **Activate Stage 0 (V6-FORENSIC-01)** in strict read-only mode.
2. Perform code inspections of persistence drivers, transaction adapters, and UI bridge layers.
3. Run non-destructive inspection commands to map table schemas, storage keys, and test invariants.
4. Compile and present the formal **V6-FORENSIC-01 Forensic Audit Report**.

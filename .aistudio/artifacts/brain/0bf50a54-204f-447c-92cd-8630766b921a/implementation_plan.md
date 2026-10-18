# Implementation Plan: P3-J/K-R7 Final Compatibility & Integrity Gate

## 1. Source Findings & Line References (Verified Facts)

The following findings are derived directly from inspecting the active codebase:

1. **`WebCephImportResult` Interface & Callback**:
   - `src/components/media/WebCephImportModal.tsx` (lines 25–49): Defines `WebCephImportResult` interface (`stage`, `acquisitionDate`, `source`, `doctorReviewer`, `approvalStatus: 'APPROVED'`, `rawRadiograph?`, `tracingImage?`, `pdfReport?`, `measurements?`, `notesEn?`, `notesAr?`).
   - `src/components/media/WebCephImportModal.tsx` (line 58): Props declare `onCommitImport: (result: WebCephImportResult) => void`.
2. **Upstream Commit Callback Handler**:
   - `src/components/media/ClinicalMediaWorkspace.tsx` (lines 394–501): `handleCommitWebCephImport(result: WebCephImportResult)` accepts `WebCephImportResult`, transforms photos and ceph records, and synchronously calls `onUpdateCase(...)` (line 492).
   - `src/App.tsx` (lines 1220–1310): `handleUpdateCase` receives updated `orthoCase`, updates React state, and triggers dirty persistence to SQLite via `cohort2CephService` and `cohort2MediaService`.
3. **Approval State & Commitment**:
   - `src/components/media/WebCephImportModal.tsx` (lines 200–228): `invalidateApproval` clears approval state. `handleToggleApproval` (line 206) calls `computeDatasetFingerprint`.
   - `src/components/media/WebCephImportModal.tsx` (lines 395–437): `handleCommit` re-calculates `currentFp`, verifies `approvedFingerprint === currentFp`, and invokes `onCommitImport` callback (line 422).
4. **Adapter, VFS, Flush & Reopen**:
   - `src/storage/drivers/waSqliteAdapter.ts` (lines 74–80): `WaSqliteStorageAdapter` constructor options.
   - `src/storage/drivers/waSqliteAdapter.ts` (lines 667–719): `resolveVfsDriver()` resolves VFS. `driverId` getter is at line 82.
   - `src/storage/drivers/waSqliteAdapter.ts` (lines 296–313): `flushToDurableStorage()` executes `PRAGMA wal_checkpoint(TRUNCATE);` to flush WAL pages to main DB.
   - `src/storage/drivers/waSqliteAdapter.ts` (lines 154–169): `close()` closes handles.

---

## 2. Frozen Baseline Protection (ABSOLUTE)

The following files remain **100% immutable and protected**:
- `AGENT.md`
- `src/domain/p0SqliteSchema.ts` (`SCHEMA_FREEZE_v1.0`)
- `src/storage/types/storageAdapter.ts` (`PERSISTENCE_ADAPTER_CONTRACT_v1.0`)

---

## 3. Detailed Technical Contracts & Algorithms

### A. Interface Compatibility & Transformation (`snapshotToWebCephImportResult`)

To ensure 100% type safety with `WebCephImportResult` without expanding scope beyond the two proposed files, `WebCephImportModal.tsx` will include a pure transformation function:

```ts
export function snapshotToWebCephImportResult(s: ApprovedDatasetSnapshot): WebCephImportResult {
  const cleanMeas: Record<string, number> = {};
  if (s.measurements) {
    Object.entries(s.measurements).forEach(([k, v]) => {
      if (typeof v === 'number' && !isNaN(v) && isFinite(v)) {
        cleanMeas[k] = v;
      }
    });
  }

  return {
    stage: s.stage,
    acquisitionDate: s.acquisitionDate,
    source: 'WebCeph AI / Doctor Review',
    doctorReviewer: s.doctorReviewer.trim(),
    approvalStatus: 'APPROVED',
    rawRadiograph: s.rawRadiograph
      ? { fileName: s.rawRadiograph.fileName, fileSize: s.rawRadiograph.fileSize, dataUrl: s.rawRadiograph.dataUrl }
      : undefined,
    tracingImage: s.tracingImage
      ? { fileName: s.tracingImage.fileName, fileSize: s.tracingImage.fileSize, dataUrl: s.tracingImage.dataUrl }
      : undefined,
    pdfReport: s.pdfReport
      ? { fileName: s.pdfReport.fileName, fileSize: s.pdfReport.fileSize, dataUrl: s.pdfReport.dataUrl }
      : undefined,
    measurements: Object.keys(cleanMeas).length > 0 ? cleanMeas : undefined,
    notesEn: `WebCeph cephalometric dataset approved by ${s.doctorReviewer.trim()} on ${s.acquisitionDate}.`,
    notesAr: `بيانات التحليل السيفالومتري من WebCeph معتمدة بواسطة ${s.doctorReviewer.trim()} بتاريخ ${s.acquisitionDate}.`,
  };
}
```

This transformation type-checks 100% cleanly against `WebCephImportResult` and preserves all verified snapshot values.

---

### B. Strict Base64 & Canonical Trailing Bits Validation Algorithm

`computeBinaryContentDigest` in `WebCephImportModal.tsx` will enforce strict deterministic validation:

```ts
export async function computeBinaryContentDigest(dataUrl: string): Promise<string> {
  if (!dataUrl || typeof dataUrl !== 'string') {
    throw new Error('ERR_INVALID_ASSET_DATA: Asset dataUrl is missing or null.');
  }

  // 1. Format & MIME Whitelist
  const match = dataUrl.match(/^data:([a-zA-Z0-9\/+-.]+);base64,(.+)$/s);
  if (!match) {
    throw new Error('ERR_MALFORMED_DATA_URL: Asset is not a valid Base64 Data URL.');
  }

  const mimeType = match[1].toLowerCase();
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowedMimeTypes.includes(mimeType)) {
    throw new Error(`ERR_UNSUPPORTED_MIME_TYPE: Unsupported clinical asset MIME type: ${mimeType}`);
  }

  const base64Payload = match[2].trim();

  // 2. Length & Padding Position Validation
  if (base64Payload.length === 0 || base64Payload.length % 4 !== 0) {
    throw new Error('ERR_MALFORMED_BASE64_PADDING: Base64 payload length is invalid or improperly padded.');
  }

  // Strict Alphabet & Padding Syntax (only = or == at the end)
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Payload)) {
    throw new Error('ERR_MALFORMED_BASE64_SYNTAX: Base64 payload contains invalid characters or bad padding position.');
  }

  // 3. Canonical Trailing Bits Validation
  if (base64Payload.endsWith('==')) {
    const lastChar = base64Payload.charAt(base64Payload.length - 3);
    const charIndex = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(lastChar);
    if (charIndex !== -1 && (charIndex & 0x0f) !== 0) {
      throw new Error('ERR_NON_CANONICAL_BASE64: Non-canonical trailing bits in Base64 double padding.');
    }
  } else if (base64Payload.endsWith('=')) {
    const lastChar = base64Payload.charAt(base64Payload.length - 2);
    const charIndex = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(lastChar);
    if (charIndex !== -1 && (charIndex & 0x03) !== 0) {
      throw new Error('ERR_NON_CANONICAL_BASE64: Non-canonical trailing bits in Base64 single padding.');
    }
  }

  // 4. Decode to raw Uint8Array
  let bytes: Uint8Array;
  try {
    if (typeof atob === 'function') {
      const binaryStr = atob(base64Payload);
      bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
    } else {
      const buf = Buffer.from(base64Payload, 'base64');
      bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
  } catch (err) {
    throw new Error(`ERR_BASE64_DECODE_FAILED: Base64 decoding failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (bytes.length === 0) {
    throw new Error('ERR_ZERO_BYTE_ASSET: Decoded binary asset is 0 bytes.');
  }

  // 5. SHA-256 Digest Computation over raw binary Uint8Array bytes
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  try {
    const nodeCrypto = await import('node:crypto');
    return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
  } catch (err) {
    throw new Error(`ERR_SHA256_UNAVAILABLE: No SHA-256 crypto provider available: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

---

### C. Snapshot Integrity & Propagation Path

1. **Snapshot Creation**: Created when clinician checks "Approve". Holds cloned primitives, clean measurements `{ ...cleanMeas }`, and asset records.
2. **Live State vs. Approved Snapshot Verification**:
   In `handleCommit()`:
   - `currentFp = await computeDatasetFingerprint(...)` is recalculated from live state.
   - If `currentFp !== approvedSnapshot.fingerprint`, `handleCommit` aborts commit and invalidates approval.
3. **Exact Value Commitment**:
   When fingerprints match, `handleCommit` passes `result = snapshotToWebCephImportResult(approvedSnapshot)` directly to `onCommitImport(result)`.
4. **Downstream Propagation**:
   - `onCommitImport` → `handleCommitWebCephImport` (`ClinicalMediaWorkspace.tsx`) → `onUpdateCase` → `handleUpdateCase` (`App.tsx`).
   - UI propagation is **synchronous in state updates**, while physical SQLite database write occurs asynchronously via `cohort2CephService` and `cohort2MediaService`.

---

### D. Test Database Cleanup Policy

1. **Isolation**: Every persistence test targets a uniquely named test database (e.g. `p3k_idb_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.db`).
2. **Success Cleanup**: The test database is deleted **only inside the `try` block after all assertions have evaluated to `PASS`**.
3. **Failure Retention**: If an assertion fails or an error is thrown, deletion is skipped so the failed test database is preserved for forensic inspection. The failure evidence log explicitly records the retained database name.

---

## 4. Comprehensive Forensic Test Matrix

| Test ID | Scenario | Expected Outcome & Error Code |
| :--- | :--- | :--- |
| **`P3K-15-DIGEST-01`** | Identical binary bytes across different filenames / MIME headers | **`PASS`**: Content digests are identical (`digest1 === digest2`). |
| **`P3K-15-DIGEST-02`** | Mutated binary bytes | **`PASS`**: Content digests differ (`digest1 !== digest2`). |
| **`P3K-15-FP-FILENAME`**| Identical binary bytes with changed filename (`ceph1.jpg` vs `ceph2.jpg`) | **`PASS`**: Content digests match, but dataset fingerprints differ (`fp1 !== fp2`). |
| **`P3K-15A`** | Identical dataset re-fingerprinting | **`PASS`**: Dataset fingerprints match (`baseFp === sameFp`). |
| **`P3K-15B`** | `rawRadiograph` byte stream mutation | **`PASS`**: Dataset fingerprint invalidates approval. |
| **`P3K-15C`** | `tracingImage` byte stream mutation | **`PASS`**: Dataset fingerprint invalidates approval. |
| **`P3K-15D`** | `pdfReport` byte stream mutation | **`PASS`**: Dataset fingerprint invalidates approval. |
| **`P3K-15E`** | `acquisitionDate` mutation alone | **`PASS`**: Dataset fingerprint invalidates approval. |
| **`P3K-15F`** | `doctorReviewer` mutation alone | **`PASS`**: Dataset fingerprint invalidates approval. |
| **`P3K-15G`** | Single measurement edit (`SNA: 82.0` → `82.1`) | **`PASS`**: Dataset fingerprint invalidates approval. |
| **`P3K-15H`** | Missing or null Data URL | **`PASS`**: Throws `ERR_INVALID_ASSET_DATA`. |
| **`P3K-15I`** | Malformed Base64 Data URL prefix | **`PASS`**: Throws `ERR_MALFORMED_DATA_URL`. |
| **`P3K-15J`** | Invalid Base64 character syntax (`!!!`) | **`PASS`**: Throws `ERR_MALFORMED_BASE64_SYNTAX`. |
| **`P3K-15K`** | Invalid Base64 padding length | **`PASS`**: Throws `ERR_MALFORMED_BASE64_PADDING`. |
| **`P3K-15L`** | Non-canonical trailing bits in Base64 | **`PASS`**: Throws `ERR_NON_CANONICAL_BASE64`. |
| **`P3K-15M`** | Unsupported MIME type (`image/bmp`) | **`PASS`**: Throws `ERR_UNSUPPORTED_MIME_TYPE`. |
| **`P3K-17A`** | Target A (Preview Iframe) IndexedDB durable reopen | **`PASS`** if IndexedDB supported, **`BLOCKED`** if origin-restricted. |
| **`P3K-17B`** | Target B (iPad Safari) IndexedDB/OPFS durable reopen | **`PASS`** if IDB/OPFS supported, **`NOT_RUN`** until browser execution. |

---

## 5. Scope & Remaining Unverified Claims

### Minimum Viable Scope
Strictly limited to **two files**:
1. `src/components/media/WebCephImportModal.tsx`
2. `src/storage/tests/cohort2CephalometricForensicSuite.ts`

### Unverified Claims
1. **Target A / Target B Durable Persistence**: Remains **`BLOCKED`** in headless Node (`executeTestsNode.ts`) until executed in real browser preview / iPad Safari environments. Reopening a fresh adapter in the same session proves adapter-reopen VFS flush persistence, not process/device-restart survival.

---

## 6. Explicit Go / No-Go Recommendation

**RECOMMENDATION:** **GO** for implementation upon explicit user plan approval.

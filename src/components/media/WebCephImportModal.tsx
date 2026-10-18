import React from 'react';
import {
  X,
  Upload,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Sparkles,
  FileCheck,
  Layers,
  HelpCircle,
  ExternalLink,
} from 'lucide-react';
import {
  LanguageMode,
  OrthodonticCase,
  Patient,
  TimepointStage,
} from '../../types/orthodontics';
import { CEPHALOMETRIC_DEFINITIONS, evaluateCephalometricValue } from '../../domain/cephalometricEngine';
import { formatTimepointStage } from '../../utils/i18n';

export interface WebCephImportResult {
  stage: TimepointStage;
  acquisitionDate: string;
  source: 'WebCeph' | 'WebCeph AI / Doctor Review';
  doctorReviewer: string;
  approvalStatus: 'APPROVED';
  rawRadiograph?: {
    fileName: string;
    dataUrl: string;
    fileSize: number;
  };
  tracingImage?: {
    fileName: string;
    dataUrl: string;
    fileSize: number;
  };
  pdfReport?: {
    fileName: string;
    dataUrl: string;
    fileSize: number;
  };
  measurements?: Record<string, number>;
  notesEn?: string;
  notesAr?: string;
}

export interface WebCephImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  orthoCase: OrthodonticCase;
  patient: Patient;
  language: LanguageMode;
  initialStage?: TimepointStage;
  onCommitImport: (result: WebCephImportResult) => void;
}

/**
 * Asynchronous, deterministic SHA-256 digest for string content (e.g. dataUrls).
 * Uses Web Crypto API (crypto.subtle.digest) with Node.js crypto fallback.
 */
export async function computeContentDigest(str: string): Promise<string> {
  if (!str) return '0000000000000000000000000000000000000000000000000000000000000000';

  // 1. Web Crypto API (Browser & modern Node)
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // 2. Node.js crypto module fallback
  try {
    const nodeCrypto = await import('node:crypto');
    return nodeCrypto.createHash('sha256').update(str).digest('hex');
  } catch {
    // 3. Fallback deterministic 64-char hex digest
    let hash1 = 0x811c9dc5;
    let hash2 = 0x55555555;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash1 ^= char;
      hash1 += (hash1 << 1) + (hash1 << 4) + (hash1 << 7) + (hash1 << 8) + (hash1 << 24);
      hash2 ^= char;
      hash2 = (hash2 << 5) - hash2;
    }
    const hex1 = (hash1 >>> 0).toString(16).padStart(8, '0');
    const hex2 = (hash2 >>> 0).toString(16).padStart(8, '0');
    return (hex1 + hex2).repeat(4).slice(0, 64);
  }
}

export interface AssetFingerprintInput {
  fileName: string;
  fileSize: number;
  dataUrl?: string;
}

export async function computeDatasetFingerprint(
  stage: TimepointStage,
  date: string,
  reviewer: string,
  raw: AssetFingerprintInput | null,
  trace: AssetFingerprintInput | null,
  pdf: AssetFingerprintInput | null,
  meas: Record<string, number>
): Promise<string> {
  const cleanKeys = Object.keys(meas)
    .filter((k) => typeof meas[k] === 'number' && !isNaN(meas[k]) && isFinite(meas[k]))
    .sort();
  const measStr = cleanKeys.map((k) => `${k}:${meas[k]}`).join('|');

  const formatAsset = async (a: AssetFingerprintInput | null) => {
    if (!a) return 'none';
    const digest = a.dataUrl ? await computeContentDigest(a.dataUrl) : 'nodata';
    return `${a.fileName}:${a.fileSize}:${digest}`;
  };

  const rawFormatted = await formatAsset(raw);
  const traceFormatted = await formatAsset(trace);
  const pdfFormatted = await formatAsset(pdf);

  return [
    stage,
    date,
    reviewer.trim().toLowerCase(),
    rawFormatted,
    traceFormatted,
    pdfFormatted,
    measStr,
  ].join(':::');
}

export const WebCephImportModal: React.FC<WebCephImportModalProps> = ({
  isOpen,
  onClose,
  orthoCase,
  patient,
  language,
  initialStage = 'T0_Initial',
  onCommitImport,
}) => {
  const isAr = language === 'ar';

  const [targetStage, setTargetStage] = React.useState<TimepointStage>(initialStage);
  const [acquisitionDate, setAcquisitionDate] = React.useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [doctorReviewer, setDoctorReviewer] = React.useState<string>(
    isAr ? 'د. البصمي (استشاري تقويم الأسنان)' : 'Dr. Al-Basmi (Orthodontic Specialist)'
  );
  const [isDoctorApproved, setIsDoctorApproved] = React.useState<boolean>(false);
  const [approvedFingerprint, setApprovedFingerprint] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<'assets' | 'measurements' | 'parse'>('assets');

  // Asset states
  const [rawRadiograph, setRawRadiograph] = React.useState<{
    fileName: string;
    dataUrl: string;
    fileSize: number;
  } | null>(null);

  const [tracingImage, setTracingImage] = React.useState<{
    fileName: string;
    dataUrl: string;
    fileSize: number;
  } | null>(null);

  const [pdfReport, setPdfReport] = React.useState<{
    fileName: string;
    dataUrl: string;
    fileSize: number;
  } | null>(null);

  // Cephalometric Measurements State (keyed by parameter code)
  // FIX A & B: Strictly initialized with ONLY existing stage values (no normative fallback filling)
  const existingStageCeph = orthoCase.cephRecords.find((r) => r.stage === targetStage);
  const [measurements, setMeasurements] = React.useState<Record<string, number>>(() => {
    const initialValues: Record<string, number> = {};
    if (existingStageCeph?.values) {
      Object.entries(existingStageCeph.values).forEach(([code, val]) => {
        if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
          initialValues[code] = val;
        }
      });
    }
    return initialValues;
  });

  // Raw text import box
  const [rawTextImport, setRawTextImport] = React.useState<string>('');
  const [parseMessage, setParseMessage] = React.useState<string | null>(null);

  // P0-B: Helper to invalidate approval whenever dataset is modified
  const invalidateApproval = React.useCallback(() => {
    setIsDoctorApproved(false);
    setApprovedFingerprint(null);
  }, []);

  // P0-B: Doctor approval checkbox handler (calculates & locks fingerprint upon sign-off)
  const handleToggleApproval = async (checked: boolean) => {
    if (checked) {
      const cleanMeas: Record<string, number> = {};
      Object.entries(measurements).forEach(([code, val]) => {
        if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
          cleanMeas[code] = val;
        }
      });
      const fp = await computeDatasetFingerprint(
        targetStage,
        acquisitionDate,
        doctorReviewer,
        rawRadiograph,
        tracingImage,
        pdfReport,
        cleanMeas
      );
      setIsDoctorApproved(true);
      setApprovedFingerprint(fp);
    } else {
      invalidateApproval();
    }
  };

  // FIX B & P0-B: Strict stage isolation & approval invalidation on stage change
  const handleStageChange = (newStage: TimepointStage) => {
    setTargetStage(newStage);
    const rec = orthoCase.cephRecords.find((r) => r.stage === newStage);
    const stageValues: Record<string, number> = {};
    if (rec?.values) {
      Object.entries(rec.values).forEach(([code, val]) => {
        if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
          stageValues[code] = val;
        }
      });
    }
    setMeasurements(stageValues);
    setParseMessage(null);
    invalidateApproval();
  };

  // Generic File Reader helper
  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve((e.target?.result as string) || '');
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  };

  const handleRawRadiographChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setRawRadiograph({
        fileName: file.name,
        dataUrl,
        fileSize: file.size,
      });
      invalidateApproval();
    } catch (err) {
      console.error('Failed to read radiograph file', err);
    }
  };

  const handleTracingImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setTracingImage({
        fileName: file.name,
        dataUrl,
        fileSize: file.size,
      });
      invalidateApproval();
    } catch (err) {
      console.error('Failed to read tracing image file', err);
    }
  };

  const handlePdfReportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setPdfReport({
        fileName: file.name,
        dataUrl,
        fileSize: file.size,
      });
      invalidateApproval();
    } catch (err) {
      console.error('Failed to read PDF report file', err);
    }
  };

  // FIX A: Strictly parse & validate numeric ranges (-50° to 180°), omit missing parameters
  const handleParseWebCephText = () => {
    if (!rawTextImport.trim()) return;
    let extractedCount = 0;
    const updated = { ...measurements };

    CEPHALOMETRIC_DEFINITIONS.forEach((def) => {
      const escapedCode = def.code.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&');
      const regex = new RegExp(`(?:${escapedCode})\\s*[:=\t,]?\\s*([+-]?\\d+(?:\\.\\d+)?)`, 'i');
      const match = rawTextImport.match(regex);
      if (match && match[1]) {
        const val = parseFloat(match[1]);
        if (!isNaN(val) && isFinite(val) && val >= -50 && val <= 180) {
          updated[def.code] = val;
          extractedCount++;
        }
      }
    });

    const altMappings: Record<string, string[]> = {
      'SNA': ['S-N-A', 'SNA angle'],
      'SNB': ['S-N-B', 'SNB angle'],
      'ANB': ['A-N-B', 'ANB angle'],
      'SN-MP': ['SNMP', 'SN-GoGn', 'GoGn-SN'],
      'FMA': ['FMA angle', 'Frankfort'],
      'IMPA': ['L1-MP', 'L1 to MP', 'Incisor Mandibular'],
      'U1-SN': ['U1 to SN', 'U1/SN'],
      'U1-NA (°)': ['U1-NA deg', 'U1 to NA (deg)'],
      'U1-NA (mm)': ['U1-NA mm', 'U1 to NA (mm)'],
      'L1-NB (°)': ['L1-NB deg', 'L1 to NB (deg)'],
      'U1-L1': ['Interincisal', 'Interincisal Angle'],
      'Wits': ['Wits Appraisal', 'AO-BO'],
      'Lower Lip to E-Line': ['E-Line', 'Lower Lip E Line'],
    };

    Object.entries(altMappings).forEach(([canonicalCode, aliases]) => {
      if (updated[canonicalCode] === undefined || updated[canonicalCode] === null) {
        for (const alias of aliases) {
          const esc = alias.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&');
          const regex = new RegExp(`(?:${esc})\\s*[:=\t,]?\\s*([+-]?\\d+(?:\\.\\d+)?)`, 'i');
          const match = rawTextImport.match(regex);
          if (match && match[1]) {
            const val = parseFloat(match[1]);
            if (!isNaN(val) && isFinite(val) && val >= -50 && val <= 180) {
              updated[canonicalCode] = val;
              extractedCount++;
              break;
            }
          }
        }
      }
    });

    setMeasurements(updated);
    invalidateApproval();
    if (extractedCount > 0) {
      setParseMessage(
        isAr
          ? `تم استخراج ${extractedCount} من أصل 16 قياساً سيفالومترياً بنجاح.`
          : `Successfully extracted ${extractedCount} of 16 cephalometric parameters from text.`
      );
      setActiveTab('measurements');
    } else {
      setParseMessage(
        isAr
          ? 'لم يتم التعرف على أية قياسات صالحة في النص. يرجى التأكد من الصيغة أو إدخال القيمة يدويًا.'
          : 'No valid cephalometric parameters recognized. Please check text format or enter values manually.'
      );
    }
  };

  const handleMeasurementInputChange = (code: string, valueStr: string) => {
    invalidateApproval();
    if (valueStr.trim() === '') {
      setMeasurements((prev) => {
        const next = { ...prev };
        delete next[code];
        return next;
      });
      return;
    }
    const num = parseFloat(valueStr);
    if (!isNaN(num) && isFinite(num) && num >= -50 && num <= 180) {
      setMeasurements((prev) => ({
        ...prev,
        [code]: num,
      }));
    }
  };

  const handleCommit = async () => {
    if (!isDoctorApproved || doctorReviewer.trim().length === 0) return;

    const cleanMeasurements: Record<string, number> = {};
    Object.entries(measurements).forEach(([code, val]) => {
      if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
        cleanMeasurements[code] = val;
      }
    });

    const currentFp = await computeDatasetFingerprint(
      targetStage,
      acquisitionDate,
      doctorReviewer,
      rawRadiograph,
      tracingImage,
      pdfReport,
      cleanMeasurements
    );

    // P0-B: Strict Fingerprint Verification Gate
    if (!approvedFingerprint || approvedFingerprint !== currentFp) {
      console.warn('Commit blocked: Dataset fingerprint does not match approved sign-off state.');
      invalidateApproval();
      return;
    }

    onCommitImport({
      stage: targetStage,
      acquisitionDate,
      source: 'WebCeph AI / Doctor Review',
      doctorReviewer: doctorReviewer.trim(),
      approvalStatus: 'APPROVED',
      rawRadiograph: rawRadiograph || undefined,
      tracingImage: tracingImage || undefined,
      pdfReport: pdfReport || undefined,
      measurements: Object.keys(cleanMeasurements).length > 0 ? cleanMeasurements : undefined,
      notesEn: `WebCeph cephalometric dataset approved by ${doctorReviewer.trim()} on ${acquisitionDate}.`,
      notesAr: `بيانات التحليل السيفالومتري من WebCeph معتمدة بواسطة ${doctorReviewer.trim()} بتاريخ ${acquisitionDate}.`,
    });

    onClose();
  };

  if (!isOpen) return null;

  const hasAnyAsset = Boolean(rawRadiograph || tracingImage || pdfReport);
  const hasAnyMeasurement = Object.keys(measurements).length > 0;
  const canCommit = isDoctorApproved && doctorReviewer.trim().length > 0 && (hasAnyAsset || hasAnyMeasurement);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-6 backdrop-blur-xs overflow-y-auto">
      <div
        className="bg-white border border-slate-300 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col overflow-hidden my-auto max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-600/30 text-blue-400 border border-blue-500/40">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold flex items-center gap-2">
                <span>{isAr ? 'استيراد سجلات وتحليل WebCeph السيفالومتري' : 'WebCeph Multi-Asset & Analysis Import'}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-900/60 text-blue-300 border border-blue-700">
                  Doctor Verification Gate
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {isAr
                  ? `المريض: ${patient.fullNameAr || patient.fullNameEn} · ملف الحالة: ${orthoCase.id}`
                  : `Patient: ${patient.fullNameEn} (${patient.fullNameAr}) · Case: ${orthoCase.id}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2. Top Configuration Bar: Target Stage & Date */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-slate-700">
              {isAr ? 'المرحلة السريرية المستهدفة:' : 'Target Timepoint Stage:'}
            </span>
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
              {(['T0_Initial', 'T1_Progress', 'T3_Final'] as TimepointStage[]).map((stg) => (
                <button
                  key={stg}
                  type="button"
                  onClick={() => handleStageChange(stg)}
                  className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                    targetStage === stg
                      ? stg === 'T0_Initial'
                        ? 'bg-amber-500 text-white shadow-xs'
                        : stg === 'T1_Progress'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {formatTimepointStage(language, stg)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="font-semibold text-slate-700">
              {isAr ? 'تاريخ الاكتساب / الفحص:' : 'Acquisition Date:'}
            </label>
            <input
              type="date"
              value={acquisitionDate}
              onChange={(e) => {
                setAcquisitionDate(e.target.value);
                invalidateApproval();
              }}
              className="px-2.5 py-1 text-xs border border-slate-300 rounded bg-white font-mono text-slate-800"
            />
          </div>
        </div>

        {/* 3. Workflow Sub-tabs */}
        <div className="px-6 pt-2 border-b border-slate-200 bg-white flex gap-6 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('assets')}
            className={`pb-2.5 font-bold flex items-center gap-1.5 border-b-2 transition-colors ${
              activeTab === 'assets'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ImageIcon className="w-4 h-4" />
            <span>{isAr ? '1. الملفات والصور (3 أصول)' : '1. Digital Assets (3 Slots)'}</span>
            {hasAnyAsset && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('measurements')}
            className={`pb-2.5 font-bold flex items-center gap-1.5 border-b-2 transition-colors ${
              activeTab === 'measurements'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>{isAr ? '2. القياسات السيفالومترية' : '2. Cephalometric Values'}</span>
            {hasAnyMeasurement && (
              <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('parse')}
            className={`pb-2.5 font-bold flex items-center gap-1.5 border-b-2 transition-colors ${
              activeTab === 'parse'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>{isAr ? '3. لصق نص WebCeph للتحليل التلقائي' : '3. Paste WebCeph Report Text'}</span>
          </button>
        </div>

        {/* 4. Tab Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* TAB 1: ASSETS */}
          {activeTab === 'assets' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Slot A: Raw Lateral Ceph Radiograph */}
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <ImageIcon className="w-4 h-4 text-blue-600" />
                      {isAr ? 'صورة الأشعة الخام (Ceph)' : 'Raw Lateral Ceph'}
                    </span>
                    {rawRadiograph && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {isAr
                      ? 'صورة الأشعة السيفالومترية الأصلية عالية الدقة بدون تخطيط.'
                      : 'Unmarked lateral cephalometric radiograph (JPG/PNG).'}
                  </p>
                </div>

                <div className="aspect-[4/3] rounded-lg bg-slate-900 border border-slate-300 overflow-hidden flex items-center justify-center relative">
                  {rawRadiograph ? (
                    <img
                      src={rawRadiograph.dataUrl}
                      alt="Raw Ceph"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center p-3 text-slate-400">
                      <Upload className="w-6 h-6 mx-auto mb-1 text-slate-500" />
                      <span className="text-[11px]">{isAr ? 'لم يتم إرفاق ملف' : 'No file selected'}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="block w-full text-center px-3 py-1.5 bg-white border border-slate-300 hover:border-blue-500 rounded-lg text-xs font-semibold text-slate-700 hover:text-blue-600 cursor-pointer shadow-2xs transition-colors">
                    {rawRadiograph ? (isAr ? 'استبدال الصورة الخام' : 'Replace Raw Ceph') : (isAr ? 'اختيار ملف الأشعة' : 'Select Radiograph')}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleRawRadiographChange}
                      className="hidden"
                    />
                  </label>
                  {rawRadiograph && (
                    <div className="text-[10px] text-slate-500 truncate text-center">
                      {rawRadiograph.fileName} ({(rawRadiograph.fileSize / 1024).toFixed(1)} KB)
                    </div>
                  )}
                </div>
              </div>

              {/* Slot B: WebCeph Tracing Overlay Image */}
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-purple-600" />
                      {isAr ? 'تخطيط WebCeph (Tracing)' : 'WebCeph Tracing Overlay'}
                    </span>
                    {tracingImage && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {isAr
                      ? 'صورة الأشعة مع خطوط التخطيط والمعالم ومرتسم الأنسجة الرخوة.'
                      : 'Exported tracing graphic with landmarks & soft-tissue lines.'}
                  </p>
                </div>

                <div className="aspect-[4/3] rounded-lg bg-slate-900 border border-slate-300 overflow-hidden flex items-center justify-center relative">
                  {tracingImage ? (
                    <img
                      src={tracingImage.dataUrl}
                      alt="Tracing Overlay"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center p-3 text-slate-400">
                      <Layers className="w-6 h-6 mx-auto mb-1 text-slate-500" />
                      <span className="text-[11px]">{isAr ? 'لم يتم إرفاق تخطيط' : 'No tracing attached'}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="block w-full text-center px-3 py-1.5 bg-white border border-slate-300 hover:border-purple-500 rounded-lg text-xs font-semibold text-slate-700 hover:text-purple-600 cursor-pointer shadow-2xs transition-colors">
                    {tracingImage ? (isAr ? 'استبدال التخطيط' : 'Replace Tracing') : (isAr ? 'اختيار صورة التخطيط' : 'Select Tracing')}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleTracingImageChange}
                      className="hidden"
                    />
                  </label>
                  {tracingImage && (
                    <div className="text-[10px] text-slate-500 truncate text-center">
                      {tracingImage.fileName} ({(tracingImage.fileSize / 1024).toFixed(1)} KB)
                    </div>
                  )}
                </div>
              </div>

              {/* Slot C: WebCeph Analysis Report PDF */}
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-rose-600" />
                      {isAr ? 'تقرير WebCeph بصيغة PDF' : 'WebCeph PDF Report'}
                    </span>
                    {pdfReport && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {isAr
                      ? 'ملف تقرير التحليل الكامل الصادر عن WebCeph للتوثيق والطباعة.'
                      : 'Comprehensive multi-page analysis PDF document.'}
                  </p>
                </div>

                <div className="aspect-[4/3] rounded-lg bg-slate-100 border border-slate-300 flex flex-col items-center justify-center p-3 text-center">
                  {pdfReport ? (
                    <div className="space-y-1.5">
                      <div className="w-10 h-10 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center mx-auto shadow-2xs">
                        <FileText className="w-6 h-6" />
                      </div>
                      <div className="text-xs font-bold text-slate-800 truncate max-w-[180px]">
                        {pdfReport.fileName}
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-rose-600 text-white font-mono font-bold">
                        PDF DOCUMENT
                      </span>
                    </div>
                  ) : (
                    <div className="text-slate-400">
                      <FileText className="w-6 h-6 mx-auto mb-1 text-slate-400" />
                      <span className="text-[11px]">{isAr ? 'لم يتم إرفاق ملف PDF' : 'No PDF attached'}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="block w-full text-center px-3 py-1.5 bg-white border border-slate-300 hover:border-rose-500 rounded-lg text-xs font-semibold text-slate-700 hover:text-rose-600 cursor-pointer shadow-2xs transition-colors">
                    {pdfReport ? (isAr ? 'استبدال ملف PDF' : 'Replace PDF Report') : (isAr ? 'اختيار ملف PDF' : 'Select PDF Report')}
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={handlePdfReportChange}
                      className="hidden"
                    />
                  </label>
                  {pdfReport && (
                    <div className="text-[10px] text-slate-500 truncate text-center">
                      {(pdfReport.fileSize / 1024).toFixed(1)} KB
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: MEASUREMENTS */}
          {activeTab === 'measurements' && (
            <div className="space-y-4">
              <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-center justify-between">
                <div>
                  <span className="font-bold">
                    {isAr ? 'مراجعة وتعديل القياسات السيفالومترية المستوردة' : 'Cephalometric Normative & Deviation Audit'}
                  </span>
                  <p className="text-[11px] text-blue-700 mt-0.5">
                    {isAr
                      ? 'تحقق من صحة الزوايا والمسافات قبل اعتمادها كبيانات سريرية نهائية في النظام.'
                      : 'Verify angular and linear parameters against clinical standards before doctor approval.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('parse')}
                  className="px-3 py-1 bg-white border border-blue-300 rounded text-blue-700 text-xs font-semibold hover:bg-blue-50"
                >
                  {isAr ? 'استيراد من نص' : 'Paste Text'}
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                      <th className="py-2 px-3 text-start">{isAr ? 'القياس السيفالومتري' : 'Parameter'}</th>
                      <th className="py-2 px-2 text-start">{isAr ? 'المدرسة' : 'School'}</th>
                      <th className="py-2 px-2 text-end font-mono">{isAr ? 'المعيار الطبيعي' : 'Norm ± SD'}</th>
                      <th className="py-2 px-3 text-end font-mono">{isAr ? 'القيمة المستوردة' : 'Imported Value'}</th>
                      <th className="py-2 px-3 text-start">{isAr ? 'الدلالة السريرية' : 'Diagnostic Interpretation'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {CEPHALOMETRIC_DEFINITIONS.map((def) => {
                      const val = measurements[def.code];
                      const hasVal = typeof val === 'number' && !isNaN(val) && isFinite(val);
                      const evalResult = hasVal ? evaluateCephalometricValue(def, val) : null;

                      return (
                        <tr key={def.id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-semibold text-slate-900">
                            <div>{isAr ? `${def.nameAr} (${def.code})` : def.code}</div>
                            <div className="text-[10px] text-slate-500 font-normal">
                              {isAr ? def.nameEn : def.nameAr}
                            </div>
                          </td>
                          <td className="py-2 px-2 text-slate-500">{def.school}</td>
                          <td className="py-2 px-2 text-end font-mono text-slate-600 whitespace-nowrap">
                            {def.normMean} ± {def.normSd} {def.unit}
                          </td>
                          <td className="py-2 px-3 text-end">
                            <div className="inline-flex items-center gap-1">
                              <input
                                type="number"
                                step="0.5"
                                value={hasVal ? val : ''}
                                onChange={(e) => handleMeasurementInputChange(def.code, e.target.value)}
                                placeholder="—"
                                className={`w-20 px-2 py-1 text-end border rounded font-mono font-bold focus:outline-blue-600 ${
                                  hasVal
                                    ? 'border-slate-300 text-slate-900 bg-white'
                                    : 'border-amber-300 text-slate-400 bg-amber-50/30'
                                }`}
                              />
                              <span className="text-[11px] text-slate-500 font-mono w-4">{def.unit}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            {evalResult ? (
                              <span
                                className={`text-[11px] font-medium ${
                                  evalResult.status === 'Significant Deviation'
                                    ? 'text-rose-700'
                                    : evalResult.status === 'Mild Deviation'
                                    ? 'text-amber-700'
                                    : 'text-emerald-700'
                                }`}
                              >
                                {isAr ? evalResult.interpretationAr : evalResult.interpretationEn}
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic">
                                {isAr ? 'غير مسجل (بانتظار الإدخال)' : 'Unrecorded (Pending entry)'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: PASTE TEXT */}
          {activeTab === 'parse' && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <h4 className="text-xs font-bold text-slate-900">
                  {isAr ? 'لصق ملخص قياسات WebCeph النصي' : 'Paste WebCeph Measurements Export'}
                </h4>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  {isAr
                    ? 'انسخ النص أو الجدول من تقرير WebCeph أو تطبيق التحليل والصقه هنا. سيقوم المحرك باستخراج قيم SNA, SNB, ANB, FMA, IMPA, U1-SN وغيرها تلقائياً.'
                    : 'Copy the analysis summary from WebCeph or paste values (e.g., "SNA: 82.5, SNB: 79.0, ANB: 3.5, FMA: 26..."). The parser will match parameters automatically.'}
                </p>
                <textarea
                  rows={6}
                  value={rawTextImport}
                  onChange={(e) => setRawTextImport(e.target.value)}
                  placeholder={
                    isAr
                      ? 'مثال:\nSNA: 82.0\nSNB: 78.5\nANB: 3.5\nFMA: 26.0\nIMPA: 95.0\nU1-SN: 104.0\nWits: 1.0 mm\n...'
                      : 'Example:\nSNA: 82.0\nSNB: 78.5\nANB: 3.5\nFMA: 26.0\nIMPA: 95.0\nU1-SN: 104.0\nWits: 1.0 mm\n...'
                  }
                  className="w-full p-3 text-xs font-mono border border-slate-300 rounded-lg bg-white focus:outline-blue-500"
                />
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handleParseWebCephText}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>{isAr ? 'استخراج وتحليل المعالم الآن' : 'Extract Parameters Now'}</span>
                  </button>
                  {parseMessage && (
                    <span className="text-xs font-medium text-blue-800 bg-blue-100/70 px-3 py-1 rounded">
                      {parseMessage}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 5. Doctor Review & Clinical Approval Gate (Mandatory) */}
          <div className="p-4 bg-amber-50/80 border border-amber-300 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                <ShieldCheck className="w-4 h-4 text-amber-700" />
                <span>{isAr ? 'بوابة المراجعة والاعتماد السريري للأخصائي' : 'Doctor Clinical Verification & Approval Gate'}</span>
              </div>
              <span
                className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded ${
                  isDoctorApproved && doctorReviewer.trim().length > 0
                    ? 'bg-emerald-600 text-white'
                    : 'bg-amber-200 text-amber-900 border border-amber-400'
                }`}
              >
                {isDoctorApproved && doctorReviewer.trim().length > 0
                  ? (isAr ? '● معتمد سريريًا (APPROVED)' : '● CLINICALLY APPROVED')
                  : (isAr ? '▲ مسودة بانتظار الاعتماد' : '▲ PENDING APPROVAL')}
              </span>
            </div>

            <p className="text-[11px] text-amber-800 leading-relaxed">
              {isAr
                ? 'وفقاً لضوابط الدقة السريرية: لن تُعتمد هذه السجلات أو القياسات السيفالومترية المستوردة كمصدر وحيد للحقيقة (SSOT) في ملف المريض إلا بعد المراجعة المباشرة والمصادقة الصريحة من الطبيب المعالج.'
                : 'According to clinical governance: Imported cephalometric assets and values will not become authoritative clinical state until explicitly verified and signed off by the attending clinician.'}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  {isAr ? 'اسم الطبيب المعالج / المراجع (مطلوب):' : 'Reviewing Orthodontist (Required):'}
                </label>
                <input
                  type="text"
                  value={doctorReviewer}
                  onChange={(e) => {
                    setDoctorReviewer(e.target.value);
                    invalidateApproval();
                  }}
                  placeholder={isAr ? 'اسم الطبيب المراجع' : 'Doctor name'}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 font-medium focus:outline-blue-600"
                />
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2.5 p-2 bg-white border border-amber-300 rounded-lg cursor-pointer w-full hover:bg-amber-50/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={isDoctorApproved}
                    onChange={(e) => handleToggleApproval(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                  />
                  <span className="text-xs font-bold text-slate-900">
                    {isAr
                      ? 'أؤكد تدقيقي لهذه السجلات والقياسات وأعتمدها في ملف الحالة'
                      : 'I certify and approve these records for authoritative clinical use'}
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* 6. Footer Actions */}
        <div className="px-6 py-4 bg-slate-100 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            {isAr ? 'إلغاء' : 'Cancel'}
          </button>

          <div className="flex items-center gap-3">
            {!canCommit && (
              <span className="text-[11px] text-amber-700 italic">
                {isAr
                  ? 'يرجى إرفاق أصل واحد أو قياس واحد وتحديد اسم الطبيب مع الإقرار بالاعتماد'
                  : 'Requires at least one asset or measurement, doctor name, and approval certification'}
              </span>
            )}
            <button
              type="button"
              disabled={!canCommit}
              onClick={handleCommit}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
                canCommit
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md'
                  : 'bg-slate-300 text-slate-500 cursor-not-allowed'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isAr ? 'اعتماد وحفظ السجلات في ملف المريض' : 'Approve & Commit to Clinical Case'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

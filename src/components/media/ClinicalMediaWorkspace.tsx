import React from 'react';
import {
  Camera,
  Upload,
  Image as ImageIcon,
  ZoomIn,
  Trash2,
  Edit3,
  Calendar,
  Layers,
  Sparkles,
  CheckCircle2,
  X,
  FileText,
  Eye,
  RefreshCw,
  Plus,
  Maximize2,
  Grid,
  Columns,
  RotateCw,
} from 'lucide-react';
import {
  ClinicalPhotoRecord,
  LanguageMode,
  OrthodonticCase,
  Patient,
  TimepointStage,
} from '../../types/orthodontics';
import { formatPhotoCategory, formatTimepointStage } from '../../utils/i18n';
import { ClinicalRecordIllustration } from '../CephTracingCanvas';

export interface ClinicalMediaWorkspaceProps {
  orthoCase: OrthodonticCase;
  patient: Patient;
  language: LanguageMode;
  onUpdateCase: (updated: OrthodonticCase, auditAction?: string, auditDetails?: string) => void;
}

interface StandardSlotDef {
  key: string;
  category: ClinicalPhotoRecord['category'];
  titleAr: string;
  titleEn: string;
  subtitleAr: string;
  subtitleEn: string;
  group: 'extraoral' | 'intraoral' | 'radiographic';
  aspectRatio: string; // for styling guidance
  iconType: 'face' | 'smile' | 'profile' | 'teeth' | 'arch' | 'xray' | 'cbct';
  svgFallbackType?: string;
}

const STANDARD_SLOTS: StandardSlotDef[] = [
  // 1. Extraoral Facial Photos
  {
    key: 'extraoral_frontal',
    category: 'Extraoral Frontal',
    titleAr: 'صورة الوجه الأمامي بوضع الراحة',
    titleEn: 'Extraoral Frontal at Rest',
    subtitleAr: 'تقييم التناظر الوجهي والأبعاد العمودية والفرجة بين الشفاه',
    subtitleEn: 'Facial symmetry, vertical proportions & interlabial gap',
    group: 'extraoral',
    aspectRatio: 'aspect-[3/4]',
    iconType: 'face',
    svgFallbackType: 'frontal_rest',
  },
  {
    key: 'extraoral_smile',
    category: 'Extraoral Smile',
    titleAr: 'صورة الوجه الأمامي مع الابتسامة',
    titleEn: 'Extraoral Frontal Smiling',
    subtitleAr: 'تقييم خط الابتسامة، قوس الابتسامة وظهور اللثة والقواطع',
    subtitleEn: 'Smile arc, gingival display & incisal display',
    group: 'extraoral',
    aspectRatio: 'aspect-[3/4]',
    iconType: 'smile',
    svgFallbackType: 'frontal_smile',
  },
  {
    key: 'extraoral_profile',
    category: 'Extraoral Profile',
    titleAr: 'صورة المرتسم الجانبي (البروفايل)',
    titleEn: 'Extraoral Profile at Rest',
    subtitleAr: 'تقييم تحدب/تقعر الوجه، الزاوية الأنفية الشفوية وبروز الذقن',
    subtitleEn: 'Profile convexity, nasolabial angle & chin projection',
    group: 'extraoral',
    aspectRatio: 'aspect-[3/4]',
    iconType: 'profile',
    svgFallbackType: 'profile_t0',
  },
  {
    key: 'extraoral_45',
    category: 'Extraoral 45',
    titleAr: 'صورة الوجه مائل 45 درجة (مع الابتسامة)',
    titleEn: 'Extraoral 45° Three-Quarter Smile',
    subtitleAr: 'تقييم ممر الابتسامة ثلاثي الأبعاد وعلاقة الوجنة بالشفاه',
    subtitleEn: '3D smile projection & cheek-lip relationship',
    group: 'extraoral',
    aspectRatio: 'aspect-[3/4]',
    iconType: 'smile',
    svgFallbackType: 'frontal_smile',
  },

  // 2. Intraoral Dental Photos
  {
    key: 'intraoral_frontal',
    category: 'Intraoral Frontal',
    titleAr: 'صورة الإطباق الأمامي المباشر',
    titleEn: 'Intraoral Frontal Occlusion',
    subtitleAr: 'تقييم التغطية العمودية، تطابق الخطوط المتوسطة، والازدحام',
    subtitleEn: 'Overbite, dental midlines alignment & anterior crowding',
    group: 'intraoral',
    aspectRatio: 'aspect-[4/3]',
    iconType: 'teeth',
    svgFallbackType: 'intraoral_t0',
  },
  {
    key: 'intraoral_right',
    category: 'Intraoral Right',
    titleAr: 'صورة الإطباق الجانبي الأيمن',
    titleEn: 'Intraoral Right Buccal Occlusion',
    subtitleAr: 'تقييم الصنف الرحوي والنابي الأيمن والتداخل الحدبي',
    subtitleEn: 'Right molar & canine classification and intercuspation',
    group: 'intraoral',
    aspectRatio: 'aspect-[4/3]',
    iconType: 'teeth',
    svgFallbackType: 'intraoral_t1',
  },
  {
    key: 'intraoral_left',
    category: 'Intraoral Left',
    titleAr: 'صورة الإطباق الجانبي الأيسر',
    titleEn: 'Intraoral Left Buccal Occlusion',
    subtitleAr: 'تقييم الصنف الرحوي والنابي الأيسر والتداخل الحدبي',
    subtitleEn: 'Left molar & canine classification and intercuspation',
    group: 'intraoral',
    aspectRatio: 'aspect-[4/3]',
    iconType: 'teeth',
    svgFallbackType: 'intraoral_t1',
  },
  {
    key: 'upper_occlusal',
    category: 'Upper Occlusal',
    titleAr: 'صورة إطباق القوس العلوي (المرآة)',
    titleEn: 'Maxillary Occlusal Mirror View',
    subtitleAr: 'تقييم شكل القوس العلوي، الازدحام أو المسافات وتناظر الأسنان',
    subtitleEn: 'Maxillary arch form, crowding, spacing & symmetry',
    group: 'intraoral',
    aspectRatio: 'aspect-[4/3]',
    iconType: 'arch',
    svgFallbackType: 'occlusal_upper',
  },
  {
    key: 'lower_occlusal',
    category: 'Lower Occlusal',
    titleAr: 'صورة إطباق القوس السفلي (المرآة)',
    titleEn: 'Mandibular Occlusal Mirror View',
    subtitleAr: 'تقييم شكل القوس السفلي، انحراف القواطع وقوس سبي',
    subtitleEn: 'Mandibular arch form, incisor alignment & curve of Spee',
    group: 'intraoral',
    aspectRatio: 'aspect-[4/3]',
    iconType: 'arch',
    svgFallbackType: 'occlusal_lower',
  },

  // 3. Radiographic Examination
  {
    key: 'lateral_ceph',
    category: 'Lateral Ceph',
    titleAr: 'الأشعة السيفالومترية الجانبية',
    titleEn: 'Lateral Cephalometric Radiograph',
    subtitleAr: 'التحليل الهيكلي السهمي والعمودي وميلان القواطع في الفكين',
    subtitleEn: 'Sagittal & vertical skeletal analysis and incisor torque',
    group: 'radiographic',
    aspectRatio: 'aspect-[4/5]',
    iconType: 'xray',
    svgFallbackType: 'ceph_radiograph',
  },
  {
    key: 'panoramic_xray',
    category: 'Panoramic X-Ray',
    titleAr: 'الأشعة البانورامية (OPG)',
    titleEn: 'Panoramic Radiograph (OPG)',
    subtitleAr: 'فحص الجذور، بزوغ الأسنان المنطمرة، عظم السنخ والمفصل الفكي',
    subtitleEn: 'Root parallelism, impacted teeth, bone height & condyles',
    group: 'radiographic',
    aspectRatio: 'aspect-[16/9]',
    iconType: 'xray',
    svgFallbackType: 'panoramic_radiograph',
  },
  {
    key: 'cbct_3d',
    category: 'CBCT 3D',
    titleAr: 'التصوير المقطعي ثلاثي الأبعاد (CBCT)',
    titleEn: '3D CBCT Reconstructions / Slices',
    subtitleAr: 'تقييم سماكة الصفيحة القشرية، مواقع الزرعات ومجرى التنفس',
    subtitleEn: 'Cortical plate thickness, TAD safe zones & airway volume',
    group: 'radiographic',
    aspectRatio: 'aspect-[16/9]',
    iconType: 'cbct',
    svgFallbackType: 'cbct_slice',
  },
  {
    key: 'periapical_other',
    category: 'Periapical / Other',
    titleAr: 'الأشعة الذروية السنية أو لقطات إضافية',
    titleEn: 'Periapical Radiographs / Additional Views',
    subtitleAr: 'تقييم ذروي مفصل لجذور الأسنان الحرجة أو الأنياب المنطمرة',
    subtitleEn: 'Detailed apical evaluation or localized radiographs',
    group: 'radiographic',
    aspectRatio: 'aspect-[4/3]',
    iconType: 'xray',
    svgFallbackType: 'periapical_xray',
  },
];

export const ClinicalMediaWorkspace: React.FC<ClinicalMediaWorkspaceProps> = ({
  orthoCase,
  patient,
  language,
  onUpdateCase,
}) => {
  const isAr = language === 'ar';
  const [activeStageFilter, setActiveStageFilter] = React.useState<TimepointStage | 'ALL'>('T0_Initial');
  const [viewMode, setViewMode] = React.useState<'grid' | 'comparison'>('grid');
  const [lightboxPhoto, setLightboxPhoto] = React.useState<ClinicalPhotoRecord | null>(null);
  const [editingPhoto, setEditingPhoto] = React.useState<ClinicalPhotoRecord | null>(null);
  const [showAddCustomModal, setShowAddCustomModal] = React.useState<boolean>(false);
  const [dragOverSlotKey, setDragOverSlotKey] = React.useState<string | null>(null);

  // Form state for custom photo modal
  const [customCategory, setCustomCategory] = React.useState<string>('Extraoral Smile');
  const [customStage, setCustomStage] = React.useState<TimepointStage>('T0_Initial');
  const [customDate, setCustomDate] = React.useState<string>(new Date().toISOString().slice(0, 10));
  const [customCaptionEn, setCustomCaptionEn] = React.useState<string>('');
  const [customCaptionAr, setCustomCaptionAr] = React.useState<string>('');
  const [customDataUrl, setCustomDataUrl] = React.useState<string>('');

  // Hidden file input refs for each slot to allow direct click
  const fileInputRefs = React.useRef<Record<string, HTMLInputElement | null>>({});
  const cameraInputRefs = React.useRef<Record<string, HTMLInputElement | null>>({});

  const photos = orthoCase.photos || [];

  // Helper to find photo for a standard slot given the active stage
  const findPhotoForSlot = (slot: StandardSlotDef, stage: TimepointStage): ClinicalPhotoRecord | undefined => {
    return photos.find(
      (p) => p.category.toLowerCase().trim() === slot.category.toLowerCase().trim() && p.stage === stage
    );
  };

  // Convert File to Compressed/Optimized DataURL for durable SQLite/Local storage
  const handleProcessFile = (
    file: File,
    targetCategory: ClinicalPhotoRecord['category'],
    targetStage: TimepointStage,
    slotDef?: StandardSlotDef
  ) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const rawDataUrl = e.target?.result as string;
      if (!rawDataUrl) return;

      // Create an image to measure dimensions & optionally downscale if massive
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1600; // ample resolution for clinical diagnosis while keeping fast storage
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.88);
          commitNewPhoto(optimizedDataUrl, file.name, file.size, targetCategory, targetStage, slotDef);
        } else {
          commitNewPhoto(rawDataUrl, file.name, file.size, targetCategory, targetStage, slotDef);
        }
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  };

  const commitNewPhoto = (
    dataUrl: string,
    fileName: string,
    fileSize: number,
    category: ClinicalPhotoRecord['category'],
    stage: TimepointStage,
    slotDef?: StandardSlotDef
  ) => {
    const existingIndex = photos.findIndex(
      (p) => p.category.toLowerCase().trim() === category.toLowerCase().trim() && p.stage === stage
    );

    const newPhoto: ClinicalPhotoRecord = {
      id: `ph_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      stage,
      date: new Date().toISOString().slice(0, 10),
      category,
      captionEn: slotDef?.subtitleEn || `${category} - ${stage}`,
      captionAr: slotDef?.subtitleAr || `${formatPhotoCategory('ar', category)} - ${formatTimepointStage('ar', stage)}`,
      svgType: slotDef?.svgFallbackType || 'photo_custom',
      dataUrl,
    };

    let updatedPhotos: ClinicalPhotoRecord[];
    if (existingIndex >= 0) {
      // Replace existing photo in slot
      updatedPhotos = [...photos];
      updatedPhotos[existingIndex] = newPhoto;
    } else {
      updatedPhotos = [newPhoto, ...photos];
    }

    onUpdateCase(
      {
        ...orthoCase,
        photos: updatedPhotos,
      },
      'Attached Clinical Photo / Radiograph',
      `${category} (${stage}) - ${fileName}`
    );
  };

  const handleDeletePhoto = (photoId: string) => {
    const target = photos.find((p) => p.id === photoId);
    if (!target) return;
    if (
      !window.confirm(
        isAr
          ? `هل أنت متأكد من حذف هذه الصورة السريرية (${formatPhotoCategory('ar', target.category)})؟`
          : `Are you sure you want to delete this clinical image (${target.category})?`
      )
    ) {
      return;
    }

    const updated = photos.filter((p) => p.id !== photoId);
    onUpdateCase(
      { ...orthoCase, photos: updated },
      'Deleted Clinical Photo',
      `${target.category} (${target.stage})`
    );
    if (lightboxPhoto?.id === photoId) {
      setLightboxPhoto(null);
    }
  };

  const handleSavePhotoNotes = (photoId: string, en: string, ar: string) => {
    const updated = photos.map((p) => (p.id === photoId ? { ...p, captionEn: en, captionAr: ar } : p));
    onUpdateCase(
      { ...orthoCase, photos: updated },
      'Updated Clinical Image Caption',
      `Photo ${photoId} notes revised`
    );
    setEditingPhoto(null);
  };

  const handleLoadSampleSeries = () => {
    // Generates a complete standard orthodontic clinical series for testing/demonstration
    const sampleSeries: ClinicalPhotoRecord[] = [
      {
        id: `ph_sample_1`,
        stage: 'T0_Initial',
        date: orthoCase.startDate || '2025-02-12',
        category: 'Extraoral Frontal',
        captionEn: 'Pre-treatment frontal view at rest: Balanced facial symmetry, relaxed lip posture.',
        captionAr: 'صورة أمامية بوضع الراحة قبل العلاج: تناسق وجهي متوازن مع وضع شفوي طبيعي.',
        svgType: 'frontal_rest',
      },
      {
        id: `ph_sample_2`,
        stage: 'T0_Initial',
        date: orthoCase.startDate || '2025-02-12',
        category: 'Extraoral Smile',
        captionEn: 'Pre-treatment smile view: Flat smile arc with 3.5mm gingival display and upper crowding.',
        captionAr: 'صورة أمامية مع الابتسامة: قوس ابتسامة مستوٍ مع ظهور لثوي 3.5 ملم وازدحام علوي.',
        svgType: 'frontal_smile',
      },
      {
        id: `ph_sample_3`,
        stage: 'T0_Initial',
        date: orthoCase.startDate || '2025-02-12',
        category: 'Extraoral Profile',
        captionEn: 'Pre-treatment profile: Convex facial profile with acute nasolabial angle (86°).',
        captionAr: 'صورة المرتسم الجانبي قبل العلاج: تحدب وجهي ملحوظ وزاوية أنفية شفوية حادة.',
        svgType: 'profile_t0',
      },
      {
        id: `ph_sample_4`,
        stage: 'T0_Initial',
        date: orthoCase.startDate || '2025-02-12',
        category: 'Intraoral Frontal',
        captionEn: 'Pre-treatment intraoral: 6.5mm upper crowding, blocked canines, 1.5mm lower midline deviation.',
        captionAr: 'إطباق أمامي قبل العلاج: ازدحام علوي 6.5 ملم مع انحراف خط الوسط السفلي 1.5 ملم.',
        svgType: 'intraoral_t0',
      },
      {
        id: `ph_sample_5`,
        stage: 'T0_Initial',
        date: orthoCase.startDate || '2025-02-12',
        category: 'Intraoral Right',
        captionEn: 'Pre-treatment right buccal: Half-cusp Class II molar and canine relationship.',
        captionAr: 'إطباق جانبي أيمن قبل العلاج: علاقة رحوية ونابية صنف ثانٍ نصف حدبة.',
        svgType: 'intraoral_t1',
      },
      {
        id: `ph_sample_6`,
        stage: 'T0_Initial',
        date: orthoCase.startDate || '2025-02-12',
        category: 'Intraoral Left',
        captionEn: 'Pre-treatment left buccal: Half-cusp Class II with blocked out canine.',
        captionAr: 'إطباق جانبي أيسر قبل العلاج: علاقة صنف ثانٍ مع ناب مسدود دهليزياً.',
        svgType: 'intraoral_t1',
      },
      {
        id: `ph_sample_7`,
        stage: 'T0_Initial',
        date: orthoCase.startDate || '2025-02-12',
        category: 'Upper Occlusal',
        captionEn: 'Pre-treatment upper occlusal: Tapered arch form with moderate anterior crowding.',
        captionAr: 'قوس علوي قبل العلاج: شكل قوس مستدق وازدحام في القواطع.',
        svgType: 'occlusal_upper',
      },
      {
        id: `ph_sample_8`,
        stage: 'T0_Initial',
        date: orthoCase.startDate || '2025-02-12',
        category: 'Lower Occlusal',
        captionEn: 'Pre-treatment lower occlusal: Ovoid arch form with 5mm anterior crowding.',
        captionAr: 'قوس سفلي قبل العلاج: شكل قوس بيضوي مع ازدحام أمامي 5 ملم.',
        svgType: 'occlusal_lower',
      },
      {
        id: `ph_sample_9`,
        stage: 'T0_Initial',
        date: orthoCase.startDate || '2025-02-12',
        category: 'Lateral Ceph',
        captionEn: 'Baseline lateral cephalogram: Mandibular retrognathism, ANB 5.5°, proclined incisors.',
        captionAr: 'أشعة سيفالومترية أولية: تراجع الفك السفلي، زاوية ANB 5.5° وبروز القواطع.',
        svgType: 'ceph_radiograph',
      },
      {
        id: `ph_sample_10`,
        stage: 'T0_Initial',
        date: orthoCase.startDate || '2025-02-12',
        category: 'Panoramic X-Ray',
        captionEn: 'Baseline panoramic radiograph: Full permanent dentition, healthy condyles, developing third molars.',
        captionAr: 'أشعة بانورامية أولية: أسنان دائمة كاملة مع براعم أضراس العقل وسلامة اللقم الفكية.',
        svgType: 'panoramic_radiograph',
      },
      // Stage T3 Finals for Comparison
      {
        id: `ph_sample_11`,
        stage: 'T3_Final',
        date: '2026-08-25',
        category: 'Extraoral Smile',
        captionEn: 'Final smile view: Consonant smile arc, ideal smile symmetry, normalized gingival display.',
        captionAr: 'صورة الابتسامة النهائية: قوس ابتسامة متناغم وتناسق مثالي بعد تصحيح البروز.',
        svgType: 'frontal_smile',
      },
      {
        id: `ph_sample_12`,
        stage: 'T3_Final',
        date: '2026-08-25',
        category: 'Extraoral Profile',
        captionEn: 'Final profile view: Harmonious orthognathic profile, competent lip seal, normalized nasolabial angle (101°).',
        captionAr: 'المرتسم الجانبي النهائي: تناسق وجهي مستقيم وإغلاق شفوي بدون إجهاد (101°).',
        svgType: 'profile_t3',
      },
      {
        id: `ph_sample_13`,
        stage: 'T3_Final',
        date: '2026-08-25',
        category: 'Intraoral Frontal',
        captionEn: 'Final intraoral frontal: Ideal overjet (2.2mm), overbite (2.0mm), coincident dental midlines.',
        captionAr: 'إطباق أمامي نهائي: بروز مثالي 2.2 ملم، تغطية 2.0 ملم، وتطابق الخطوط المتوسطة.',
        svgType: 'intraoral_t3',
      },
    ];

    onUpdateCase(
      {
        ...orthoCase,
        photos: [...sampleSeries, ...photos.filter((p) => !sampleSeries.some((s) => s.category === p.category && s.stage === p.stage))],
      },
      'Loaded Sample Clinical Photography Series',
      'Standard 10-view orthodontic clinical series populated'
    );
  };

  // Helper to render an individual photo slot card ("المربع")
  const renderSlotCard = (slot: StandardSlotDef) => {
    // If activeStageFilter is ALL, look for T0 then T1 then T3; otherwise use exact stage
    const targetStage: TimepointStage = activeStageFilter === 'ALL' ? 'T0_Initial' : activeStageFilter;
    const photo = findPhotoForSlot(slot, targetStage);
    const isDragOver = dragOverSlotKey === `${slot.key}_${targetStage}`;

    return (
      <div
        key={slot.key}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverSlotKey(`${slot.key}_${targetStage}`);
        }}
        onDragLeave={() => setDragOverSlotKey(null)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOverSlotKey(null);
          const droppedFile = e.dataTransfer.files?.[0];
          if (droppedFile) {
            handleProcessFile(droppedFile, slot.category, targetStage, slot);
          }
        }}
        className={`group relative bg-white rounded-xl border transition-all flex flex-col justify-between overflow-hidden shadow-xs hover:shadow-md ${
          photo
            ? 'border-slate-300 ring-1 ring-slate-200'
            : isDragOver
            ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-400 border-dashed'
            : 'border-dashed border-slate-300 hover:border-slate-400 bg-slate-50/50'
        }`}
      >
        {/* Hidden File Input for Browse */}
        <input
          type="file"
          accept="image/*"
          ref={(el) => {
            fileInputRefs.current[`${slot.key}_${targetStage}`] = el;
          }}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleProcessFile(f, slot.category, targetStage, slot);
            e.target.value = '';
          }}
        />

        {/* Hidden Camera Input for Tablet Direct Capture */}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          ref={(el) => {
            cameraInputRefs.current[`${slot.key}_${targetStage}`] = el;
          }}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleProcessFile(f, slot.category, targetStage, slot);
            e.target.value = '';
          }}
        />

        {/* Card Header */}
        <div className="p-3 border-b border-slate-100 flex items-center justify-between gap-2 bg-white/80">
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-slate-900 truncate">
              {isAr ? slot.titleAr : slot.titleEn}
            </h4>
            <p className="text-[10px] text-slate-500 truncate">
              {isAr ? slot.subtitleAr : slot.subtitleEn}
            </p>
          </div>

          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold shrink-0 ${
              photo
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-slate-100 text-slate-500 border border-slate-200'
            }`}
          >
            {formatTimepointStage(language, targetStage)}
          </span>
        </div>

        {/* Image Frame / Dropzone Body */}
        <div className={`relative w-full ${slot.aspectRatio} bg-slate-900 flex items-center justify-center overflow-hidden`}>
          {photo ? (
            <>
              {photo.integrityStatus && photo.integrityStatus !== 'VALID' && (
                <div
                  className="absolute top-2 left-2 z-20 bg-red-600/95 text-white text-[9px] font-bold px-2 py-1 rounded shadow flex items-center gap-1 backdrop-blur-xs"
                  title={photo.integrityError || (photo.integrityStatus === 'CORRUPT' ? 'Corrupt Binary / Checksum Mismatch' : 'Binary File Missing')}
                >
                  <span>⚠️ {photo.integrityStatus}: {isAr ? 'خطأ سلامة البيانات السريرية' : 'Integrity Error'}</span>
                </div>
              )}
              {photo.dataUrl ? (
                <img
                  src={photo.dataUrl}
                  alt={isAr ? slot.titleAr : slot.titleEn}
                  className="w-full h-full object-cover select-none cursor-pointer"
                  onClick={() => setLightboxPhoto(photo)}
                />
              ) : (
                <div
                  className="w-full h-full cursor-pointer flex items-center justify-center"
                  onClick={() => setLightboxPhoto(photo)}
                >
                  <ClinicalRecordIllustration
                    svgType={photo.svgType}
                    stage={photo.stage}
                    category={photo.category}
                  />
                </div>
              )}

              {/* Hover / Tap Action Overlay */}
              <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-3 text-white backdrop-blur-xs">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setLightboxPhoto(photo)}
                    title={isAr ? 'معاينة مكبرة' : 'Zoom In'}
                    className="p-2 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRefs.current[`${slot.key}_${targetStage}`]?.click()}
                    title={isAr ? 'استبدال الصورة' : 'Replace Photo'}
                    className="p-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingPhoto(photo)}
                    title={isAr ? 'تعديل الملاحظات السريرية' : 'Edit Notes'}
                    className="p-2 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeletePhoto(photo.id)}
                    title={isAr ? 'حذف الصورة' : 'Delete Photo'}
                    className="p-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <span className="text-[10px] text-slate-300 font-medium">
                  {isAr ? 'انقر لتكبير الصورة وتفاصيلها' : 'Click to inspect in full resolution'}
                </span>
              </div>
            </>
          ) : (
            // EMPTY STATE: Clinical Action Dropzone
            <div className="p-4 text-center flex flex-col items-center justify-center gap-2.5 w-full h-full bg-slate-900/50">
              <div className="w-10 h-10 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center group-hover:scale-105 group-hover:bg-blue-900/40 group-hover:text-blue-400 transition-all">
                <Camera className="w-5 h-5" />
              </div>

              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-slate-200">
                  {isAr ? 'مربع فارغ — أضف الصورة' : 'Slot Empty — Add Image'}
                </p>
                <p className="text-[10px] text-slate-400 max-w-[190px]">
                  {isAr ? 'اسحب الصورة هنا أو اختر طريقة الإضافة' : 'Drag & drop image here or choose'}
                </p>
              </div>

              {/* Dual Action Buttons: File Browse or Camera */}
              <div className="flex items-center gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => fileInputRefs.current[`${slot.key}_${targetStage}`]?.click()}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-md shadow-xs transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isAr ? 'رفع ملف' : 'Upload'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => cameraInputRefs.current[`${slot.key}_${targetStage}`]?.click()}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 active:bg-slate-950 rounded-md border border-slate-700 transition-colors"
                >
                  <Camera className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{isAr ? 'الكاميرا' : 'Camera'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Card Footer: Metadata & Captions */}
        <div className="p-3 bg-white space-y-1.5 border-t border-slate-100">
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span className="flex items-center gap-1 font-mono text-[10px]">
              <Calendar className="w-3 h-3 text-slate-400" />
              <span>{photo?.date || orthoCase.startDate}</span>
            </span>
            <span className="font-semibold text-slate-700 text-[10px]">
              {photo ? (
                <span className="text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  {isAr ? 'صورة معتمدة' : 'Attached'}
                </span>
              ) : (
                <span className="text-slate-400 italic">{isAr ? 'بانتظار السجل' : 'Pending'}</span>
              )}
            </span>
          </div>

          <p className="text-[11px] text-slate-600 leading-relaxed line-clamp-2" title={photo ? (isAr ? photo.captionAr : photo.captionEn) : ''}>
            {photo
              ? isAr
                ? photo.captionAr || photo.captionEn
                : photo.captionEn || photo.captionAr
              : isAr
              ? slot.subtitleAr
              : slot.subtitleEn}
          </p>
        </div>
      </div>
    );
  };

  const extraoralSlots = STANDARD_SLOTS.filter((s) => s.group === 'extraoral');
  const intraoralSlots = STANDARD_SLOTS.filter((s) => s.group === 'intraoral');
  const radiographicSlots = STANDARD_SLOTS.filter((s) => s.group === 'radiographic');

  return (
    <div className="space-y-6">
      {/* 1. TOP HEADER & WORKSPACE CONTROL BAR */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-blue-50 text-blue-700 rounded-lg">
                <Camera className="w-5 h-5" />
              </div>
              <h2 className="text-base font-bold text-slate-900">
                {isAr
                  ? 'السجلات المصورة والشعاعية للوجه والأسنان (Clinical Photography & Radiographs)'
                  : 'Orthodontic Clinical Photography, Radiographs & 3D Imaging'}
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              {isAr
                ? 'مربعات منظمة ومعايرة لإرفاق الصور السريرية خارج وداخل الفموية والأشعة التشخيصية عبر مراحل العلاج.'
                : 'Standardized slot matrix for photographic views, panoramic OPG, lateral cephalograms, and CBCT scans.'}
            </p>
          </div>

          {/* Global Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleLoadSampleSeries}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors min-h-[40px]"
            >
              <Sparkles className="w-4 h-4 text-amber-500" />
              <span>{isAr ? 'تحميل صور نموذجية' : 'Load Sample Series'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowAddCustomModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs transition-colors min-h-[40px]"
            >
              <Plus className="w-4 h-4 text-cyan-400" />
              <span>{isAr ? '+ إضافة صورة / أشعة حرة' : '+ Add Custom Media'}</span>
            </button>
          </div>
        </div>

        {/* 2. STAGE FILTER TABS & VIEW MODE */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* Stage Selector */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
            {(
              [
                { id: 'T0_Initial', labelAr: 'قبل العلاج (T0 Initial)', labelEn: 'T0 Initial' },
                { id: 'T1_Progress', labelAr: 'أثناء العلاج (T1 Progress)', labelEn: 'T1 Progress' },
                { id: 'T3_Final', labelAr: 'النتيجة النهائية (T3 Final)', labelEn: 'T3 Final' },
                { id: 'T4_Retention', labelAr: 'التثبيت (T4 Retention)', labelEn: 'T4 Retention' },
                { id: 'ALL', labelAr: 'جميع السجلات (All)', labelEn: 'All Stages' },
              ] as { id: TimepointStage | 'ALL'; labelAr: string; labelEn: string }[]
            ).map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setActiveStageFilter(st.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  activeStageFilter === st.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {isAr ? st.labelAr : st.labelEn}
              </button>
            ))}
          </div>

          {/* View Mode Switcher: Grid vs Comparison */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                viewMode === 'grid'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              <span>{isAr ? 'مربعات السجلات' : 'Slot Grid'}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('comparison')}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                viewMode === 'comparison'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              <span>{isAr ? 'مقارنة قبل وبعد (T0 vs T3)' : 'T0 vs T3 Compare'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3. VIEW MODE: STANDARD SLOT GRID */}
      {viewMode === 'grid' && (
        <div className="space-y-8">
          {/* SECTION 1: EXTRAORAL FACIAL PHOTOGRAPHY */}
          <section className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
                <h3 className="text-sm font-bold text-slate-900">
                  {isAr
                    ? 'أولاً: صور الوجه خارج الفم (Extraoral Facial Series - 4 لقطات معيارية)'
                    : '1. Extraoral Facial Photography (4 Standard Orthodontic Views)'}
                </h3>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {extraoralSlots.filter((s) => findPhotoForSlot(s, activeStageFilter === 'ALL' ? 'T0_Initial' : activeStageFilter)).length} / {extraoralSlots.length}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {extraoralSlots.map(renderSlotCard)}
            </div>
          </section>

          {/* SECTION 2: INTRAORAL DENTAL PHOTOGRAPHY */}
          <section className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
                <h3 className="text-sm font-bold text-slate-900">
                  {isAr
                    ? 'ثانياً: صور الأسنان وداخل الفم (Intraoral Dental Series - 5 لقطات معيارية)'
                    : '2. Intraoral Dental Photography (5 Standard Views: Frontal, Right, Left, Arches)'}
                </h3>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {intraoralSlots.filter((s) => findPhotoForSlot(s, activeStageFilter === 'ALL' ? 'T0_Initial' : activeStageFilter)).length} / {intraoralSlots.length}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {intraoralSlots.map(renderSlotCard)}
            </div>
          </section>

          {/* SECTION 3: RADIOGRAPHIC EXAMINATION & 3D CBCT */}
          <section className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-violet-600"></span>
                <h3 className="text-sm font-bold text-slate-900">
                  {isAr
                    ? 'ثالثاً: الصور والأشعة التشخيصية (Diagnostic Radiographs & 3D CBCT)'
                    : '3. Diagnostic Radiographs & 3D Imaging (Cephalometric, Panoramic, CBCT)'}
                </h3>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {radiographicSlots.filter((s) => findPhotoForSlot(s, activeStageFilter === 'ALL' ? 'T0_Initial' : activeStageFilter)).length} / {radiographicSlots.length}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {radiographicSlots.map(renderSlotCard)}
            </div>
          </section>
        </div>
      )}

      {/* 4. VIEW MODE: BEFORE VS AFTER COMPARISON (T0 vs T3) */}
      {viewMode === 'comparison' && (
        <div className="space-y-6">
          <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl flex items-center justify-between text-xs text-blue-900">
            <div>
              <span className="font-bold">
                {isAr ? 'مقارنة مزدوجة متقابلة: قبل العلاج (T0) مقابل النتيجة النهائية (T3)' : 'Dual Comparison: Initial Baseline (T0) vs Final Result (T3)'}
              </span>
              <p className="text-[11px] text-blue-700 mt-0.5">
                {isAr
                  ? 'عرض مقارن مباشر للقطات الوجه والأسنان والأشعة لتتبع التغيرات السريرية والتحسن الجمالي.'
                  : 'Direct side-by-side view for soft tissue profile, smile arc, and dental alignment evaluation.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[
              { cat: 'Extraoral Smile', titleAr: 'الابتسامة الوجهية', titleEn: 'Frontal Smile Arc' },
              { cat: 'Extraoral Profile', titleAr: 'المرتسم الجانبي (البروفايل)', titleEn: 'Profile Convexity' },
              { cat: 'Intraoral Frontal', titleAr: 'الإطباق السني الأمامي', titleEn: 'Frontal Incisor Occlusion' },
              { cat: 'Lateral Ceph', titleAr: 'الأشعة السيفالومترية', titleEn: 'Lateral Cephalogram' },
            ].map((compItem) => {
              const t0 = photos.find((p) => p.category === compItem.cat && p.stage === 'T0_Initial');
              const t3 = photos.find((p) => p.category === compItem.cat && p.stage === 'T3_Final');

              return (
                <div key={compItem.cat} className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
                  <h4 className="text-xs font-bold text-slate-900 border-b border-slate-100 pb-2">
                    {isAr ? compItem.titleAr : compItem.titleEn}
                  </h4>

                  <div className="grid grid-cols-2 gap-3">
                    {/* T0 Card */}
                    <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-900 flex flex-col">
                      <div className="px-2.5 py-1 bg-amber-500/20 text-amber-300 font-mono text-[10px] font-bold flex justify-between">
                        <span>{isAr ? 'قبل العلاج (T0)' : 'Initial (T0)'}</span>
                        <span>{t0?.date || '—'}</span>
                      </div>
                      <div className="aspect-[4/3] flex items-center justify-center overflow-hidden">
                        {t0 ? (
                          t0.dataUrl ? (
                            <img src={t0.dataUrl} alt="T0" className="w-full h-full object-cover" />
                          ) : (
                            <ClinicalRecordIllustration svgType={t0.svgType} stage={t0.stage} category={t0.category} />
                          )
                        ) : (
                          <span className="text-[11px] text-slate-500 italic">{isAr ? 'لا توجد صورة T0' : 'No T0 record'}</span>
                        )}
                      </div>
                    </div>

                    {/* T3 Card */}
                    <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-900 flex flex-col">
                      <div className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 font-mono text-[10px] font-bold flex justify-between">
                        <span>{isAr ? 'النتيجة (T3)' : 'Final (T3)'}</span>
                        <span>{t3?.date || '—'}</span>
                      </div>
                      <div className="aspect-[4/3] flex items-center justify-center overflow-hidden">
                        {t3 ? (
                          t3.dataUrl ? (
                            <img src={t3.dataUrl} alt="T3" className="w-full h-full object-cover" />
                          ) : (
                            <ClinicalRecordIllustration svgType={t3.svgType} stage={t3.stage} category={t3.category} />
                          )
                        ) : (
                          <span className="text-[11px] text-slate-500 italic">{isAr ? 'لا توجد صورة T3' : 'No T3 record'}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. LIGHTBOX MODAL (معاينة مكبرة كاملة) */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4 backdrop-blur-sm"
          onClick={() => setLightboxPhoto(null)}
        >
          <div
            className="relative max-w-4xl w-full bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between text-white">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-blue-600 text-white">
                    {formatTimepointStage(language, lightboxPhoto.stage)}
                  </span>
                  <h3 className="text-sm font-bold">
                    {formatPhotoCategory(language, lightboxPhoto.category)}
                  </h3>
                </div>
                <p className="text-[11px] text-slate-400 font-mono">
                  {lightboxPhoto.date} · {orthoCase.id} · {isAr ? patient.fullNameAr : patient.fullNameEn}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLightboxPhoto(null)}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Image Body */}
            <div className="relative max-h-[70vh] flex items-center justify-center p-4 bg-black/50 overflow-hidden">
              {lightboxPhoto.dataUrl ? (
                <img
                  src={lightboxPhoto.dataUrl}
                  alt={lightboxPhoto.category}
                  className="max-h-[65vh] w-auto max-w-full object-contain rounded"
                />
              ) : (
                <div className="w-full max-w-xl">
                  <ClinicalRecordIllustration
                    svgType={lightboxPhoto.svgType}
                    stage={lightboxPhoto.stage}
                    category={lightboxPhoto.category}
                  />
                </div>
              )}
            </div>

            {/* Modal Footer / Notes */}
            <div className="p-4 border-t border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-3 text-xs">
              <p className="text-slate-300 leading-relaxed max-w-2xl">
                {isAr
                  ? lightboxPhoto.captionAr || lightboxPhoto.captionEn
                  : lightboxPhoto.captionEn || lightboxPhoto.captionAr}
              </p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const p = lightboxPhoto;
                    setLightboxPhoto(null);
                    setEditingPhoto(p);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
                >
                  {isAr ? 'تعديل الملاحظات' : 'Edit Caption'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeletePhoto(lightboxPhoto.id)}
                  className="px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-white text-xs font-semibold"
                >
                  {isAr ? 'حذف' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. EDIT CAPTION MODAL */}
      {editingPhoto && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 max-w-md w-full shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                {isAr ? 'تعديل الملاحظات السريرية للصورة' : 'Edit Clinical Photo Caption'}
              </h3>
              <button
                type="button"
                onClick={() => setEditingPhoto(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  {isAr ? 'الوصف السريري (بالعربية)' : 'Clinical Caption (Arabic)'}
                </label>
                <textarea
                  rows={3}
                  dir="rtl"
                  value={editingPhoto.captionAr}
                  onChange={(e) => setEditingPhoto({ ...editingPhoto, captionAr: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  {isAr ? 'الوصف السريري (بالإنجليزية)' : 'Clinical Caption (English)'}
                </label>
                <textarea
                  rows={3}
                  value={editingPhoto.captionEn}
                  onChange={(e) => setEditingPhoto({ ...editingPhoto, captionEn: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingPhoto(null)}
                className="px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => handleSavePhotoNotes(editingPhoto.id, editingPhoto.captionEn, editingPhoto.captionAr)}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                {isAr ? 'حفظ التعديلات' : 'Save Notes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. ADD CUSTOM MEDIA MODAL (+ إضافة صورة حرة) */}
      {showAddCustomModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-50 text-blue-700 rounded-lg">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">
                  {isAr ? 'إضافة صورة أو أشعة سريرية جديدة' : 'Add New Clinical Photo or Radiograph'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddCustomModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    {isAr ? 'المرحلة الزمنية' : 'Stage'}
                  </label>
                  <select
                    value={customStage}
                    onChange={(e) => setCustomStage(e.target.value as TimepointStage)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="T0_Initial">{formatTimepointStage(language, 'T0_Initial')}</option>
                    <option value="T1_Progress">{formatTimepointStage(language, 'T1_Progress')}</option>
                    <option value="T2_PreFinishing">{formatTimepointStage(language, 'T2_PreFinishing')}</option>
                    <option value="T3_Final">{formatTimepointStage(language, 'T3_Final')}</option>
                    <option value="T4_Retention">{formatTimepointStage(language, 'T4_Retention')}</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    {isAr ? 'تاريخ الالتقاط' : 'Date'}
                  </label>
                  <input
                    type="date"
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  {isAr ? 'تصنيف السجل السريري' : 'Category'}
                </label>
                <select
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <optgroup label={isAr ? 'صور الوجه خارج الفم' : 'Extraoral Views'}>
                    <option value="Extraoral Frontal">Extraoral Frontal at Rest</option>
                    <option value="Extraoral Smile">Extraoral Frontal Smiling</option>
                    <option value="Extraoral Profile">Extraoral Profile at Rest</option>
                    <option value="Extraoral 45">Extraoral 45° Three-Quarter Smile</option>
                  </optgroup>
                  <optgroup label={isAr ? 'صور الأسنان وداخل الفم' : 'Intraoral Views'}>
                    <option value="Intraoral Frontal">Intraoral Frontal Occlusion</option>
                    <option value="Intraoral Right">Intraoral Right Buccal</option>
                    <option value="Intraoral Left">Intraoral Left Buccal</option>
                    <option value="Upper Occlusal">Maxillary Occlusal</option>
                    <option value="Lower Occlusal">Mandibular Occlusal</option>
                  </optgroup>
                  <optgroup label={isAr ? 'الصور الشعاعية والـ CBCT' : 'Radiographs'}>
                    <option value="Lateral Ceph">Lateral Cephalometric</option>
                    <option value="Panoramic X-Ray">Panoramic Radiograph (OPG)</option>
                    <option value="CBCT 3D">CBCT 3D Volume / Slices</option>
                    <option value="Periapical / Other">Periapical / Custom</option>
                  </optgroup>
                </select>
              </div>

              {/* Upload Dropzone */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  {isAr ? 'ملف الصورة أو الأشعة' : 'Image File'}
                </label>
                <div className="border border-dashed border-slate-300 rounded-xl p-4 text-center bg-slate-50/50 hover:bg-slate-50 transition-colors">
                  {customDataUrl ? (
                    <div className="space-y-2">
                      <img src={customDataUrl} alt="Preview" className="max-h-36 mx-auto rounded-lg object-contain shadow-xs" />
                      <button
                        type="button"
                        onClick={() => setCustomDataUrl('')}
                        className="text-[11px] text-red-600 font-semibold hover:underline"
                      >
                        {isAr ? 'إزالة واختيار ملف آخر' : 'Remove & choose another'}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <ImageIcon className="w-8 h-8 text-slate-400 mx-auto" />
                      <div className="text-[11px] text-slate-600">
                        <label className="text-blue-700 font-semibold cursor-pointer hover:underline">
                          <span>{isAr ? 'استعراض واختيار ملف' : 'Browse file'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) {
                                const r = new FileReader();
                                r.onload = (ev) => setCustomDataUrl(ev.target?.result as string);
                                r.readAsDataURL(f);
                              }
                            }}
                          />
                        </label>
                        <span className="mx-1">{isAr ? 'أو التقاط بكاميرا الجهاز' : 'or capture'}</span>
                      </div>
                      <p className="text-[10px] text-slate-400">JPEG, PNG, WebP up to 15MB</p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  {isAr ? 'الملاحظة السريرية (عربي)' : 'Notes (Arabic)'}
                </label>
                <input
                  type="text"
                  dir="rtl"
                  placeholder={isAr ? 'مثال: صورة إطباق بعد تركيب زرعات الإرساء الهيكلي' : 'e.g. Post-TAD placement'}
                  value={customCaptionAr}
                  onChange={(e) => setCustomCaptionAr(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  {isAr ? 'الملاحظة السريرية (إنجليزي)' : 'Notes (English)'}
                </label>
                <input
                  type="text"
                  placeholder="e.g. En-masse anterior retraction progress"
                  value={customCaptionEn}
                  onChange={(e) => setCustomCaptionEn(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowAddCustomModal(false)}
                className="px-3.5 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={!customDataUrl}
                onClick={() => {
                  const newRec: ClinicalPhotoRecord = {
                    id: `ph_${Date.now()}_custom`,
                    stage: customStage,
                    date: customDate,
                    category: customCategory as ClinicalPhotoRecord['category'],
                    captionEn: customCaptionEn || `${customCategory} - ${customStage}`,
                    captionAr: customCaptionAr || `${formatPhotoCategory('ar', customCategory)} - ${formatTimepointStage('ar', customStage)}`,
                    svgType: 'photo_custom',
                    dataUrl: customDataUrl,
                  };
                  onUpdateCase(
                    { ...orthoCase, photos: [newRec, ...photos] },
                    'Added Custom Photo Record',
                    `${customCategory} (${customStage})`
                  );
                  setShowAddCustomModal(false);
                  setCustomDataUrl('');
                  setCustomCaptionAr('');
                  setCustomCaptionEn('');
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg shadow-xs transition-colors"
              >
                {isAr ? 'حفظ السجل' : 'Save Image'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

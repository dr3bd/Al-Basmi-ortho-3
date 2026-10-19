import React from 'react';
import {
  X,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  Crop,
  Sun,
  Sliders,
  Type,
  PenTool,
  ArrowRight,
  Square,
  Circle as CircleIcon,
  Minus,
  Undo2,
  Redo2,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
  Trash2,
  Sparkles,
  ShieldAlert,
  Move,
  Maximize2,
  SeparatorVertical,
  SeparatorHorizontal,
  Compass,
  RefreshCw,
} from 'lucide-react';
import {
  ApprovedImageDerivative,
  ClinicalPhotoRecord,
  ImageAnnotationItem,
  ImageAnnotationType,
  ImageEditingRecipe,
  ImageTransformParams,
  LanguageMode,
  OrthodonticCase,
  Patient,
} from '../../types/orthodontics';
import {
  applyClinicalImageAdjustments,
  createVerticalReferenceGeometry,
  createHorizontalReferenceGeometry,
} from '../../utils/imageAdjustments';

export interface ClinicalImageEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  photo: ClinicalPhotoRecord | null;
  patient: Patient;
  orthoCase: OrthodonticCase;
  language: LanguageMode;
  onSaveDerivative: (derivative: ApprovedImageDerivative) => Promise<void>;
}

const DEFAULT_TRANSFORM: ImageTransformParams = {
  crop: null,
  rotation: 0,
  flipH: false,
  flipV: false,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  grayscale: false,
  sharpness: 0,
};

const COLOR_PRESETS = [
  { name: 'Red', hex: '#ef4444' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'White', hex: '#ffffff' },
];

export const ClinicalImageEditorModal: React.FC<ClinicalImageEditorModalProps> = ({
  isOpen,
  onClose,
  photo,
  patient,
  orthoCase,
  language,
  onSaveDerivative,
}) => {
  const isAr = language === 'ar';

  // Active Tool & Mode
  const [activeTab, setActiveTab] = React.useState<'transform' | 'adjustments' | 'annotate' | 'compare'>('transform');
  const [activeAnnotationTool, setActiveAnnotationTool] = React.useState<ImageAnnotationType | 'select'>('freehand');
  const [annotationColor, setAnnotationColor] = React.useState<string>('#ef4444');
  const [annotationStrokeWidth, setAnnotationStrokeWidth] = React.useState<number>(4);
  const [selectedAnnotationId, setSelectedAnnotationId] = React.useState<string | null>(null);

  // Editor State
  const [transform, setTransform] = React.useState<ImageTransformParams>(DEFAULT_TRANSFORM);
  const [annotations, setAnnotations] = React.useState<ImageAnnotationItem[]>([]);

  // Undo/Redo Stack
  const [history, setHistory] = React.useState<{ transform: ImageTransformParams; annotations: ImageAnnotationItem[] }[]>([
    { transform: DEFAULT_TRANSFORM, annotations: [] },
  ]);
  const [historyIndex, setHistoryIndex] = React.useState<number>(0);

  // Crop Engine State (normalized 0..100 percentages)
  const [isCropping, setIsCropping] = React.useState<boolean>(false);
  const [cropMode, setCropMode] = React.useState<'free' | 'fixed'>('free');
  const [cropBox, setCropBox] = React.useState<{ x: number; y: number; width: number; height: number }>({
    x: 10,
    y: 10,
    width: 80,
    height: 80,
  });
  const [cropHandleDragging, setCropHandleDragging] = React.useState<
    'NW' | 'NE' | 'SW' | 'SE' | 'N' | 'S' | 'E' | 'W' | 'CENTER' | null
  >(null);
  const cropStartPosRef = React.useRef<{
    x: number;
    y: number;
    cropBox: { x: number; y: number; width: number; height: number };
  } | null>(null);

  // Comparison State
  const [showOriginalComparison, setShowOriginalComparison] = React.useState<boolean>(false);

  // Orthodontic Reference Line Drag State
  const [refLineDragging, setRefLineDragging] = React.useState<{
    annotationId: string;
    handle: 'P1' | 'P2' | 'CENTER';
    startX: number;
    startY: number;
    origX1: number;
    origY1: number;
    origX2: number;
    origY2: number;
  } | null>(null);

  // Saving / Async State
  const [isSaving, setIsSaving] = React.useState<boolean>(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [textInputPrompt, setTextInputPrompt] = React.useState<string | null>(null);
  const [pendingTextPos, setPendingTextPos] = React.useState<{ x: number; y: number } | null>(null);

  // Canvas Refs
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const overlayRef = React.useRef<SVGSVGElement | null>(null);
  const isDrawingRef = React.useRef<boolean>(false);
  const currentPathRef = React.useRef<{ x: number; y: number }[]>([]);

  // Initialize or Reset when Photo changes
  React.useEffect(() => {
    if (isOpen && photo) {
      setTransform(DEFAULT_TRANSFORM);
      setAnnotations([]);
      setHistory([{ transform: DEFAULT_TRANSFORM, annotations: [] }]);
      setHistoryIndex(0);
      setSaveError(null);
      setSelectedAnnotationId(null);
      setIsCropping(false);
      setShowOriginalComparison(false);
      setCropBox({ x: 10, y: 10, width: 80, height: 80 });
      setCropMode('free');
    }
  }, [isOpen, photo]);

  // Record History State Helper
  const pushState = (newTransform: ImageTransformParams, newAnnotations: ImageAnnotationItem[]) => {
    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push({
      transform: { ...newTransform, crop: newTransform.crop ? { ...newTransform.crop } : null },
      annotations: JSON.parse(JSON.stringify(newAnnotations)),
    });
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
    setTransform(newTransform);
    setAnnotations(newAnnotations);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      setTransform(prev.transform);
      setAnnotations(prev.annotations);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      setTransform(next.transform);
      setAnnotations(next.annotations);
    }
  };

  const handleResetAll = () => {
    pushState(DEFAULT_TRANSFORM, []);
    setIsCropping(false);
    setCropBox({ x: 10, y: 10, width: 80, height: 80 });
  };

  // Transform Handlers
  const handleRotateCw = () => {
    const nextRot = ((transform.rotation + 90) % 360) as 0 | 90 | 180 | 270;
    const nextTransform = { ...transform, rotation: nextRot };
    pushState(nextTransform, annotations);
  };

  const handleFlipH = () => {
    const nextTransform = { ...transform, flipH: !transform.flipH };
    pushState(nextTransform, annotations);
  };

  const handleFlipV = () => {
    const nextTransform = { ...transform, flipV: !transform.flipV };
    pushState(nextTransform, annotations);
  };

  const handleApplyCrop = () => {
    const nextTransform = { ...transform, crop: { ...cropBox } };
    pushState(nextTransform, annotations);
    setIsCropping(false);
  };

  const handleClearCrop = () => {
    const nextTransform = { ...transform, crop: null };
    pushState(nextTransform, annotations);
    setIsCropping(false);
    setCropBox({ x: 10, y: 10, width: 80, height: 80 });
  };

  const handleAspectPreset = (aspect: '1:1' | '4:3' | '3:4' | '16:9') => {
    setCropMode('fixed');
    let w = 80;
    let h = 80;
    if (aspect === '1:1') { w = 70; h = 70; }
    else if (aspect === '4:3') { w = 80; h = 60; }
    else if (aspect === '3:4') { w = 60; h = 80; }
    else if (aspect === '16:9') { w = 90; h = 50.6; }
    const x = Math.max(0, (100 - w) / 2);
    const y = Math.max(0, (100 - h) / 2);
    setCropBox({ x, y, width: w, height: h });
  };

  const handleEnableFreeCrop = () => {
    setCropMode('free');
    setIsCropping(true);
  };

  // Pointer Event Helper (Normalized 0..100)
  const getPointerPos = (e: React.PointerEvent<SVGSVGElement> | React.PointerEvent) => {
    if (!overlayRef.current) return { x: 0, y: 0 };
    const rect = overlayRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
  };

  // Crop Drag Handles Logic
  const handleCropPointerDown = (
    handle: 'NW' | 'NE' | 'SW' | 'SE' | 'N' | 'S' | 'E' | 'W' | 'CENTER',
    e: React.PointerEvent
  ) => {
    e.stopPropagation();
    setCropHandleDragging(handle);
    const pos = getPointerPos(e);
    cropStartPosRef.current = { x: pos.x, y: pos.y, cropBox: { ...cropBox } };
  };

  const handleCropPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!cropHandleDragging || !cropStartPosRef.current) return;
    const pos = getPointerPos(e);
    const dx = pos.x - cropStartPosRef.current.x;
    const dy = pos.y - cropStartPosRef.current.y;
    const orig = cropStartPosRef.current.cropBox;

    let newX = orig.x;
    let newY = orig.y;
    let newW = orig.width;
    let newH = orig.height;

    const minW = 5;
    const minH = 5;

    if (cropHandleDragging === 'CENTER') {
      newX = Math.max(0, Math.min(100 - orig.width, orig.x + dx));
      newY = Math.max(0, Math.min(100 - orig.height, orig.y + dy));
    } else {
      if (cropHandleDragging.includes('W')) {
        const potentialX = Math.max(0, Math.min(orig.x + orig.width - minW, orig.x + dx));
        newW = orig.width + (orig.x - potentialX);
        newX = potentialX;
      }
      if (cropHandleDragging.includes('E')) {
        newW = Math.max(minW, Math.min(100 - orig.x, orig.width + dx));
      }
      if (cropHandleDragging.includes('N')) {
        const potentialY = Math.max(0, Math.min(orig.y + orig.height - minH, orig.y + dy));
        newH = orig.height + (orig.y - potentialY);
        newY = potentialY;
      }
      if (cropHandleDragging.includes('S')) {
        newH = Math.max(minH, Math.min(100 - orig.y, orig.height + dy));
      }
    }

    setCropBox({
      x: Number(newX.toFixed(2)),
      y: Number(newY.toFixed(2)),
      width: Number(newW.toFixed(2)),
      height: Number(newH.toFixed(2)),
    });
  };

  const handleCropPointerUp = () => {
    if (cropHandleDragging) {
      setCropHandleDragging(null);
      cropStartPosRef.current = null;
    }
  };

  // Render Image onto HTML5 Canvas with Filters
  React.useEffect(() => {
    if (!isOpen || !photo?.dataUrl || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // Handle Crop if active
      let sourceX = 0;
      let sourceY = 0;
      let sourceW = width;
      let sourceH = height;

      if (transform.crop) {
        sourceX = (transform.crop.x / 100) * width;
        sourceY = (transform.crop.y / 100) * height;
        sourceW = (transform.crop.width / 100) * width;
        sourceH = (transform.crop.height / 100) * height;
      }

      // Handle Rotation Dimensions
      const isRotated = transform.rotation === 90 || transform.rotation === 270;
      const targetW = isRotated ? Math.round(sourceH) : Math.round(sourceW);
      const targetH = isRotated ? Math.round(sourceW) : Math.round(sourceH);

      canvas.width = targetW;
      canvas.height = targetH;

      ctx.save();
      ctx.clearRect(0, 0, targetW, targetH);

      // Center and Transform
      ctx.translate(targetW / 2, targetH / 2);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.scale(transform.flipH ? -1 : 1, transform.flipV ? -1 : 1);

      ctx.drawImage(
        img,
        sourceX,
        sourceY,
        sourceW,
        sourceH,
        -sourceW / 2,
        -sourceH / 2,
        sourceW,
        sourceH
      );
      ctx.restore();

      // Apply deterministic, non-cumulative clinical adjustments
      try {
        const imgData = ctx.getImageData(0, 0, targetW, targetH);
        applyClinicalImageAdjustments(imgData, transform);
        ctx.putImageData(imgData, 0, 0);
      } catch {
        // Fall through if getImageData fails due to cross-origin
      }
    };
    img.src = photo.dataUrl;
  }, [isOpen, photo, transform]);

  // Pointer Event Handlers for SVG Annotation Overlay
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (cropHandleDragging) return;
    if (activeTab !== 'annotate' || isCropping) return;
    const pos = getPointerPos(e);

    if (activeAnnotationTool === 'text') {
      setPendingTextPos(pos);
      setTextInputPrompt('');
      return;
    }

    if (activeAnnotationTool === 'vertical_reference') {
      const geom = createVerticalReferenceGeometry(pos.x, 50, 90, 0);
      const newItem: ImageAnnotationItem = {
        id: `ann_vref_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        type: 'vertical_reference',
        color: annotationColor,
        strokeWidth: annotationStrokeWidth,
        x1: geom.x1,
        y1: geom.y1,
        x2: geom.x2,
        y2: geom.y2,
        angle: 0,
        label: isAr ? 'خط المنتصف الرأسي' : 'Facial Midline',
        isUncalibrated: true,
      };
      const nextAnnotations = [...annotations, newItem];
      setAnnotations(nextAnnotations);
      setSelectedAnnotationId(newItem.id);
      setRefLineDragging({
        annotationId: newItem.id,
        handle: 'CENTER',
        startX: pos.x,
        startY: pos.y,
        origX1: geom.x1,
        origY1: geom.y1,
        origX2: geom.x2,
        origY2: geom.y2,
      });
      return;
    }

    if (activeAnnotationTool === 'horizontal_reference') {
      const geom = createHorizontalReferenceGeometry(50, pos.y, 90, 0);
      const newItem: ImageAnnotationItem = {
        id: `ann_href_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        type: 'horizontal_reference',
        color: annotationColor,
        strokeWidth: annotationStrokeWidth,
        x1: geom.x1,
        y1: geom.y1,
        x2: geom.x2,
        y2: geom.y2,
        angle: 0,
        label: isAr ? 'الخط المرجعي الأفقي' : 'Horizontal Guide',
        isUncalibrated: true,
      };
      const nextAnnotations = [...annotations, newItem];
      setAnnotations(nextAnnotations);
      setSelectedAnnotationId(newItem.id);
      setRefLineDragging({
        annotationId: newItem.id,
        handle: 'CENTER',
        startX: pos.x,
        startY: pos.y,
        origX1: geom.x1,
        origY1: geom.y1,
        origX2: geom.x2,
        origY2: geom.y2,
      });
      return;
    }

    if (activeAnnotationTool === 'select') return;

    isDrawingRef.current = true;
    currentPathRef.current = [pos];

    if (['line', 'arrow', 'rectangle', 'circle'].includes(activeAnnotationTool)) {
      const newItem: ImageAnnotationItem = {
        id: `ann_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        type: activeAnnotationTool,
        color: annotationColor,
        strokeWidth: annotationStrokeWidth,
        x1: pos.x,
        y1: pos.y,
        x2: pos.x,
        y2: pos.y,
        isUncalibrated: true,
      };
      setAnnotations((prev) => [...prev, newItem]);
      setSelectedAnnotationId(newItem.id);
    }
  };

  const startRefHandleDrag = (
    e: React.PointerEvent,
    annotationId: string,
    handle: 'P1' | 'P2' | 'CENTER',
    ann: ImageAnnotationItem
  ) => {
    e.stopPropagation();
    setSelectedAnnotationId(annotationId);
    const pos = getPointerPos(e);
    setRefLineDragging({
      annotationId,
      handle,
      startX: pos.x,
      startY: pos.y,
      origX1: ann.x1 ?? 0,
      origY1: ann.y1 ?? 0,
      origX2: ann.x2 ?? 100,
      origY2: ann.y2 ?? 100,
    });
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (cropHandleDragging) {
      handleCropPointerMove(e);
      return;
    }
    if (refLineDragging) {
      const pos = getPointerPos(e);
      const dx = pos.x - refLineDragging.startX;
      const dy = pos.y - refLineDragging.startY;
      setAnnotations((prev) =>
        prev.map((ann) => {
          if (ann.id !== refLineDragging.annotationId) return ann;
          if (refLineDragging.handle === 'CENTER') {
            const newX1 = Math.max(0, Math.min(100, refLineDragging.origX1 + dx));
            const newY1 = Math.max(0, Math.min(100, refLineDragging.origY1 + dy));
            const newX2 = Math.max(0, Math.min(100, refLineDragging.origX2 + dx));
            const newY2 = Math.max(0, Math.min(100, refLineDragging.origY2 + dy));
            return { ...ann, x1: newX1, y1: newY1, x2: newX2, y2: newY2 };
          } else if (refLineDragging.handle === 'P1') {
            const newX1 = Math.max(0, Math.min(100, pos.x));
            const newY1 = Math.max(0, Math.min(100, pos.y));
            return { ...ann, x1: newX1, y1: newY1 };
          } else if (refLineDragging.handle === 'P2') {
            const newX2 = Math.max(0, Math.min(100, pos.x));
            const newY2 = Math.max(0, Math.min(100, pos.y));
            return { ...ann, x2: newX2, y2: newY2 };
          }
          return ann;
        })
      );
      return;
    }
    if (!isDrawingRef.current || activeTab !== 'annotate') return;
    const pos = getPointerPos(e);

    if (activeAnnotationTool === 'freehand') {
      currentPathRef.current.push(pos);
      setAnnotations((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.type === 'freehand' && last.id.startsWith('drawing_')) {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...last,
            points: [...currentPathRef.current],
          };
          return updated;
        } else {
          const newFreehand: ImageAnnotationItem = {
            id: `drawing_${Date.now()}`,
            type: 'freehand',
            color: annotationColor,
            strokeWidth: annotationStrokeWidth,
            points: [...currentPathRef.current],
            isUncalibrated: true,
          };
          return [...prev, newFreehand];
        }
      });
    } else if (['line', 'arrow', 'rectangle', 'circle'].includes(activeAnnotationTool)) {
      setAnnotations((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        updated[lastIdx] = {
          ...updated[lastIdx],
          x2: pos.x,
          y2: pos.y,
        };
        return updated;
      });
    }
  };

  const handlePointerUp = () => {
    if (cropHandleDragging) {
      handleCropPointerUp();
      return;
    }
    if (refLineDragging) {
      setRefLineDragging(null);
      pushState(transform, annotations);
      return;
    }
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    currentPathRef.current = [];
    pushState(transform, annotations);
  };

  const handleAddTextAnnotation = () => {
    if (!pendingTextPos || !textInputPrompt?.trim()) {
      setPendingTextPos(null);
      setTextInputPrompt(null);
      return;
    }
    const newTextItem: ImageAnnotationItem = {
      id: `ann_txt_${Date.now()}`,
      type: 'text',
      color: annotationColor,
      strokeWidth: annotationStrokeWidth,
      x1: pendingTextPos.x,
      y1: pendingTextPos.y,
      text: textInputPrompt.trim(),
      fontSize: 16,
      isUncalibrated: true,
    };
    const nextAnn = [...annotations, newTextItem];
    pushState(transform, nextAnn);
    setPendingTextPos(null);
    setTextInputPrompt(null);
  };

  const handleDeleteSelectedAnnotation = () => {
    if (!selectedAnnotationId) return;
    const next = annotations.filter((a) => a.id !== selectedAnnotationId);
    pushState(transform, next);
    setSelectedAnnotationId(null);
  };

  // High-Resolution Export Handler
  const handleExportAndSave = async () => {
    if (!photo || isSaving) return;
    setIsSaving(true);
    setSaveError(null);

    try {
      const exportCanvas = document.createElement('canvas');
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) throw new Error('ERR_CANVAS_2D_UNAVAILABLE: Could not initialize 2D export canvas context.');

      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('ERR_IMAGE_LOAD_FAILED: Failed to load source image for high-resolution derivative export.'));
        img.src = photo.dataUrl || '';
      });

      let sourceX = 0;
      let sourceY = 0;
      let sourceW = img.width;
      let sourceH = img.height;

      if (transform.crop) {
        sourceX = (transform.crop.x / 100) * img.width;
        sourceY = (transform.crop.y / 100) * img.height;
        sourceW = (transform.crop.width / 100) * img.width;
        sourceH = (transform.crop.height / 100) * img.height;
      }

      const isRotated = transform.rotation === 90 || transform.rotation === 270;
      const exportW = isRotated ? Math.round(sourceH) : Math.round(sourceW);
      const exportH = isRotated ? Math.round(sourceW) : Math.round(sourceH);

      // Memory limit safeguard: Cap maximum dimension at 2048px for browser stability
      const maxExportDim = 2048;
      let finalW = exportW;
      let finalH = exportH;
      if (finalW > maxExportDim || finalH > maxExportDim) {
        if (finalW > finalH) {
          finalH = Math.round((finalH * maxExportDim) / finalW);
          finalW = maxExportDim;
        } else {
          finalW = Math.round((finalW * maxExportDim) / finalH);
          finalH = maxExportDim;
        }
      }

      exportCanvas.width = finalW;
      exportCanvas.height = finalH;

      ctx.save();
      ctx.translate(finalW / 2, finalH / 2);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.scale(transform.flipH ? -1 : 1, transform.flipV ? -1 : 1);

      ctx.drawImage(
        img,
        sourceX,
        sourceY,
        sourceW,
        sourceH,
        -finalW / 2,
        -finalH / 2,
        finalW,
        finalH
      );
      ctx.restore();

      // Apply deterministic, non-cumulative clinical enhancements to exported pixels
      try {
        const exportImgData = ctx.getImageData(0, 0, finalW, finalH);
        applyClinicalImageAdjustments(exportImgData, transform);
        ctx.putImageData(exportImgData, 0, 0);
      } catch (err) {
        console.warn('Failed to apply pixel adjustments during derivative export:', err);
      }

      // Draw Vector Annotations directly onto Export Canvas
      annotations.forEach((ann) => {
        // Skip hidden annotations from final clinical derivative
        if (ann.isHidden) return;

        ctx.save();
        ctx.strokeStyle = ann.color;
        ctx.fillStyle = ann.color;
        ctx.lineWidth = Math.max(1, (ann.strokeWidth / 100) * Math.min(finalW, finalH));
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (ann.type === 'freehand' && ann.points && ann.points.length > 1) {
          ctx.beginPath();
          ann.points.forEach((pt, idx) => {
            const px = (pt.x / 100) * finalW;
            const py = (pt.y / 100) * finalH;
            if (idx === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.stroke();
        } else if ((ann.type === 'vertical_reference' || ann.type === 'horizontal_reference') && ann.x1 !== undefined && ann.y1 !== undefined && ann.x2 !== undefined && ann.y2 !== undefined) {
          const x1 = (ann.x1 / 100) * finalW;
          const y1 = (ann.y1 / 100) * finalH;
          const x2 = (ann.x2 / 100) * finalW;
          const y2 = (ann.y2 / 100) * finalH;

          // Draw main reference guide line
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();

          // Terminal crosshair perpendicular tick marks
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const tickLen = Math.max(12, ctx.lineWidth * 2.5);
          ctx.beginPath();
          ctx.moveTo(x1 - tickLen * Math.sin(angle), y1 + tickLen * Math.cos(angle));
          ctx.lineTo(x1 + tickLen * Math.sin(angle), y1 - tickLen * Math.cos(angle));
          ctx.moveTo(x2 - tickLen * Math.sin(angle), y2 + tickLen * Math.cos(angle));
          ctx.lineTo(x2 + tickLen * Math.sin(angle), y2 - tickLen * Math.cos(angle));
          ctx.stroke();
        } else if (ann.type === 'line' && ann.x1 !== undefined && ann.y1 !== undefined && ann.x2 !== undefined && ann.y2 !== undefined) {
          ctx.beginPath();
          ctx.moveTo((ann.x1 / 100) * finalW, (ann.y1 / 100) * finalH);
          ctx.lineTo((ann.x2 / 100) * finalW, (ann.y2 / 100) * finalH);
          ctx.stroke();
        } else if (ann.type === 'arrow' && ann.x1 !== undefined && ann.y1 !== undefined && ann.x2 !== undefined && ann.y2 !== undefined) {
          const x1 = (ann.x1 / 100) * finalW;
          const y1 = (ann.y1 / 100) * finalH;
          const x2 = (ann.x2 / 100) * finalW;
          const y2 = (ann.y2 / 100) * finalH;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const headLen = Math.max(12, ctx.lineWidth * 3);
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
          ctx.closePath();
          ctx.fill();
        } else if (ann.type === 'rectangle' && ann.x1 !== undefined && ann.y1 !== undefined && ann.x2 !== undefined && ann.y2 !== undefined) {
          const rx1 = (ann.x1 / 100) * finalW;
          const ry1 = (ann.y1 / 100) * finalH;
          const rw = ((ann.x2 - ann.x1) / 100) * finalW;
          const rh = ((ann.y2 - ann.y1) / 100) * finalH;
          ctx.strokeRect(rx1, ry1, rw, rh);
        } else if (ann.type === 'circle' && ann.x1 !== undefined && ann.y1 !== undefined && ann.x2 !== undefined && ann.y2 !== undefined) {
          const cx = ((ann.x1 + ann.x2) / 2 / 100) * finalW;
          const cy = ((ann.y1 + ann.y2) / 2 / 100) * finalH;
          const radius = (Math.hypot((ann.x2 - ann.x1) / 100 * finalW, (ann.y2 - ann.y1) / 100 * finalH)) / 2;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
          ctx.stroke();
        } else if (ann.type === 'text' && ann.x1 !== undefined && ann.y1 !== undefined && ann.text) {
          const tx = (ann.x1 / 100) * finalW;
          const ty = (ann.y1 / 100) * finalH;
          const fontSize = Math.max(16, Math.round((finalW / 800) * 18));
          ctx.font = `bold ${fontSize}px sans-serif`;
          ctx.fillText(ann.text, tx, ty);
        }
        ctx.restore();
      });

      const derivativeDataUrl = exportCanvas.toDataURL('image/jpeg', 0.92);

      // Convert DataURL to Uint8Array
      const base64Str = derivativeDataUrl.split(',')[1] || '';
      const binaryStr = atob(base64Str);
      const binaryData = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        binaryData[i] = binaryStr.charCodeAt(i);
      }

      const nowIso = new Date().toISOString();
      const derivativeId = `med_deriv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      const recipe: ImageEditingRecipe = {
        recipeVersion: '1.0',
        sourceAssetId: photo.id,
        transform: { ...transform, crop: transform.crop ? { ...transform.crop } : null },
        annotations: JSON.parse(JSON.stringify(annotations)),
        createdAt: nowIso,
      };

      const derivative: ApprovedImageDerivative = {
        id: derivativeId,
        sourceAssetId: photo.id,
        category: photo.category,
        stage: photo.stage,
        dataUrl: derivativeDataUrl,
        binaryData,
        mimeType: 'image/jpeg',
        fileSize: binaryData.byteLength,
        recipe,
        captionEn: `${photo.captionEn || photo.category} (Edited Derivative)`,
        captionAr: `${photo.captionAr || photo.category} (نسخة معالجة/معدلة)`,
      };

      await onSaveDerivative(derivative);
      onClose();
    } catch (err: unknown) {
      console.error('Failed to export derivative:', err);
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen || !photo) return null;

  const isDirty = historyIndex > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-2 sm:p-4 backdrop-blur-xs select-none">
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-6xl h-[94vh] shadow-2xl flex flex-col overflow-hidden text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. Header Toolbar */}
        <div className="px-5 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-600/30 text-blue-400 border border-blue-500/40">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">
                  {isAr ? 'محرر الصور السريرية المتقدم' : 'Clinical Image Editor & Annotator'}
                </h2>
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md bg-blue-900/60 text-blue-300 font-mono border border-blue-700/50">
                  Non-Destructive
                </span>
                {photo.parentAssetId && (
                  <span className="text-[10px] bg-amber-900/60 text-amber-200 border border-amber-700/50 px-2 py-0.5 rounded-md font-mono flex items-center gap-1">
                    <span>{isAr ? 'نسخة معدلة من الأصل' : 'Derivative of Master Asset'}</span>
                    <span className="opacity-70">({photo.parentAssetId})</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                {photo.category} ({photo.stage}) — {patient.fullNameEn}
              </p>
            </div>
          </div>

          {/* Quick Action Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleUndo}
              disabled={historyIndex === 0}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-30 disabled:pointer-events-none transition"
              title={isAr ? 'تراجع' : 'Undo'}
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleRedo}
              disabled={historyIndex === history.length - 1}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-30 disabled:pointer-events-none transition"
              title={isAr ? 'إعادة' : 'Redo'}
            >
              <Redo2 className="w-4 h-4" />
            </button>
            <div className="h-5 w-px bg-slate-700 mx-1" />
            <button
              onClick={handleResetAll}
              disabled={!isDirty}
              className="px-3 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800/50 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-30 disabled:pointer-events-none transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{isAr ? 'إعادة ضبط' : 'Reset All'}</span>
            </button>
            <div className="h-5 w-px bg-slate-700 mx-1" />
            <button
              onClick={handleExportAndSave}
              disabled={isSaving}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-blue-600/30 disabled:opacity-50 transition"
            >
              {isSaving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{isAr ? 'جاري الحفظ...' : 'Saving Derivative...'}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isAr ? 'حفظ النسخة المعدلة' : 'Save Derivative'}</span>
                </>
              )}
            </button>
            <button
              onClick={() => {
                if (isDirty && !confirm(isAr ? 'توجد تغييرات غير محفوظة. هل أنت ألمتأكد من الإغلاق؟' : 'Unsaved modifications exist. Are you sure you want to close?')) {
                  return;
                }
                onClose();
              }}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 2. Error Banner */}
        {saveError && (
          <div className="px-4 py-2 bg-rose-900/80 border-b border-rose-700 text-rose-200 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{saveError}</span>
            </div>
            <button onClick={() => setSaveError(null)} className="text-rose-300 hover:text-white text-xs underline">
              {isAr ? 'تجاهل' : 'Dismiss'}
            </button>
          </div>
        )}

        {/* 3. Main Editor Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left / Center: Interactive Canvas Workspace */}
          <div className="flex-1 bg-slate-950 relative flex items-center justify-center p-4 overflow-hidden" ref={containerRef}>
            {showOriginalComparison ? (
              /* Original vs Edited Side-by-Side Comparison View */
              <div className="w-full h-full grid grid-cols-2 gap-4 p-2">
                <div className="flex flex-col border border-slate-800 rounded-xl bg-slate-900/50 p-3 overflow-hidden">
                  <div className="text-xs font-semibold text-slate-400 mb-2 flex items-center justify-between">
                    <span>{isAr ? 'الصورة الأصلية (غير معدلة)' : 'Original Source Image'}</span>
                    <span className="text-[10px] font-mono bg-slate-800 px-2 py-0.5 rounded text-slate-300">Unmodified</span>
                  </div>
                  <div className="flex-1 flex items-center justify-center overflow-hidden">
                    <img src={photo.dataUrl} alt="Original" className="max-w-full max-h-full object-contain rounded" />
                  </div>
                </div>
                <div className="flex flex-col border border-blue-900/50 rounded-xl bg-slate-900/50 p-3 overflow-hidden">
                  <div className="text-xs font-semibold text-blue-400 mb-2 flex items-center justify-between">
                    <span>{isAr ? 'النسخة المعالجة الحالية' : 'Edited Preview Derivative'}</span>
                    <span className="text-[10px] font-mono bg-blue-950 text-blue-300 px-2 py-0.5 rounded border border-blue-800/50">Recipe Applied</span>
                  </div>
                  <div className="flex-1 flex items-center justify-center overflow-hidden relative">
                    <canvas ref={canvasRef} className="max-w-full max-h-full object-contain shadow-xl" />
                  </div>
                </div>
              </div>
            ) : (
              /* Main Editor View: Canvas Layer + SVG Annotation Overlay */
              <div className="relative flex items-center justify-center max-w-full max-h-full">
                <canvas ref={canvasRef} className="max-w-full max-h-[80vh] object-contain rounded shadow-2xl block" />

                {/* SVG Annotation & Interactive Crop Handle Layer */}
                <svg
                  ref={overlayRef}
                  className={`absolute inset-0 w-full h-full touch-none ${
                    activeTab === 'annotate' ? 'cursor-crosshair' : 'cursor-default'
                  }`}
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                >
                  {/* Render Saved Annotations */}
                  {annotations.map((ann) => {
                    const isSelected = ann.id === selectedAnnotationId;
                    if (ann.type === 'freehand' && ann.points && ann.points.length > 1) {
                      const d = ann.points.reduce((acc, pt, idx) => `${acc} ${idx === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`, '');
                      return (
                        <path
                          key={ann.id}
                          d={d}
                          fill="none"
                          stroke={ann.color}
                          strokeWidth={ann.strokeWidth / 10}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAnnotationId(ann.id);
                          }}
                          className={isSelected ? 'filter drop-shadow-[0_0_3px_rgba(255,255,255,0.8)] cursor-pointer' : 'cursor-pointer'}
                        />
                      );
                    } else if (
                      (ann.type === 'vertical_reference' || ann.type === 'horizontal_reference') &&
                      ann.x1 !== undefined &&
                      ann.y1 !== undefined &&
                      ann.x2 !== undefined &&
                      ann.y2 !== undefined
                    ) {
                      const isV = ann.type === 'vertical_reference';
                      const angleDeg = isV
                        ? Math.atan2(ann.x2 - ann.x1, ann.y2 - ann.y1) * (180 / Math.PI)
                        : Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1) * (180 / Math.PI);
                      const midX = (ann.x1 + ann.x2) / 2;
                      const midY = (ann.y1 + ann.y2) / 2;

                      // Terminal crosshair perpendicular ticks
                      const angleRad = Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1);
                      const tickLen = 2.5;
                      const tdx = tickLen * Math.sin(angleRad);
                      const tdy = tickLen * Math.cos(angleRad);

                      return (
                        <g
                          key={ann.id}
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAnnotationId(ann.id);
                          }}
                        >
                          {/* Guideline shadow for high visibility on light/dark backgrounds */}
                          <line
                            x1={ann.x1}
                            y1={ann.y1}
                            x2={ann.x2}
                            y2={ann.y2}
                            stroke="#000000"
                            strokeWidth={(ann.strokeWidth / 10) + 0.3}
                            strokeOpacity={0.6}
                            strokeLinecap="round"
                          />

                          {/* Primary Reference Line */}
                          <line
                            x1={ann.x1}
                            y1={ann.y1}
                            x2={ann.x2}
                            y2={ann.y2}
                            stroke={ann.color}
                            strokeWidth={ann.strokeWidth / 10}
                            strokeDasharray={ann.isHidden ? '2,2' : undefined}
                            opacity={ann.isHidden ? 0.35 : 1}
                            strokeLinecap="round"
                          />

                          {/* Perpendicular Terminal Crosshairs */}
                          {!ann.isHidden && (
                            <>
                              <line
                                x1={ann.x1 - tdx}
                                y1={ann.y1 + tdy}
                                x2={ann.x1 + tdx}
                                y2={ann.y1 - tdy}
                                stroke={ann.color}
                                strokeWidth={ann.strokeWidth / 10}
                                strokeLinecap="round"
                              />
                              <line
                                x1={ann.x2 - tdx}
                                y1={ann.y2 + tdy}
                                x2={ann.x2 + tdx}
                                y2={ann.y2 - tdy}
                                stroke={ann.color}
                                strokeWidth={ann.strokeWidth / 10}
                                strokeLinecap="round"
                              />
                            </>
                          )}

                          {/* Invisible wide hit area for full-line dragging */}
                          <line
                            x1={ann.x1}
                            y1={ann.y1}
                            x2={ann.x2}
                            y2={ann.y2}
                            stroke="transparent"
                            strokeWidth={6}
                            onPointerDown={(e) => startRefHandleDrag(e, ann.id, 'CENTER', ann)}
                          />

                          {/* Interactive Handles when Selected */}
                          {isSelected && (
                            <>
                              {/* Center Move Handle */}
                              <circle
                                cx={midX}
                                cy={midY}
                                r={2.0}
                                fill={ann.color}
                                stroke="#ffffff"
                                strokeWidth={0.5}
                                className="cursor-move shadow-md"
                              />
                              {/* Large touch area for iPad / Apple Pencil */}
                              <circle
                                cx={midX}
                                cy={midY}
                                r={5.0}
                                fill="transparent"
                                className="cursor-move"
                                onPointerDown={(e) => startRefHandleDrag(e, ann.id, 'CENTER', ann)}
                              />

                              {/* P1 Endpoint Tilt Handle */}
                              <circle
                                cx={ann.x1}
                                cy={ann.y1}
                                r={1.8}
                                fill="#ffffff"
                                stroke={ann.color}
                                strokeWidth={0.5}
                                className="cursor-crosshair"
                              />
                              <circle
                                cx={ann.x1}
                                cy={ann.y1}
                                r={5.0}
                                fill="transparent"
                                className="cursor-crosshair"
                                onPointerDown={(e) => startRefHandleDrag(e, ann.id, 'P1', ann)}
                              />

                              {/* P2 Endpoint Tilt Handle */}
                              <circle
                                cx={ann.x2}
                                cy={ann.y2}
                                r={1.8}
                                fill="#ffffff"
                                stroke={ann.color}
                                strokeWidth={0.5}
                                className="cursor-crosshair"
                              />
                              <circle
                                cx={ann.x2}
                                cy={ann.y2}
                                r={5.0}
                                fill="transparent"
                                className="cursor-crosshair"
                                onPointerDown={(e) => startRefHandleDrag(e, ann.id, 'P2', ann)}
                              />

                              {/* Clinical Angle Badge */}
                              <rect
                                x={Math.min(78, Math.max(2, midX + 2.5))}
                                y={Math.min(94, Math.max(2, midY - 3.5))}
                                width={19}
                                height={4.2}
                                rx={1}
                                fill="#0f172a"
                                fillOpacity={0.9}
                                stroke={ann.color}
                                strokeWidth={0.3}
                              />
                              <text
                                x={Math.min(78, Math.max(2, midX + 3.2))}
                                y={Math.min(94, Math.max(2, midY - 0.7))}
                                fill="#ffffff"
                                fontSize="2.4"
                                fontFamily="monospace"
                                fontWeight="bold"
                              >
                                {isV ? 'V-MID' : 'H-REF'}: {angleDeg.toFixed(1)}°
                              </text>
                            </>
                          )}
                        </g>
                      );
                    } else if (ann.type === 'line' && ann.x1 !== undefined && ann.y1 !== undefined && ann.x2 !== undefined && ann.y2 !== undefined) {
                      return (
                        <line
                          key={ann.id}
                          x1={ann.x1}
                          y1={ann.y1}
                          x2={ann.x2}
                          y2={ann.y2}
                          stroke={ann.color}
                          strokeWidth={ann.strokeWidth / 10}
                          strokeLinecap="round"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAnnotationId(ann.id);
                          }}
                          className="cursor-pointer"
                        />
                      );
                    } else if (ann.type === 'arrow' && ann.x1 !== undefined && ann.y1 !== undefined && ann.x2 !== undefined && ann.y2 !== undefined) {
                      return (
                        <g
                          key={ann.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAnnotationId(ann.id);
                          }}
                          className="cursor-pointer"
                        >
                          <line
                            x1={ann.x1}
                            y1={ann.y1}
                            x2={ann.x2}
                            y2={ann.y2}
                            stroke={ann.color}
                            strokeWidth={ann.strokeWidth / 10}
                            strokeLinecap="round"
                          />
                        </g>
                      );
                    } else if (ann.type === 'rectangle' && ann.x1 !== undefined && ann.y1 !== undefined && ann.x2 !== undefined && ann.y2 !== undefined) {
                      const rx = Math.min(ann.x1, ann.x2);
                      const ry = Math.min(ann.y1, ann.y2);
                      const rw = Math.abs(ann.x2 - ann.x1);
                      const rh = Math.abs(ann.y2 - ann.y1);
                      return (
                        <rect
                          key={ann.id}
                          x={rx}
                          y={ry}
                          width={rw}
                          height={rh}
                          fill="none"
                          stroke={ann.color}
                          strokeWidth={ann.strokeWidth / 10}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAnnotationId(ann.id);
                          }}
                          className="cursor-pointer"
                        />
                      );
                    } else if (ann.type === 'circle' && ann.x1 !== undefined && ann.y1 !== undefined && ann.x2 !== undefined && ann.y2 !== undefined) {
                      const cx = (ann.x1 + ann.x2) / 2;
                      const cy = (ann.y1 + ann.y2) / 2;
                      const r = Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1) / 2;
                      return (
                        <circle
                          key={ann.id}
                          cx={cx}
                          cy={cy}
                          r={r}
                          fill="none"
                          stroke={ann.color}
                          strokeWidth={ann.strokeWidth / 10}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAnnotationId(ann.id);
                          }}
                          className="cursor-pointer"
                        />
                      );
                    } else if (ann.type === 'text' && ann.x1 !== undefined && ann.y1 !== undefined && ann.text) {
                      return (
                        <text
                          key={ann.id}
                          x={ann.x1}
                          y={ann.y1}
                          fill={ann.color}
                          fontSize="4"
                          fontWeight="bold"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAnnotationId(ann.id);
                          }}
                          className="cursor-pointer font-sans select-none"
                        >
                          {ann.text}
                        </text>
                      );
                    }
                    return null;
                  })}

                  {/* FREE & FIXED CROP INTERACTIVE OVERLAY WITH DRAG HANDLES */}
                  {isCropping && (
                    <g>
                      {/* Dimmed backdrop */}
                      <path
                        d={`M 0,0 H 100 V 100 H 0 Z M ${cropBox.x},${cropBox.y} v ${cropBox.height} h ${cropBox.width} v -${cropBox.height} Z`}
                        fill="black"
                        fillOpacity="0.55"
                        fillRule="evenodd"
                      />

                      {/* Main Crop Rectangle Border */}
                      <rect
                        x={cropBox.x}
                        y={cropBox.y}
                        width={cropBox.width}
                        height={cropBox.height}
                        fill="transparent"
                        stroke="#06b6d4"
                        strokeWidth="0.8"
                        strokeDasharray="2 2"
                      />

                      {/* Center Move Handle Body */}
                      <rect
                        x={cropBox.x + cropBox.width / 4}
                        y={cropBox.y + cropBox.height / 4}
                        width={cropBox.width / 2}
                        height={cropBox.height / 2}
                        fill="transparent"
                        className="cursor-move"
                        onPointerDown={(e) => handleCropPointerDown('CENTER', e)}
                      />

                      {/* Corner Drag Handles */}
                      <circle
                        cx={cropBox.x}
                        cy={cropBox.y}
                        r="2.5"
                        fill="#06b6d4"
                        stroke="#ffffff"
                        strokeWidth="0.5"
                        className="cursor-nwse-resize"
                        onPointerDown={(e) => handleCropPointerDown('NW', e)}
                      />
                      <circle
                        cx={cropBox.x + cropBox.width}
                        cy={cropBox.y}
                        r="2.5"
                        fill="#06b6d4"
                        stroke="#ffffff"
                        strokeWidth="0.5"
                        className="cursor-nesw-resize"
                        onPointerDown={(e) => handleCropPointerDown('NE', e)}
                      />
                      <circle
                        cx={cropBox.x}
                        cy={cropBox.y + cropBox.height}
                        r="2.5"
                        fill="#06b6d4"
                        stroke="#ffffff"
                        strokeWidth="0.5"
                        className="cursor-nesw-resize"
                        onPointerDown={(e) => handleCropPointerDown('SW', e)}
                      />
                      <circle
                        cx={cropBox.x + cropBox.width}
                        cy={cropBox.y + cropBox.height}
                        r="2.5"
                        fill="#06b6d4"
                        stroke="#ffffff"
                        strokeWidth="0.5"
                        className="cursor-nwse-resize"
                        onPointerDown={(e) => handleCropPointerDown('SE', e)}
                      />

                      {/* Edge Drag Handles */}
                      <circle
                        cx={cropBox.x + cropBox.width / 2}
                        cy={cropBox.y}
                        r="2"
                        fill="#38bdf8"
                        stroke="#ffffff"
                        strokeWidth="0.4"
                        className="cursor-ns-resize"
                        onPointerDown={(e) => handleCropPointerDown('N', e)}
                      />
                      <circle
                        cx={cropBox.x + cropBox.width / 2}
                        cy={cropBox.y + cropBox.height}
                        r="2"
                        fill="#38bdf8"
                        stroke="#ffffff"
                        strokeWidth="0.4"
                        className="cursor-ns-resize"
                        onPointerDown={(e) => handleCropPointerDown('S', e)}
                      />
                      <circle
                        cx={cropBox.x}
                        cy={cropBox.y + cropBox.height / 2}
                        r="2"
                        fill="#38bdf8"
                        stroke="#ffffff"
                        strokeWidth="0.4"
                        className="cursor-ew-resize"
                        onPointerDown={(e) => handleCropPointerDown('W', e)}
                      />
                      <circle
                        cx={cropBox.x + cropBox.width}
                        cy={cropBox.y + cropBox.height / 2}
                        r="2"
                        fill="#38bdf8"
                        stroke="#ffffff"
                        strokeWidth="0.4"
                        className="cursor-ew-resize"
                        onPointerDown={(e) => handleCropPointerDown('E', e)}
                      />
                    </g>
                  )}
                </svg>
              </div>
            )}

            {/* Uncalibrated Safety Badge */}
            <div className="absolute bottom-3 left-4 bg-slate-900/90 border border-slate-700/80 rounded-lg px-3 py-1.5 text-[10px] text-slate-300 flex items-center gap-2 backdrop-blur-xs">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>
                {isAr
                  ? 'تنويه سريري: التعليقات البصرية غير معايرة حسابياً وليست مقياساً دقيقاً بالملليمتر.'
                  : 'Clinical Notice: Visual annotations are uncalibrated and do not represent millimeter measurements.'}
              </span>
            </div>
          </div>

          {/* Right Sidebar: Control Panel */}
          <div className="w-80 bg-slate-950 border-l border-slate-800 flex flex-col overflow-y-auto">
            {/* Tab Navigation */}
            <div className="grid grid-cols-4 border-b border-slate-800 bg-slate-900 text-xs font-semibold">
              <button
                onClick={() => { setActiveTab('transform'); setShowOriginalComparison(false); }}
                className={`py-3 flex flex-col items-center gap-1 border-b-2 transition ${
                  activeTab === 'transform' ? 'border-blue-500 text-blue-400 bg-slate-800/50' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Crop className="w-4 h-4" />
                <span>{isAr ? 'القص/التدوير' : 'Transform'}</span>
              </button>
              <button
                onClick={() => { setActiveTab('adjustments'); setShowOriginalComparison(false); }}
                className={`py-3 flex flex-col items-center gap-1 border-b-2 transition ${
                  activeTab === 'adjustments' ? 'border-blue-500 text-blue-400 bg-slate-800/50' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sliders className="w-4 h-4" />
                <span>{isAr ? 'الإضاءة' : 'Adjust'}</span>
              </button>
              <button
                onClick={() => { setActiveTab('annotate'); setShowOriginalComparison(false); }}
                className={`py-3 flex flex-col items-center gap-1 border-b-2 transition ${
                  activeTab === 'annotate' ? 'border-blue-500 text-blue-400 bg-slate-800/50' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <PenTool className="w-4 h-4" />
                <span>{isAr ? 'الرسوم' : 'Annotate'}</span>
              </button>
              <button
                onClick={() => { setActiveTab('compare'); setShowOriginalComparison(true); }}
                className={`py-3 flex flex-col items-center gap-1 border-b-2 transition ${
                  activeTab === 'compare' ? 'border-blue-500 text-blue-400 bg-slate-800/50' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Eye className="w-4 h-4" />
                <span>{isAr ? 'المقارنة' : 'Compare'}</span>
              </button>
            </div>

            {/* Tab Controls Content */}
            <div className="p-4 space-y-5 flex-1 overflow-y-auto">
              {/* TAB 1: TRANSFORM CONTROLS */}
              {activeTab === 'transform' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                      {isAr ? 'تدوير وتقليب الصورة' : 'Rotation & Flip'}
                    </h3>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={handleRotateCw}
                        className="p-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs flex flex-col items-center gap-1 text-slate-200 transition"
                      >
                        <RotateCw className="w-4 h-4 text-blue-400" />
                        <span>90° CW</span>
                      </button>
                      <button
                        onClick={handleFlipH}
                        className={`p-2.5 bg-slate-800 hover:bg-slate-700 border rounded-xl text-xs flex flex-col items-center gap-1 transition ${
                          transform.flipH ? 'border-blue-500 text-blue-400' : 'border-slate-700 text-slate-200'
                        }`}
                      >
                        <FlipHorizontal className="w-4 h-4" />
                        <span>{isAr ? 'أفقي' : 'Flip H'}</span>
                      </button>
                      <button
                        onClick={handleFlipV}
                        className={`p-2.5 bg-slate-800 hover:bg-slate-700 border rounded-xl text-xs flex flex-col items-center gap-1 transition ${
                          transform.flipV ? 'border-blue-500 text-blue-400' : 'border-slate-700 text-slate-200'
                        }`}
                      >
                        <FlipVertical className="w-4 h-4" />
                        <span>{isAr ? 'رأسي' : 'Flip V'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-slate-800 pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                        {isAr ? 'أداة قص الأبعاد' : 'Crop Boundaries'}
                      </h3>
                      {transform.crop && (
                        <button onClick={handleClearCrop} className="text-[11px] text-rose-400 hover:underline">
                          {isAr ? 'إلغاء القص' : 'Clear Crop'}
                        </button>
                      )}
                    </div>

                    {!isCropping ? (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={handleEnableFreeCrop}
                          className="py-2.5 bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition"
                        >
                          <Move className="w-4 h-4" />
                          <span>{isAr ? 'قص حر (Free Crop)' : 'Free Crop'}</span>
                        </button>
                        <button
                          onClick={() => { setIsCropping(true); setCropMode('fixed'); }}
                          className="py-2.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition"
                        >
                          <Crop className="w-4 h-4" />
                          <span>{isAr ? 'نسب ثابتة' : 'Fixed Ratio'}</span>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3 bg-slate-900 p-3 rounded-xl border border-slate-800">
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-300 border-b border-slate-800 pb-2">
                          <span>{cropMode === 'free' ? (isAr ? 'القص الحر النشط' : 'Free Crop Active') : (isAr ? 'قص بالنسبة الثابتة' : 'Fixed Ratio Active')}</span>
                          <span className="text-[10px] font-mono text-cyan-400 bg-slate-800 px-2 py-0.5 rounded">
                            {cropBox.width}% × {cropBox.height}%
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-400 leading-tight">
                          {cropMode === 'free'
                            ? (isAr ? 'اسحب مقابض الزوايا والأطراف للتعديل الحر، أو اختر نسبة محددة:' : 'Drag corner/edge handles to resize freely, or select preset:')
                            : (isAr ? 'اختر النسبة الجاهزة ثم اضبط الموضع:' : 'Select preset aspect ratio:')}
                        </p>

                        <div className="grid grid-cols-4 gap-1.5 text-[11px]">
                          {(['1:1', '4:3', '3:4', '16:9'] as const).map((asp) => (
                            <button
                              key={asp}
                              onClick={() => handleAspectPreset(asp)}
                              className="py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-center font-mono border border-slate-700"
                            >
                              {asp}
                            </button>
                          ))}
                        </div>

                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={handleApplyCrop}
                            className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold transition"
                          >
                            {isAr ? 'تطبيق القص' : 'Apply Crop'}
                          </button>
                          <button
                            onClick={() => setIsCropping(false)}
                            className="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs transition"
                          >
                            {isAr ? 'إلغاء' : 'Cancel'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: ADJUSTMENTS CONTROLS */}
              {activeTab === 'adjustments' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-800">
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      {isAr ? 'معالجة الصورة السريرية' : 'Image Adjustments'}
                    </span>
                    <button
                      onClick={() =>
                        pushState(
                          { ...transform, brightness: 100, contrast: 100, saturation: 100, grayscale: false, sharpness: 0 },
                          annotations
                        )
                      }
                      className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 transition"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>{isAr ? 'إعادة ضبط' : 'Reset Neutral'}</span>
                    </button>
                  </div>

                  {/* Brightness */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-300 flex items-center gap-1.5">
                        <Sun className="w-3.5 h-3.5 text-amber-400" />
                        {isAr ? 'السطوع (Brightness)' : 'Brightness'}
                      </span>
                      <span className="font-mono text-slate-400">{transform.brightness}%</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="180"
                      value={transform.brightness}
                      onChange={(e) => setTransform((prev) => ({ ...prev, brightness: Number(e.target.value) }))}
                      onPointerUp={() => pushState(transform, annotations)}
                      className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Contrast */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-300 flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5 text-blue-400" />
                        {isAr ? 'التباين (Contrast)' : 'Contrast'}
                      </span>
                      <span className="font-mono text-slate-400">{transform.contrast}%</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="180"
                      value={transform.contrast}
                      onChange={(e) => setTransform((prev) => ({ ...prev, contrast: Number(e.target.value) }))}
                      onPointerUp={() => pushState(transform, annotations)}
                      className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Saturation */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-300 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-pink-400" />
                        {isAr ? 'التشبع (Saturation)' : 'Saturation'}
                      </span>
                      <span className="font-mono text-slate-400">{transform.saturation}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      value={transform.saturation}
                      onChange={(e) => setTransform((prev) => ({ ...prev, saturation: Number(e.target.value) }))}
                      onPointerUp={() => pushState(transform, annotations)}
                      className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Sharpness */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-300 flex items-center gap-1.5">
                        <Compass className="w-3.5 h-3.5 text-emerald-400" />
                        {isAr ? 'الحدة (Sharpness)' : 'Sharpness'}
                      </span>
                      <span className="font-mono text-slate-400">{transform.sharpness}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={transform.sharpness}
                      onChange={(e) => setTransform((prev) => ({ ...prev, sharpness: Number(e.target.value) }))}
                      onPointerUp={() => pushState(transform, annotations)}
                      className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Grayscale Toggle */}
                  <div className="pt-1">
                    <label className="flex items-center justify-between p-3 bg-slate-900 rounded-xl border border-slate-800 cursor-pointer hover:border-slate-700 transition">
                      <span className="text-xs font-semibold text-slate-200">
                        {isAr ? 'تحويل للرمادي (Clinical Monochrome)' : 'Clinical Monochrome (Grayscale)'}
                      </span>
                      <input
                        type="checkbox"
                        checked={transform.grayscale}
                        onChange={(e) => pushState({ ...transform, grayscale: e.target.checked }, annotations)}
                        className="w-4 h-4 accent-blue-500 rounded"
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* TAB 3: ANNOTATION TOOLS */}
              {activeTab === 'annotate' && (
                <div className="space-y-4">
                  {/* Clinical Safety Disclaimer Banner */}
                  <div className="p-2.5 bg-amber-950/40 border border-amber-800/50 rounded-xl flex items-start gap-2 text-[11px] text-amber-300">
                    <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                    <div className="leading-tight">
                      <span className="font-bold block mb-0.5">
                        {isAr ? 'دلائل مرجعية سريرية غير معايرة' : 'Visual Clinical Reference Guides'}
                      </span>
                      <span>
                        {isAr
                          ? 'خطوط المحاذاة للمقارنة البصرية لخط المنتصف والمستوى الإطباقي. لا تحل محل التشخيص السريري ولا تقدم قياسات آلية.'
                          : 'Advisory visual guides for facial midline, occlusal cant & interpupillary alignment. Does not provide automatic skeletal diagnosis.'}
                      </span>
                    </div>
                  </div>

                  {/* Orthodontic Reference Line Tools */}
                  <div>
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center justify-between">
                      <span>{isAr ? 'الخطوط المرجعية التقويمية' : 'Orthodontic Reference Lines'}</span>
                      <span className="text-[10px] text-cyan-400 font-normal">Advisory Guides</span>
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setActiveAnnotationTool('vertical_reference')}
                        className={`p-2.5 rounded-xl text-xs flex flex-col items-center gap-1.5 border transition ${
                          activeAnnotationTool === 'vertical_reference'
                            ? 'bg-cyan-600/30 border-cyan-400 text-cyan-200 shadow-lg shadow-cyan-900/30'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <SeparatorVertical className="w-5 h-5 text-cyan-400" />
                        <span className="font-semibold text-center leading-tight">
                          {isAr ? 'خط المنتصف الرأسي' : 'Vertical Midline'}
                        </span>
                        <span className="text-[10px] text-slate-400">Facial Midline Guide</span>
                      </button>

                      <button
                        onClick={() => setActiveAnnotationTool('horizontal_reference')}
                        className={`p-2.5 rounded-xl text-xs flex flex-col items-center gap-1.5 border transition ${
                          activeAnnotationTool === 'horizontal_reference'
                            ? 'bg-cyan-600/30 border-cyan-400 text-cyan-200 shadow-lg shadow-cyan-900/30'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <SeparatorHorizontal className="w-5 h-5 text-cyan-400" />
                        <span className="font-semibold text-center leading-tight">
                          {isAr ? 'الخط المرجعي الأفقي' : 'Horizontal Guide'}
                        </span>
                        <span className="text-[10px] text-slate-400">Occlusal / Bipupillary</span>
                      </button>
                    </div>
                  </div>

                  {/* Clinical Drawing & Markup Tools */}
                  <div>
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                      {isAr ? 'أدوات الرسم والتأشير' : 'Clinical Drawing & Markup'}
                    </h3>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { id: 'freehand', label: isAr ? 'قلم حر' : 'Freehand Pen', icon: PenTool },
                        { id: 'line', label: isAr ? 'خط مستقيم' : 'Line', icon: Minus },
                        { id: 'arrow', label: isAr ? 'سهم' : 'Arrow', icon: ArrowRight },
                        { id: 'rectangle', label: isAr ? 'مستطيل' : 'Rectangle', icon: Square },
                        { id: 'circle', label: isAr ? 'دائرة' : 'Circle', icon: CircleIcon },
                        { id: 'text', label: isAr ? 'نص سريري' : 'Text Label', icon: Type },
                        { id: 'select', label: isAr ? 'تحديد وتحريك' : 'Select / Move', icon: Move },
                      ].map((tool) => {
                        const IconComponent = tool.icon;
                        const isActive = activeAnnotationTool === tool.id;
                        return (
                          <button
                            key={tool.id}
                            onClick={() => setActiveAnnotationTool(tool.id as ImageAnnotationType | 'select')}
                            className={`p-2 rounded-xl text-xs flex flex-col items-center gap-1 border transition ${
                              isActive
                                ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                                : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                            }`}
                          >
                            <IconComponent className="w-4 h-4" />
                            <span className="text-[11px]">{tool.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Stroke Color Palette */}
                  <div>
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                      {isAr ? 'لون الخط' : 'Stroke Color'}
                    </h3>
                    <div className="flex items-center gap-2">
                      {COLOR_PRESETS.map((cp) => (
                        <button
                          key={cp.hex}
                          onClick={() => {
                            setAnnotationColor(cp.hex);
                            if (selectedAnnotationId) {
                              const updated = annotations.map((a) =>
                                a.id === selectedAnnotationId ? { ...a, color: cp.hex } : a
                              );
                              pushState(transform, updated);
                            }
                          }}
                          style={{ backgroundColor: cp.hex }}
                          className={`w-7 h-7 rounded-full border-2 transition ${
                            annotationColor === cp.hex ? 'border-white scale-110 shadow-lg' : 'border-slate-700 opacity-80'
                          }`}
                          title={cp.name}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Stroke Width Selector */}
                  <div>
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                      <span>{isAr ? 'سُمك الخط' : 'Stroke Thickness'}</span>
                      <span className="font-mono text-slate-400 text-[11px]">{annotationStrokeWidth}px</span>
                    </h3>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[2, 4, 6, 8].map((w) => (
                        <button
                          key={w}
                          onClick={() => {
                            setAnnotationStrokeWidth(w);
                            if (selectedAnnotationId) {
                              const updated = annotations.map((a) =>
                                a.id === selectedAnnotationId ? { ...a, strokeWidth: w } : a
                              );
                              pushState(transform, updated);
                            }
                          }}
                          className={`py-1.5 rounded-lg text-xs font-mono border transition ${
                            annotationStrokeWidth === w
                              ? 'bg-blue-600/30 border-blue-500 text-white font-bold'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          {w}px
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Selected Item Inspector Panel */}
                  {selectedAnnotationId && (() => {
                    const sel = annotations.find((a) => a.id === selectedAnnotationId);
                    if (!sel) return null;
                    const isRefGuide = sel.type === 'vertical_reference' || sel.type === 'horizontal_reference';
                    const isV = sel.type === 'vertical_reference';
                    const angleDeg = isRefGuide && sel.x1 !== undefined && sel.y1 !== undefined && sel.x2 !== undefined && sel.y2 !== undefined
                      ? (isV
                          ? Math.atan2(sel.x2 - sel.x1, sel.y2 - sel.y1) * (180 / Math.PI)
                          : Math.atan2(sel.y2 - sel.y1, sel.x2 - sel.x1) * (180 / Math.PI))
                      : 0;

                    const handleSnapAlignment = () => {
                      if (!isRefGuide || sel.x1 === undefined || sel.y1 === undefined || sel.x2 === undefined || sel.y2 === undefined) return;
                      let updated: ImageAnnotationItem[];
                      if (isV) {
                        const midX = (sel.x1 + sel.x2) / 2;
                        updated = annotations.map((a) => (a.id === sel.id ? { ...a, x1: midX, x2: midX, angle: 0 } : a));
                      } else {
                        const midY = (sel.y1 + sel.y2) / 2;
                        updated = annotations.map((a) => (a.id === sel.id ? { ...a, y1: midY, y2: midY, angle: 0 } : a));
                      }
                      pushState(transform, updated);
                    };

                    const handleNudgeAngle = (delta: number) => {
                      if (!isRefGuide || sel.x1 === undefined || sel.y1 === undefined || sel.x2 === undefined || sel.y2 === undefined) return;
                      const rad = (delta * Math.PI) / 180;
                      const midX = (sel.x1 + sel.x2) / 2;
                      const midY = (sel.y1 + sel.y2) / 2;
                      const halfLen = Math.hypot(sel.x2 - sel.x1, sel.y2 - sel.y1) / 2;
                      const currentRad = Math.atan2(sel.y2 - sel.y1, sel.x2 - sel.x1);
                      const newRad = currentRad + rad;
                      const dx = Math.cos(newRad) * halfLen;
                      const dy = Math.sin(newRad) * halfLen;
                      const updated = annotations.map((a) =>
                        a.id === sel.id
                          ? {
                              ...a,
                              x1: Math.max(0, Math.min(100, midX - dx)),
                              y1: Math.max(0, Math.min(100, midY - dy)),
                              x2: Math.max(0, Math.min(100, midX + dx)),
                              y2: Math.max(0, Math.min(100, midY + dy)),
                            }
                          : a
                      );
                      pushState(transform, updated);
                    };

                    const handleToggleVisibility = () => {
                      const updated = annotations.map((a) => (a.id === sel.id ? { ...a, isHidden: !a.isHidden } : a));
                      pushState(transform, updated);
                    };

                    return (
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-2.5">
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                          <span className="flex items-center gap-1.5">
                            {isRefGuide ? <SeparatorVertical className="w-3.5 h-3.5 text-cyan-400" /> : <PenTool className="w-3.5 h-3.5 text-blue-400" />}
                            {isRefGuide
                              ? isV
                                ? (isAr ? 'خط المنتصف الرأسي' : 'Facial Midline Guide')
                                : (isAr ? 'الخط المرجعي الأفقي' : 'Horizontal Guide')
                              : (isAr ? 'عنصر التأشير المحدد' : 'Selected Markup')}
                          </span>
                          <span className="text-[10px] font-mono text-cyan-400 bg-slate-800 px-2 py-0.5 rounded">
                            {isRefGuide ? `${angleDeg.toFixed(1)}°` : sel.type}
                          </span>
                        </div>

                        {/* Reference Line Specific Controls */}
                        {isRefGuide && (
                          <div className="space-y-2 pt-1 border-t border-slate-800">
                            <div className="flex items-center justify-between text-xs text-slate-400">
                              <span>{isV ? (isAr ? 'الميل عن الرأسي:' : 'Midline Tilt:') : (isAr ? 'الميل الإطباقي:' : 'Occlusal Cant:')}</span>
                              <span className="font-mono text-cyan-300 font-bold">{angleDeg.toFixed(1)}°</span>
                            </div>

                            <div className="grid grid-cols-3 gap-1.5">
                              <button
                                onClick={() => handleNudgeAngle(-1)}
                                className="py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-mono"
                                title="Rotate -1 degree"
                              >
                                -1.0°
                              </button>
                              <button
                                onClick={handleSnapAlignment}
                                className="py-1 bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-800/60 rounded text-[11px] font-semibold"
                                title={isV ? 'Snap to perfectly vertical' : 'Snap to perfectly horizontal'}
                              >
                                {isV ? (isAr ? 'محاذاة 0°' : 'Snap 0°') : (isAr ? 'أفقي 0°' : 'Snap 0°')}
                              </button>
                              <button
                                onClick={() => handleNudgeAngle(1)}
                                className="py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-mono"
                                title="Rotate +1 degree"
                              >
                                +1.0°
                              </button>
                            </div>

                            <button
                              onClick={handleToggleVisibility}
                              className={`w-full py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border transition ${
                                sel.isHidden
                                  ? 'bg-amber-950/40 border-amber-800/60 text-amber-300 hover:bg-amber-900'
                                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                              }`}
                            >
                              {sel.isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              <span>{sel.isHidden ? (isAr ? 'إظهار الخط المرجعي' : 'Show Reference Guide') : (isAr ? 'إخفاء الخط المرجعي' : 'Hide Reference Guide')}</span>
                            </button>
                          </div>
                        )}

                        <button
                          onClick={handleDeleteSelectedAnnotation}
                          className="w-full py-2 bg-rose-950/80 hover:bg-rose-900 border border-rose-800/60 text-rose-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>{isAr ? 'حذف العنصر المحدد' : 'Delete Annotation'}</span>
                        </button>
                      </div>
                    );
                  })()}

                  {/* Text Prompt Area */}
                  {pendingTextPos && (
                    <div className="p-3 bg-slate-900 border border-blue-800/60 rounded-xl space-y-2">
                      <p className="text-xs text-blue-300 font-semibold">{isAr ? 'إدخال النص السريري:' : 'Enter Annotation Text:'}</p>
                      <input
                        type="text"
                        autoFocus
                        value={textInputPrompt || ''}
                        onChange={(e) => setTextInputPrompt(e.target.value)}
                        placeholder={isAr ? 'مثال: خط المنتصف العلوي مزاح 2 مم يميناً...' : 'e.g. Upper dental midline 2mm right...'}
                        className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded text-xs text-white"
                      />
                      <button
                        onClick={handleAddTextAnnotation}
                        className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold"
                      >
                        {isAr ? 'إضافة النص' : 'Add Text Label'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: COMPARE CONTROLS */}
              {activeTab === 'compare' && (
                <div className="space-y-4">
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {isAr
                      ? 'وضع المقارنة يتيح للمستشار معاينة الصورة الأصلية جنباً إلى جنب مع النسخة المعدلة لضمان الدقة السريرية قبل اعتماد النسخة.'
                      : 'Compare mode allows side-by-side inspection of the original raw asset versus the edited derivative before final sign-off.'}
                  </p>
                  <button
                    onClick={() => setShowOriginalComparison(!showOriginalComparison)}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    <Eye className="w-4 h-4" />
                    <span>{showOriginalComparison ? (isAr ? 'العودة للمحرر' : 'Return to Editor') : (isAr ? 'معاينة جنب إلى جنب' : 'Side-by-Side Comparison')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

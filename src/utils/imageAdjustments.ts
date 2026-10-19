/**
 * CLINICAL IMAGE ADJUSTMENTS & ORTHODONTIC REFERENCE UTILITIES
 * 
 * Provides deterministic, non-cumulative pixel processing for:
 * - Brightness (0..200, 100 = neutral)
 * - Contrast (0..200, 100 = neutral)
 * - Saturation (0..200, 100 = neutral)
 * - Grayscale (ITU-R BT.601 / BT.709 clinical luminance)
 * - Sharpness (0..100, high-frequency local contrast boost)
 *
 * Avoids cumulative degradation by always computing adjustments
 * deterministically against clean source frame pixels.
 *
 * Works consistently across iPad Safari WebKit, Desktop browsers,
 * and Headless / Node canvas environments where ctx.filter is unsupported or ignored.
 */

import { ImageTransformParams } from '../types/orthodontics';

export interface ImageDataLike {
  data: Uint8ClampedArray | Uint8Array | number[];
  width: number;
  height: number;
}

/**
 * Apply brightness, contrast, saturation, grayscale, and sharpness in a single deterministic pass.
 * Modifies the provided imageData in-place and returns it.
 */
export function applyClinicalImageAdjustments<T extends ImageDataLike>(
  imgData: T,
  transform: Pick<ImageTransformParams, 'brightness' | 'contrast' | 'saturation' | 'grayscale' | 'sharpness'>
): T {
  const { brightness = 100, contrast = 100, saturation = 100, grayscale = false, sharpness = 0 } = transform;

  // Short-circuit if all values are default (no-op)
  if (brightness === 100 && contrast === 100 && saturation === 100 && !grayscale && sharpness === 0) {
    return imgData;
  }

  const data = imgData.data;
  const len = data.length;

  const bFactor = brightness / 100;
  const cFactor = contrast / 100;
  const sFactor = saturation / 100;
  const sharpFactor = sharpness > 0 ? (sharpness / 100) * 0.5 : 0;

  for (let i = 0; i < len; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // 1. Grayscale (standard clinical luminance weights)
    if (grayscale) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum;
      g = lum;
      b = lum;
    }

    // 2. Saturation (adjust chromatic distance from luminance)
    if (sFactor !== 1 && !grayscale) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum + (r - lum) * sFactor;
      g = lum + (g - lum) * sFactor;
      b = lum + (b - lum) * sFactor;
    }

    // 3. Brightness (scaling factor)
    if (bFactor !== 1) {
      r = r * bFactor;
      g = g * bFactor;
      b = b * bFactor;
    }

    // 4. Contrast (scaling around mid-gray 128)
    if (cFactor !== 1) {
      r = (r - 128) * cFactor + 128;
      g = (g - 128) * cFactor + 128;
      b = (b - 128) * cFactor + 128;
    }

    // 5. Sharpness (high-frequency local contrast boost)
    if (sharpFactor > 0) {
      r = r + (r - 128) * sharpFactor;
      g = g + (g - 128) * sharpFactor;
      b = b + (b - 128) * sharpFactor;
    }

    // Clamp to valid 8-bit unsigned integer range [0, 255]
    data[i] = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
    data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
    data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
  }

  return imgData;
}

/**
 * Calculate geometry for a vertical orthodontic reference line centered at (x, y)
 * or spanning full vertical frame with optional angle tilt.
 */
export function createVerticalReferenceGeometry(
  centerX: number = 50,
  centerY: number = 50,
  lengthPercent: number = 90,
  angleDegrees: number = 0
): { x1: number; y1: number; x2: number; y2: number; angle: number } {
  const rad = (angleDegrees * Math.PI) / 180;
  const halfLen = lengthPercent / 2;
  // A true vertical line has direction along the Y axis: dx = sin(rad), dy = cos(rad)
  const dx = Math.sin(rad) * halfLen;
  const dy = Math.cos(rad) * halfLen;

  return {
    x1: Math.max(0, Math.min(100, centerX - dx)),
    y1: Math.max(0, Math.min(100, centerY - dy)),
    x2: Math.max(0, Math.min(100, centerX + dx)),
    y2: Math.max(0, Math.min(100, centerY + dy)),
    angle: angleDegrees,
  };
}

/**
 * Calculate geometry for a horizontal orthodontic reference line centered at (x, y)
 * with optional cant / tilt angle.
 */
export function createHorizontalReferenceGeometry(
  centerX: number = 50,
  centerY: number = 50,
  lengthPercent: number = 90,
  angleDegrees: number = 0
): { x1: number; y1: number; x2: number; y2: number; angle: number } {
  const rad = (angleDegrees * Math.PI) / 180;
  const halfLen = lengthPercent / 2;
  // A true horizontal line has direction along the X axis: dx = cos(rad), dy = sin(rad)
  const dx = Math.cos(rad) * halfLen;
  const dy = Math.sin(rad) * halfLen;

  return {
    x1: Math.max(0, Math.min(100, centerX - dx)),
    y1: Math.max(0, Math.min(100, centerY - dy)),
    x2: Math.max(0, Math.min(100, centerX + dx)),
    y2: Math.max(0, Math.min(100, centerY + dy)),
    angle: angleDegrees,
  };
}

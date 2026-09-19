// formats/imageio.js — دروازهٔ واحد بارگذاری/ذخیرهٔ تصویر
// تشخیص فرمت از «امضای باینری» (نه پسوند) — مقاوم در برابر پسوند اشتباه.
import { decodePng, encodePng } from './png.js';
import { decodeBmp, encodeBmp } from './bmp.js';
import { decodeQoi, encodeQoi } from './qoi.js';
import { decodePSD, encodePngLikePSD, isPSD, isPSB } from './psd.js';
import { decodeJPEG, encodeJPEG, isJPEG } from './jpeg.js';
import { decodeTIFF, encodeTIFF, isTIFF, isDNG } from './tiff.js';
import { srgbProfile, isICC } from './icc.js';

// شناسایی خودکار بر اساس magic bytes (مقاوم به پسوند اشتباه)
export function detectFormat(u8) {
  if (u8.length >= 8 && u8[0] === 137 && u8[1] === 80 && u8[2] === 78 && u8[3] === 71) return 'png';
  if (u8.length >= 2 && u8[0] === 0x42 && u8[1] === 0x4D) return 'bmp';
  if (u8.length >= 4 && u8[0] === 0x71 && u8[1] === 0x6F && u8[2] === 0x69 && u8[3] === 0x66) return 'qoi';
  if (u8.length >= 4 && u8[0] === 0x38 && u8[1] === 0x42 && u8[2] === 0x50 && u8[3] === 0x53) return isPSB(u8) ? 'psb' : 'psd';
  if (isJPEG(u8)) return 'jpeg';
  if (isTIFF(u8)) return isDNG(u8) ? 'dng' : 'tiff';
  // RIFF....WEBP
  if (u8.length >= 12 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 &&
      u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return 'webp';
  if (u8.length >= 6 && u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return 'gif';
  return null;
}

// بارگذاری → { width, height, data: Uint8ClampedArray RGBA }
export async function decodeImage(u8) {
  const fmt = detectFormat(u8);
  if (fmt === 'png') return decodePng(u8);
  if (fmt === 'bmp') return decodeBmp(u8);
  if (fmt === 'qoi') return decodeQoi(u8);
  if (fmt === 'psd' || fmt === 'psb') return decodePSD(u8);
  if (fmt === 'jpeg') return decodeJPEG(u8);
  if (fmt === 'tiff' || fmt === 'dng') return decodeTIFF(u8);   // DNG: ظرف TIFF، مسیر مشترک
  // WebP/GIF: رمزگشای «بومی مرورگر» (بدون وابستگی سنگین؛ مثل Photopea)
  if (fmt === 'webp' || fmt === 'gif') {
    if (typeof createImageBitmap === 'function') return decodeViaDOM(u8);
    throw new Error('WebP/GIF در این محیط (بدون DOM) پشتیبانی نمی‌شود — فایل را در برنامه باز کنید');
  }
  throw new Error('فرمت تصویر پشتیبانی نمی‌شود');
}

// رمزگشایی با موتور بومی مرورگر (برای فرمت‌هایی که مرورگر ذاتی می‌شناسد)
export async function decodeViaDOM(u8) {
  const blob = new Blob([u8]);
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close && bmp.close();
  return { width: bmp.width, height: bmp.height, data: img.data };
}

// ذخیره → Uint8Array باینری فایل. format: png|jpeg|bmp|qoi|psd|psb|tiff
export async function encodeImage({ width, height, data }, format = 'png', opts = {}) {
  // embedICC پیش‌فرض روشن است: خروجی «رنگ‌شناس» می‌شود (مثل Save با Profile در فتوشاپ)
  const icc = opts.embedICC === false ? null : (opts.icc || srgbProfile());
  if (format === 'png') return encodePng({ width, height, data }, { icc, gamma: opts.gamma });
  if (format === 'bmp') return encodeBmp({ width, height, data });
  if (format === 'qoi') return encodeQoi({ width, height, data });
  if (format === 'psd' || format === 'psb') return encodePngLikePSD({ width, height, data });
  if (format === 'jpeg' || format === 'jpg') return encodeJPEG({ width, height, data }, opts.quality, { icc });
  if (format === 'tiff' || format === 'tif') return encodeTIFF({ width, height, data }, { alpha: opts.alpha !== false, icc });
  throw new Error(`فرمت خروجی «${format}» پشتیبانی نمی‌شود`);
}

// استخراج پروفایل ICC از فایل ورودی (PNG iCCP / JPEG APP2 / TIFF tag 34675)
export function extractICC(u8) {
  const fmt = detectFormat(u8);
  try {
    if (fmt === 'jpeg') {
      let i = 2;
      while (i < u8.length - 4) {
        if (u8[i] !== 0xFF) { i++; continue; }
        const m = u8[i + 1];
        if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
        const len = (u8[i + 2] << 8) | u8[i + 3];
        if (m === 0xE2) {
          const tag = String.fromCharCode(...u8.subarray(i + 4, i + 15));
          if (tag === 'ICC_PROFILE') return u8.slice(i + 18, i + 2 + len);
        }
        if (m === 0xDA) break;   // شروع دادهٔ اسکن — دیگر متادیتا نیست
        i += 2 + len;
      }
      return null;
    }
    if (fmt === 'png') {
      let i = 8;
      while (i < u8.length - 12) {
        const len = ((u8[i] << 24) | (u8[i + 1] << 16) | (u8[i + 2] << 8) | u8[i + 3]) >>> 0;
        const type = String.fromCharCode(u8[i + 4], u8[i + 5], u8[i + 6], u8[i + 7]);
        if (type === 'iCCP') {
          // name(NUL) + method + zlib(profile) — فقط خود پروفایل خام را نمی‌توان بدون inflate خواند
          return { compressed: u8.slice(i + 8, i + 8 + len) };
        }
        if (type === 'IDAT' || type === 'IEND') break;
        i += 12 + len;
      }
      return null;
    }
  } catch { /* فایل ناقص */ }
  return null;
}

export { srgbProfile, isICC };

// پسوند → format
export function formatFromName(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  const ext = m ? m[1].toLowerCase() : '';
  if (ext === 'png') return 'png';
  if (ext === 'bmp') return 'bmp';
  if (ext === 'qoi') return 'qoi';
  if (ext === 'psd') return 'psd';
  if (ext === 'psb') return 'psb';
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
  if (ext === 'tif' || ext === 'tiff') return 'tiff';
  return 'png'; // پیش‌فرض امن
}

// فهرست فرمت‌های پشتیبانی‌شده (برای UI)
export const OPEN_FORMATS = ['png', 'jpeg', 'psd', 'psb', 'bmp', 'qoi', 'tiff', 'dng', 'webp', 'gif'];
export const SAVE_FORMATS = ['png', 'jpeg', 'psd', 'tiff', 'bmp', 'qoi'];

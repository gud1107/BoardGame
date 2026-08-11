"use client";

/**
 * Browser-only file/image helpers for bug report attachments (FileReader,
 * `<canvas>`, `Image`). Not unit-testable under this project's node-only
 * vitest environment — see `validate.ts`'s header comment. Verify visually
 * instead after UI changes here.
 */

/** Reads a File as a base64 `data:` URI. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("파일을 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });
}

const MAX_DIMENSION = 1280;

/**
 * Downscales an image data URL so attachments stay small enough for an
 * IndexedDB record (and any Supabase JSONB mirror). GIFs are returned
 * unchanged — redrawing one frame onto a canvas would silently flatten the
 * animation, which is worse than just keeping the original size.
 */
export function compressImageDataUrl(dataUrl: string, mimeType: string): Promise<string> {
  if (mimeType === "image/gif") return Promise.resolve(dataUrl);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => reject(new Error("이미지를 불러올 수 없습니다."));
    img.src = dataUrl;
  });
}

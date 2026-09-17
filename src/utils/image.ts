/**
 * Downscales a picked image to a small square JPEG data URL, in the browser,
 * before it is uploaded.
 *
 * A phone photo is several megabytes; base64 inflates that by a third. The
 * avatar is rendered at 56px at most, so sending the original would be
 * absurd - and the previous implementation put exactly that into
 * localStorage, where it silently blew the ~5MB quota and threw
 * QuotaExceededError out of the click handler with no message at all.
 *
 * 256px JPEG at quality 0.8 lands around 10-25KB, which is well inside the
 * server's 250KB cap.
 */
export async function downscaleImageToDataUrl(
  file: File,
  maxSize = 256,
  quality = 0.8,
): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Зураг уншиж чадсангүй'));
      img.src = objectUrl;
    });

    // Cover-crop to a square so avatars are never stretched.
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const sx = (image.naturalWidth - side) / 2;
    const sy = (image.naturalHeight - side) / 2;
    const target = Math.min(maxSize, side) || maxSize;

    const canvas = document.createElement('canvas');
    canvas.width = target;
    canvas.height = target;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Зураг боловсруулах боломжгүй байна');
    ctx.drawImage(image, sx, sy, side, side, 0, 0, target, target);

    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export const MAX_UPLOAD_IMAGE_BYTES = 10 * 1024 * 1024;

export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'Зөвхөн зургийн файл сонгоно уу.';
  if (file.size > MAX_UPLOAD_IMAGE_BYTES) return 'Зураг хэт том байна (10MB-аас бага).';
  return null;
}

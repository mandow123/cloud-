export const ACTIVITY_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const ACTIVITY_UPLOAD_MAX_PIXELS = 40_000_000;
export const ACTIVITY_UPLOAD_MAX_DIMENSION = 16_384;
export const ACTIVITY_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type Dimensions = { width: number; height: number };

function be32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function le24(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function validDimensions(value: Dimensions | null): Dimensions | null {
  if (!value || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width < 1 || value.height < 1) return null;
  if (value.width > ACTIVITY_UPLOAD_MAX_DIMENSION || value.height > ACTIVITY_UPLOAD_MAX_DIMENSION || value.width * value.height > ACTIVITY_UPLOAD_MAX_PIXELS) return null;
  return value;
}

function pngDimensions(bytes: Uint8Array): Dimensions | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 45 || !signature.every((value, index) => bytes[index] === value) || be32(bytes, 8) !== 13 || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return null;
  let offset = 8;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const size = be32(bytes, offset);
    if (size > ACTIVITY_UPLOAD_MAX_BYTES || offset + 12 + size > bytes.length) return null;
    const kind = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    offset += 12 + size;
    if (kind === "IEND") { ended = size === 0 && offset === bytes.length; break; }
  }
  return ended ? { width: be32(bytes, 16), height: be32(bytes, 20) } : null;
}

function jpegDimensions(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return null;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 <= bytes.length - 2) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > bytes.length) return null;
    const size = (bytes[offset] << 8) | bytes[offset + 1];
    if (size < 2 || offset + size > bytes.length) return null;
    if (sof.has(marker)) {
      if (size < 7) return null;
      return { width: (bytes[offset + 5] << 8) | bytes[offset + 6], height: (bytes[offset + 3] << 8) | bytes[offset + 4] };
    }
    offset += size;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 30 || String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF" || String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP") return null;
  const declared = (bytes[4] | bytes[5] << 8 | bytes[6] << 16 | bytes[7] << 24) >>> 0;
  if (declared + 8 !== bytes.length) return null;
  const kind = String.fromCharCode(...bytes.slice(12, 16));
  if (kind === "VP8X") return { width: le24(bytes, 24) + 1, height: le24(bytes, 27) + 1 };
  if (kind === "VP8L" && bytes[20] === 0x2f) return { width: 1 + (bytes[21] | (bytes[22] & 0x3f) << 8), height: 1 + ((bytes[22] & 0xc0) >> 6 | bytes[23] << 2 | (bytes[24] & 0x0f) << 10) };
  if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { width: (bytes[26] | bytes[27] << 8) & 0x3fff, height: (bytes[28] | bytes[29] << 8) & 0x3fff };
  return null;
}

export function inspectActivityImage(bytes: Uint8Array, contentType: string): Dimensions | null {
  if (bytes.length < 1 || bytes.length > ACTIVITY_UPLOAD_MAX_BYTES || !ACTIVITY_UPLOAD_TYPES.has(contentType)) return null;
  const dimensions = contentType === "image/png" ? pngDimensions(bytes) : contentType === "image/jpeg" ? jpegDimensions(bytes) : webpDimensions(bytes);
  return validDimensions(dimensions);
}

// Magic-byte MIME sniffing. Never trust browser-reported Content-Type.
// ADR 0018 requires defense in depth — this file runs both in TS (upload UI)
// and its algorithm is mirrored in Rust (attach_product_image) server-side.

import type { ImageMime } from "./types.js";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]; // \x89PNG\r\n\x1a\n
const JPEG_SOI = [0xff, 0xd8, 0xff]; // JPEG start-of-image
const RIFF = [0x52, 0x49, 0x46, 0x46]; // 'RIFF'
const WEBP = [0x57, 0x45, 0x42, 0x50]; // 'WEBP' at offset 8

function startsWith(buf: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[offset + i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Sniff MIME from raw image bytes.
 * Returns null when no whitelisted type matches — caller MUST reject.
 */
export function sniffMime(bytes: Uint8Array): ImageMime | null {
  if (startsWith(bytes, PNG_SIG)) return "image/png";
  if (startsWith(bytes, JPEG_SOI)) return "image/jpeg";
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return "image/webp";
  return null;
}

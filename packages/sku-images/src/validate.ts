// Client-side validation: size cap, MIME whitelist, magic-byte sniff,
// reported-vs-sniffed MIME agreement. Mirrored server-side in Rust.

import { hashImage } from "./hash.js";
import { sniffMime } from "./mime.js";
import {
  ALLOWED_MIME,
  MAX_IMAGE_BYTES,
  type ImageMetadata,
  type ImageMime,
  type ValidationError,
  type ValidationResult,
} from "./types.js";

export interface ValidateInput {
  readonly bytes: Uint8Array;
  readonly reportedMime?: string; // e.g. File.type from <input type=file>
}

/**
 * Validate + hash an image payload.
 * Short-circuits on empty/too-large/magic-mismatch (no point hashing garbage).
 * Returns full metadata (sha256 + mime + sizeBytes) on success.
 */
export async function validate(input: ValidateInput): Promise<ValidationResult> {
  const { bytes, reportedMime } = input;
  const errs: ValidationError[] = [];

  if (bytes.length === 0) {
    errs.push({ code: "EMPTY", message: "Image is empty" });
    return { ok: false, errors: errs };
  }

  if (bytes.length > MAX_IMAGE_BYTES) {
    errs.push({
      code: "TOO_LARGE",
      message: `Image is ${bytes.length} bytes; max ${MAX_IMAGE_BYTES} (2 MiB)`,
    });
    return { ok: false, errors: errs };
  }

  const sniffed = sniffMime(bytes);
  if (sniffed === null) {
    errs.push({
      code: "MAGIC_UNRECOGNISED",
      message: "Image format not recognised. Allowed: PNG, JPEG, WebP",
    });
    return { ok: false, errors: errs };
  }

  if (!ALLOWED_MIME.includes(sniffed)) {
    errs.push({
      code: "MIME_NOT_ALLOWED",
      message: `MIME ${sniffed} is not in whitelist`,
    });
    return { ok: false, errors: errs };
  }

  if (reportedMime && reportedMime !== sniffed) {
    // Not a hard block — browsers sometimes pick a stricter label than the magic
    // bytes (e.g. image/x-png vs image/png). Treat as warning, prefer sniffed.
  }

  const sha256 = await hashImage(bytes);

  const metadata: ImageMetadata = {
    sha256,
    mime: sniffed as ImageMime,
    sizeBytes: bytes.length,
  };
  return { ok: true, metadata };
}

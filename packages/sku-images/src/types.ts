// X2 SKU Images — shared types.
// ADR: docs/adr/0018-x2-sku-images.md

export type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export const ALLOWED_MIME: readonly ImageMime[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** 2 MiB hard cap (matches SQLite CHECK in migration 0017). */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export interface ImageMetadata {
  readonly sha256: string; // 64 hex chars
  readonly mime: ImageMime;
  readonly sizeBytes: number;
  readonly widthPx?: number;
  readonly heightPx?: number;
}

export type ValidationCode =
  | "EMPTY"
  | "TOO_LARGE"
  | "MIME_NOT_ALLOWED"
  | "MIME_MISMATCH"
  | "MAGIC_UNRECOGNISED";

export interface ValidationError {
  readonly code: ValidationCode;
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly metadata: ImageMetadata }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

// @pharmacare/crypto — AES-256-GCM at-rest encryption helpers.
//
// v2.0 Playbook §8.1 / Principle #6 — PII/Rx never leaves shop LAN
// without explicit per-feature opt-in. This package is the canonical
// home for any at-rest or in-transit encryption helper used by the
// desktop app or its workers.
//
// S26.E (silent killer #5) — replaces the throw-everywhere stub with a
// real implementation. Threat model + rotation in ADR-0071.
//
// Scope (v0.2):
//   * AES-256-GCM envelope: 12-byte nonce + ciphertext-with-tag.
//   * HMAC-SHA256 for tamper-evidence chains.
//   * PBKDF2-SHA256 (100k iterations) to derive a KEK from a password.
//   * DEK generation (32 random bytes from the OS CSPRNG).
//   * Versioned blob serialization: version || nonce || ciphertext+tag.
//   * Constant-time equality.
//
// Design notes:
//   * Uses node:crypto, which is Node 22+ stdlib (Node 22 is pinned in
//     CI and as the desktop bundler's runtime). No new dependencies.
//   * NEVER invent crypto. Every primitive maps 1:1 to a vetted stdlib
//     call. All keys are 32 bytes (AES-256). All nonces are 12 bytes
//     (AES-GCM standard). Auth tag is 16 bytes (default GCM tag length).
//   * Keys are passed as Uint8Array so the same surface works in any
//     JS runtime that exposes `node:crypto` (currently only Node, but
//     a browser/WebCrypto port is intentionally a future-week task).

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual as nodeTimingSafeEqual,
} from "node:crypto";

export const CRYPTO_VERSION = "0.2.0" as const;

/** Minimum PBKDF2 iteration count enforced by deriveKekFromPassword. */
export const PBKDF2_MIN_ITERATIONS = 100_000;

/** Default PBKDF2 iteration count (NIST SP 800-132 floor for password KEKs). */
export const PBKDF2_DEFAULT_ITERATIONS = 100_000;

/** AES-256-GCM nonce is fixed at 12 bytes. */
export const GCM_NONCE_BYTES = 12;

/** AES-256-GCM auth tag is fixed at 16 bytes (default). */
export const GCM_TAG_BYTES = 16;

/** Symmetric key size for AES-256. */
export const KEY_BYTES = 32;

/** Current envelope serialization version. Stored as the first byte. */
export const BLOB_VERSION = 1 as const;

/**
 * Raised when a primitive cannot complete because a prerequisite is
 * missing — most commonly the KEK on first launch before the OS
 * keyring has been seeded. Kept on the public surface so callers can
 * branch on the type, but the runtime no longer throws this for
 * regular encrypt/decrypt operations.
 *
 * @deprecated Retained only for fallback paths; real crypto now ships.
 */
export class CryptoNotImplementedError extends Error {
  constructor(op: string) {
    super(
      `@pharmacare/crypto: ${op} prerequisite missing (likely KEK not yet ` +
        `present in OS keyring on first launch). See ADR-0071.`,
    );
    this.name = "CryptoNotImplementedError";
  }
}

/**
 * In-memory AES-GCM envelope. The nonce is unique per encryption and
 * MUST NOT be reused with the same key — generate fresh from a CSPRNG.
 * The ciphertext field is the AES-GCM output INCLUDING the 16-byte
 * authentication tag appended at the end (Node convention).
 */
export interface EncryptedBlob {
  readonly version: 1;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

function assertKey(dek: Uint8Array, op: string): void {
  if (dek.length !== KEY_BYTES) {
    throw new Error(
      `@pharmacare/crypto: ${op} requires a ${KEY_BYTES}-byte key (got ${dek.length})`,
    );
  }
}

/** Encrypt plaintext with AES-256-GCM. Generates a fresh 12-byte nonce. */
export function encryptAesGcm(plaintext: Uint8Array, dek: Uint8Array): EncryptedBlob {
  assertKey(dek, "encryptAesGcm");
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(dek), nonce);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = new Uint8Array(ct.length + tag.length);
  ciphertext.set(ct, 0);
  ciphertext.set(tag, ct.length);
  return { version: BLOB_VERSION, nonce: new Uint8Array(nonce), ciphertext };
}

/**
 * Decrypt an AES-256-GCM envelope. Throws on auth-tag mismatch (wrong
 * key, tampered ciphertext, or tampered nonce).
 */
export function decryptAesGcm(blob: EncryptedBlob, dek: Uint8Array): Uint8Array {
  assertKey(dek, "decryptAesGcm");
  if (blob.version !== BLOB_VERSION) {
    throw new Error(`@pharmacare/crypto: unsupported blob version ${blob.version}`);
  }
  if (blob.nonce.length !== GCM_NONCE_BYTES) {
    throw new Error(
      `@pharmacare/crypto: nonce must be ${GCM_NONCE_BYTES} bytes (got ${blob.nonce.length})`,
    );
  }
  if (blob.ciphertext.length < GCM_TAG_BYTES) {
    throw new Error("@pharmacare/crypto: ciphertext too short to contain auth tag");
  }
  const ctLen = blob.ciphertext.length - GCM_TAG_BYTES;
  const ct = Buffer.from(blob.ciphertext.subarray(0, ctLen));
  const tag = Buffer.from(blob.ciphertext.subarray(ctLen));
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(dek), Buffer.from(blob.nonce));
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return new Uint8Array(pt);
}

/** HMAC-SHA256. Returns a 32-byte digest. */
export function hmacSha256(message: Uint8Array, key: Uint8Array): Uint8Array {
  const h = createHmac("sha256", Buffer.from(key));
  h.update(Buffer.from(message));
  return new Uint8Array(h.digest());
}

/** Generate a fresh 32-byte Data Encryption Key from the OS CSPRNG. */
export function generateDek(): Uint8Array {
  return new Uint8Array(randomBytes(KEY_BYTES));
}

/**
 * Derive a Key Encryption Key from a password + salt via PBKDF2-SHA256.
 *
 * The KEK is what wraps the DEK in the OS keyring's pre-keyring path
 * (e.g. headless backups, restore-on-new-machine flows where the user
 * re-types the master password). Same input → same output.
 */
export function deriveKekFromPassword(
  password: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_DEFAULT_ITERATIONS,
): Uint8Array {
  if (iterations < PBKDF2_MIN_ITERATIONS) {
    throw new Error(
      `@pharmacare/crypto: PBKDF2 iterations must be >= ${PBKDF2_MIN_ITERATIONS} (got ${iterations})`,
    );
  }
  const out = pbkdf2Sync(password, Buffer.from(salt), iterations, KEY_BYTES, "sha256");
  return new Uint8Array(out);
}

/**
 * Serialize an envelope into a single byte array suitable for storage
 * in a SQLite BLOB column.
 *
 * Layout: [version : u8] [nonce : 12 bytes] [ciphertext+tag : N bytes]
 */
export function serializeBlob(b: EncryptedBlob): Uint8Array {
  if (b.nonce.length !== GCM_NONCE_BYTES) {
    throw new Error("@pharmacare/crypto: serializeBlob: nonce length mismatch");
  }
  const out = new Uint8Array(1 + GCM_NONCE_BYTES + b.ciphertext.length);
  out[0] = b.version;
  out.set(b.nonce, 1);
  out.set(b.ciphertext, 1 + GCM_NONCE_BYTES);
  return out;
}

/** Reverse of serializeBlob. Rejects unknown versions. */
export function deserializeBlob(bytes: Uint8Array): EncryptedBlob {
  if (bytes.length < 1 + GCM_NONCE_BYTES + GCM_TAG_BYTES) {
    throw new Error("@pharmacare/crypto: deserializeBlob: input too short");
  }
  const version = bytes[0];
  if (version !== BLOB_VERSION) {
    throw new Error(
      `@pharmacare/crypto: deserializeBlob: unsupported version ${String(version)} (expected ${BLOB_VERSION})`,
    );
  }
  const nonce = bytes.slice(1, 1 + GCM_NONCE_BYTES);
  const ciphertext = bytes.slice(1 + GCM_NONCE_BYTES);
  return { version: BLOB_VERSION, nonce, ciphertext };
}

/** Constant-time equality for short byte strings (tokens, HMACs). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return nodeTimingSafeEqual(Buffer.from(a), Buffer.from(b));
}

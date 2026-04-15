// @pharmacare/crypto
// v2.0 Playbook §8.1 / Principle #6 — PII/Rx never leaves shop LAN without
// explicit per-feature opt-in. This package is the canonical home for any
// at-rest or in-transit encryption helper used by the desktop/worker.
//
// Scope (v0.1):
//   - AES-GCM-256 envelope helpers for SQLite blob columns (Rx images, IDs)
//   - HMAC-SHA256 for audit-log tamper-evidence chains
//   - constant-time equality
//
// Policy:
//   - Never invent crypto. Wrap WebCrypto (browser/worker) or node:crypto.
//   - Keys come from the OS keyring (desktop) or KMS (cloud). Never from env.
//   - This module has NO runtime today. Importers get a typed stub that
//     throws with a clear "not yet implemented" message so any premature
//     wiring fails loudly in tests, not silently in production.

export const CRYPTO_VERSION = "0.1.0-stub" as const;

export class CryptoNotImplementedError extends Error {
  constructor(op: string) {
    super(
      `@pharmacare/crypto: ${op} is not implemented yet. ` +
        `See AUDIT_REPORT_2026-04-15.md §6 branch F-CRYPTO before calling this.`,
    );
    this.name = "CryptoNotImplementedError";
  }
}

export interface AesGcmEnvelope {
  iv: string;
  ct: string;
  aad?: string;
}

export function encryptAesGcm(_plaintext: Uint8Array, _keyHandle: string, _aad?: Uint8Array): Promise<AesGcmEnvelope> {
  throw new CryptoNotImplementedError("encryptAesGcm");
}

export function decryptAesGcm(_envelope: AesGcmEnvelope, _keyHandle: string): Promise<Uint8Array> {
  throw new CryptoNotImplementedError("decryptAesGcm");
}

export function hmacSha256(_data: Uint8Array, _keyHandle: string): Promise<Uint8Array> {
  throw new CryptoNotImplementedError("hmacSha256");
}

/** Constant-time equality for short byte strings (tokens, HMACs). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    diff |= x ^ y;
  }
  return diff === 0;
}

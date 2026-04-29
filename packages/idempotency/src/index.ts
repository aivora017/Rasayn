// @pharmacare/idempotency
// Idempotency token generation + canonical request hashing.
// Closes ADR-0030 / coverage_gaps C03 — duplicate bill/GRN/refund on retry.
//
// Contract:
//   1. Client generates a UUIDv7 token before issuing the command.
//   2. Client sends { idempotencyToken, ...payload }.
//   3. Server checks `idempotency_tokens(token)`. If present and request_hash
//      matches, replay cached response_json. If present and hash differs,
//      reject with IDEMPOTENCY_CONFLICT (caller's bug — same token, different
//      payload). If absent, run the command and persist (token, hash, response).
//   4. Nightly GC purges rows where expires_at < now.

/**
 * UUIDv7 (time-ordered, v7 from RFC 9562) generator. Sortable by creation time
 * which makes index scans on (shop_id, command, created_at) cheap.
 *
 * Layout (128 bits):
 *   48 bits  unix_ts_ms
 *    4 bits  ver = 7
 *   12 bits  rand_a
 *    2 bits  var = 0b10
 *   62 bits  rand_b
 */
export function uuidv7(): string {
  const ts = BigInt(Date.now()); // ms since epoch
  const rand = new Uint8Array(10);
  // Browser/Node both have crypto.getRandomValues
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(rand);
  } else {
    // dev-only fallback; never use in prod
    for (let i = 0; i < rand.length; i++) rand[i] = Math.floor(Math.random() * 256);
  }

  // Build 16-byte buffer
  const b = new Uint8Array(16);
  // 48-bit ts
  b[0] = Number((ts >> 40n) & 0xffn);
  b[1] = Number((ts >> 32n) & 0xffn);
  b[2] = Number((ts >> 24n) & 0xffn);
  b[3] = Number((ts >> 16n) & 0xffn);
  b[4] = Number((ts >> 8n) & 0xffn);
  b[5] = Number(ts & 0xffn);
  // version (7) in high nibble of byte 6
  b[6] = ((rand[0]! & 0x0f) | 0x70) & 0xff;
  b[7] = rand[1]!;
  // variant 10 in high two bits of byte 8
  b[8] = ((rand[2]! & 0x3f) | 0x80) & 0xff;
  b[9] = rand[3]!;
  for (let i = 10; i < 16; i++) b[i] = rand[i - 6]!;

  return (
    hex(b.subarray(0, 4)) + "-" +
    hex(b.subarray(4, 6)) + "-" +
    hex(b.subarray(6, 8)) + "-" +
    hex(b.subarray(8, 10)) + "-" +
    hex(b.subarray(10, 16))
  );
}

function hex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** True iff `s` is a syntactically valid UUID v7 (lowercase, no braces). */
export function isUuidV7(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
}

/**
 * Canonical request hash — SHA-256 of the JSON-serialized payload with keys
 * sorted recursively. Same payload always yields the same hash regardless of
 * key order or whitespace. Used to detect IDEMPOTENCY_CONFLICT (same token
 * resubmitted with a different payload — caller's bug).
 *
 * Implementation note: synchronous, pure, no Web Crypto needed for tests.
 * Uses a tiny FNV-1a-128 fallback when SubtleCrypto is unavailable. In Tauri
 * (browser) and Node 20+ SubtleCrypto IS available — production code path.
 */
export async function canonicalRequestHash(payload: unknown): Promise<string> {
  const canonical = canonicalize(payload);
  const json = JSON.stringify(canonical);

  const subtle = (globalThis as unknown as { crypto?: Crypto }).crypto?.subtle;
  if (subtle) {
    const buf = new TextEncoder().encode(json);
    const out = await subtle.digest("SHA-256", buf);
    return hex(new Uint8Array(out));
  }
  // Fallback (used only in test envs without SubtleCrypto). Deterministic but
  // NOT cryptographically secure — fine because we just need collision
  // resistance against accidental same-token-different-payload, not adversarial.
  return fnv1a128Hex(json);
}

/** Sort object keys recursively. Arrays preserve order. */
function canonicalize(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>).sort()) {
    out[k] = canonicalize((v as Record<string, unknown>)[k]);
  }
  return out;
}

function fnv1a128Hex(s: string): string {
  // 128-bit FNV-1a fallback; constants from offical FNV spec.
  let h0 = 0x6c62272en, h1 = 0xe07bb014n, h2 = 0x62b82175n, h3 = 0x6295c58dn;
  const PRIME0 = 0n, PRIME1 = 0x01000000n, PRIME2 = 0n, PRIME3 = 0x0000013bn;
  void PRIME0; void PRIME2;
  for (let i = 0; i < s.length; i++) {
    const c = BigInt(s.charCodeAt(i));
    h3 ^= c;
    // multiply by FNV prime — simplified rolling 32-bit operations
    const nh0 = (h0 * PRIME1) & 0xffffffffn;
    const nh1 = (h1 * PRIME1 + h0 * PRIME3) & 0xffffffffn;
    const nh2 = (h2 * PRIME1 + h1 * PRIME3) & 0xffffffffn;
    const nh3 = (h3 * PRIME1 + h2 * PRIME3) & 0xffffffffn;
    h0 = nh0; h1 = nh1; h2 = nh2; h3 = nh3;
  }
  return (
    h0.toString(16).padStart(8, "0") +
    h1.toString(16).padStart(8, "0") +
    h2.toString(16).padStart(8, "0") +
    h3.toString(16).padStart(8, "0")
  );
}

/** TTL for idempotency rows. 24 hours per ADR-0030. */
export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Compute expires_at (ISO8601) given a creation timestamp (or now). */
export function expiresAt(createdAtMs: number = Date.now()): string {
  return new Date(createdAtMs + TOKEN_TTL_MS).toISOString();
}

/** Error thrown by callers when idempotency token replay detected a conflict. */
export class IdempotencyConflictError extends Error {
  public readonly code = "IDEMPOTENCY_CONFLICT" as const;
  public readonly token: string;
  public readonly command: string;
  constructor(token: string, command: string) {
    super(
      `IDEMPOTENCY_CONFLICT: token ${token} previously used for command ${command} ` +
      `with a different payload. Generate a new token for new requests.`,
    );
    this.token = token;
    this.command = command;
  }
}

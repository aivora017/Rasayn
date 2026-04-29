import { describe, it, expect } from "vitest";
import {
  uuidv7,
  isUuidV7,
  canonicalRequestHash,
  expiresAt,
  TOKEN_TTL_MS,
  IdempotencyConflictError,
} from "./index.js";

describe("uuidv7", () => {
  it("produces well-formed v7 UUIDs", () => {
    const id = uuidv7();
    expect(isUuidV7(id)).toBe(true);
  });

  it("each call returns a unique value", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(uuidv7());
    expect(set.size).toBe(1000);
  });

  it("ids generated in sequence sort lexicographically by time", () => {
    const a = uuidv7();
    // small delay so the ms timestamp progresses
    const start = Date.now();
    while (Date.now() === start) { /* spin one ms */ }
    const b = uuidv7();
    expect(a < b).toBe(true);
  });

  it("rejects non-v7 inputs in isUuidV7", () => {
    expect(isUuidV7("not-a-uuid")).toBe(false);
    expect(isUuidV7("550e8400-e29b-41d4-a716-446655440000")).toBe(false); // v4 — wrong version nibble
    expect(isUuidV7("0190d13f-1234-7abc-9def-1234567890ab")).toBe(true);
  });
});

describe("canonicalRequestHash", () => {
  it("returns the same hash regardless of key order", async () => {
    const a = await canonicalRequestHash({ b: 2, a: 1 });
    const b = await canonicalRequestHash({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it("returns the same hash regardless of nested key order", async () => {
    const a = await canonicalRequestHash({ outer: { z: 9, a: 1 }, top: "v" });
    const b = await canonicalRequestHash({ top: "v", outer: { a: 1, z: 9 } });
    expect(a).toBe(b);
  });

  it("different payloads produce different hashes", async () => {
    const a = await canonicalRequestHash({ x: 1 });
    const b = await canonicalRequestHash({ x: 2 });
    expect(a).not.toBe(b);
  });

  it("preserves array order (changes hash if reordered)", async () => {
    const a = await canonicalRequestHash([1, 2, 3]);
    const b = await canonicalRequestHash([3, 2, 1]);
    expect(a).not.toBe(b);
  });

  it("handles primitives", async () => {
    expect(await canonicalRequestHash("hello")).toBeTypeOf("string");
    expect(await canonicalRequestHash(42)).toBeTypeOf("string");
    expect(await canonicalRequestHash(null)).toBeTypeOf("string");
  });
});

describe("expiresAt", () => {
  it("is exactly TOKEN_TTL_MS after createdAt", () => {
    const t0 = 1_700_000_000_000;
    const exp = expiresAt(t0);
    const back = Date.parse(exp);
    expect(back - t0).toBe(TOKEN_TTL_MS);
  });

  it("defaults to now + 24h", () => {
    const before = Date.now();
    const exp = Date.parse(expiresAt());
    const after = Date.now();
    expect(exp).toBeGreaterThanOrEqual(before + TOKEN_TTL_MS);
    expect(exp).toBeLessThanOrEqual(after + TOKEN_TTL_MS);
  });
});

describe("IdempotencyConflictError", () => {
  it("carries token + command + IDEMPOTENCY_CONFLICT code", () => {
    const e = new IdempotencyConflictError("abc-123", "save_bill");
    expect(e.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(e.token).toBe("abc-123");
    expect(e.command).toBe("save_bill");
    expect(e.message).toContain("save_bill");
    expect(e.message).toContain("abc-123");
  });
});

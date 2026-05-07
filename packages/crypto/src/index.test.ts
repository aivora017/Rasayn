import { describe, it, expect } from "vitest";
import {
  CRYPTO_VERSION,
  CryptoNotImplementedError,
  PBKDF2_MIN_ITERATIONS,
  GCM_NONCE_BYTES,
  KEY_BYTES,
  encryptAesGcm,
  decryptAesGcm,
  hmacSha256,
  generateDek,
  deriveKekFromPassword,
  serializeBlob,
  deserializeBlob,
  timingSafeEqual,
} from "./index.js";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

const fixedSalt = new Uint8Array([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
]);

describe("@pharmacare/crypto v0.2", () => {
  it("exposes the bumped version marker", () => {
    expect(CRYPTO_VERSION).toBe("0.2.0");
  });

  it("CryptoNotImplementedError is constructible (kept for fallback paths)", () => {
    const e = new CryptoNotImplementedError("kek_load");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("CryptoNotImplementedError");
  });

  it("encryptAesGcm + decryptAesGcm round-trip on small bytes", () => {
    const dek = generateDek();
    const blob = encryptAesGcm(enc("hello"), dek);
    expect(blob.version).toBe(1);
    expect(blob.nonce.length).toBe(GCM_NONCE_BYTES);
    const pt = decryptAesGcm(blob, dek);
    expect(dec(pt)).toBe("hello");
  });

  it("encryptAesGcm + decryptAesGcm round-trip on 1MB bytes (Rx scan size)", () => {
    const dek = generateDek();
    const big = new Uint8Array(1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = (i * 7) & 0xff;
    const blob = encryptAesGcm(big, dek);
    const pt = decryptAesGcm(blob, dek);
    expect(pt.length).toBe(big.length);
    // sample a few indices to keep the assertion fast
    expect(pt[0]).toBe(big[0]);
    expect(pt[12345]).toBe(big[12345]);
    expect(pt[big.length - 1]).toBe(big[big.length - 1]);
  });

  it("decryptAesGcm with wrong DEK throws (auth tag mismatch)", () => {
    const dek = generateDek();
    const wrong = generateDek();
    const blob = encryptAesGcm(enc("secret-rx-data"), dek);
    expect(() => decryptAesGcm(blob, wrong)).toThrow();
  });

  it("decryptAesGcm with tampered ciphertext throws", () => {
    const dek = generateDek();
    const blob = encryptAesGcm(enc("secret-rx-data"), dek);
    const tampered = {
      version: blob.version,
      nonce: blob.nonce,
      // flip a bit in the body, not in the auth tag
      ciphertext: (() => {
        const c = new Uint8Array(blob.ciphertext);
        c[0] = (c[0] ?? 0) ^ 0x01;
        return c;
      })(),
    } as const;
    expect(() => decryptAesGcm(tampered, dek)).toThrow();
  });

  it("two encrypts of same plaintext + key produce DIFFERENT ciphertexts", () => {
    const dek = generateDek();
    const a = encryptAesGcm(enc("dup-input"), dek);
    const b = encryptAesGcm(enc("dup-input"), dek);
    // nonces differ → ciphertexts differ; this is the GCM uniqueness guarantee.
    expect(timingSafeEqual(a.nonce, b.nonce)).toBe(false);
    expect(timingSafeEqual(a.ciphertext, b.ciphertext)).toBe(false);
  });

  it("generateDek returns 32 random bytes; two calls differ", () => {
    const a = generateDek();
    const b = generateDek();
    expect(a.length).toBe(KEY_BYTES);
    expect(b.length).toBe(KEY_BYTES);
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it("hmacSha256 matches RFC 4231 test vector 1", () => {
    // RFC 4231 §4.2: key = 0x0b * 20, data = "Hi There"
    const key = new Uint8Array(20).fill(0x0b);
    const data = new TextEncoder().encode("Hi There");
    const expectedHex =
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7";
    const got = hmacSha256(data, key);
    const gotHex = Array.from(got)
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    expect(gotHex).toBe(expectedHex);
  });

  it("serialize + deserialize round-trip preserves all fields", () => {
    const dek = generateDek();
    const blob = encryptAesGcm(enc("round-trip-me"), dek);
    const bytes = serializeBlob(blob);
    expect(bytes[0]).toBe(1); // version byte
    expect(bytes.length).toBe(1 + GCM_NONCE_BYTES + blob.ciphertext.length);
    const back = deserializeBlob(bytes);
    expect(back.version).toBe(blob.version);
    expect(timingSafeEqual(back.nonce, blob.nonce)).toBe(true);
    expect(timingSafeEqual(back.ciphertext, blob.ciphertext)).toBe(true);
    // and the decrypt-after-deserialize path works end-to-end
    expect(dec(decryptAesGcm(back, dek))).toBe("round-trip-me");
  });

  it("deserializeBlob rejects version != 1 with a clear error", () => {
    const dek = generateDek();
    const blob = encryptAesGcm(enc("v"), dek);
    const bytes = serializeBlob(blob);
    bytes[0] = 9; // forge a bogus version
    expect(() => deserializeBlob(bytes)).toThrow(/unsupported version 9/);
  });

  it("deriveKekFromPassword: same input → same output (deterministic)", () => {
    const a = deriveKekFromPassword("hunter2-master", fixedSalt);
    const b = deriveKekFromPassword("hunter2-master", fixedSalt);
    expect(a.length).toBe(KEY_BYTES);
    expect(timingSafeEqual(a, b)).toBe(true);
  });

  it("deriveKekFromPassword: different salts → different outputs", () => {
    const altSalt = new Uint8Array(fixedSalt);
    altSalt[0] = (altSalt[0] ?? 0) ^ 0xff;
    const a = deriveKekFromPassword("hunter2-master", fixedSalt);
    const b = deriveKekFromPassword("hunter2-master", altSalt);
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it("100k iteration count is enforced as the floor", () => {
    expect(() =>
      deriveKekFromPassword("any", fixedSalt, PBKDF2_MIN_ITERATIONS - 1),
    ).toThrow(/iterations must be >=/);
    // and the boundary is accepted
    const ok = deriveKekFromPassword("any", fixedSalt, PBKDF2_MIN_ITERATIONS);
    expect(ok.length).toBe(KEY_BYTES);
  });

  it("timingSafeEqual is correct and length-safe", () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  CRYPTO_VERSION,
  CryptoNotImplementedError,
  encryptAesGcm,
  decryptAesGcm,
  hmacSha256,
  timingSafeEqual,
} from "./index.js";

describe("@pharmacare/crypto stub", () => {
  it("exposes a version marker", () => {
    expect(CRYPTO_VERSION).toBe("0.1.0-stub");
  });

  it("throws CryptoNotImplementedError for each primitive", () => {
    expect(() => encryptAesGcm(new Uint8Array([1]), "k")).toThrow(CryptoNotImplementedError);
    expect(() => decryptAesGcm({ iv: "", ct: "" }, "k")).toThrow(CryptoNotImplementedError);
    expect(() => hmacSha256(new Uint8Array([1]), "k")).toThrow(CryptoNotImplementedError);
  });

  it("timingSafeEqual is correct and length-safe", () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

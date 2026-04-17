import { describe, it, expect } from "vitest";
import { validate } from "./validate.js";
import { sniffMime } from "./mime.js";
import { hashImage } from "./hash.js";
import { ALLOWED_MIME, MAX_IMAGE_BYTES } from "./types.js";

// Minimal magic-byte fixtures (not full images — sniffer only reads the header).
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(32).fill(0)]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(32).fill(0)]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, ...new Array(20).fill(0)]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...new Array(32).fill(0)]);

describe("sniffMime", () => {
  it("recognises PNG", () => expect(sniffMime(PNG)).toBe("image/png"));
  it("recognises JPEG", () => expect(sniffMime(JPEG)).toBe("image/jpeg"));
  it("recognises WebP", () => expect(sniffMime(WEBP)).toBe("image/webp"));
  it("rejects GIF", () => expect(sniffMime(GIF)).toBeNull());
  it("rejects empty", () => expect(sniffMime(new Uint8Array(0))).toBeNull());
  it("rejects short", () => expect(sniffMime(new Uint8Array([0x89, 0x50]))).toBeNull());
});

describe("hashImage", () => {
  it("sha256 of empty == known hex", async () => {
    const h = await hashImage(new Uint8Array(0));
    expect(h).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  it("sha256 of 'abc' == known hex", async () => {
    const h = await hashImage(new TextEncoder().encode("abc"));
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("is deterministic across calls", async () => {
    const a = await hashImage(PNG);
    const b = await hashImage(PNG);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
});

describe("validate", () => {
  it("accepts PNG", async () => {
    const r = await validate({ bytes: PNG });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.metadata.mime).toBe("image/png");
      expect(r.metadata.sizeBytes).toBe(PNG.length);
      expect(r.metadata.sha256).toHaveLength(64);
    }
  });

  it("accepts JPEG", async () => {
    const r = await validate({ bytes: JPEG });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.metadata.mime).toBe("image/jpeg");
  });

  it("accepts WebP", async () => {
    const r = await validate({ bytes: WEBP });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.metadata.mime).toBe("image/webp");
  });

  it("rejects empty", async () => {
    const r = await validate({ bytes: new Uint8Array(0) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe("EMPTY");
  });

  it("rejects 2MiB+1", async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big[0] = 0x89; big[1] = 0x50; big[2] = 0x4e; big[3] = 0x47;
    big[4] = 0x0d; big[5] = 0x0a; big[6] = 0x1a; big[7] = 0x0a;
    const r = await validate({ bytes: big });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe("TOO_LARGE");
  });

  it("rejects GIF", async () => {
    const r = await validate({ bytes: GIF });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe("MAGIC_UNRECOGNISED");
  });

  it("MIME whitelist length == 3", () => {
    expect(ALLOWED_MIME).toHaveLength(3);
  });
});

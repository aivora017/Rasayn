import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./cli.js";

const VALID_GSTIN = "27ABCDE1234F1Z5";
const VALID_FP = "a".repeat(64);
const VALID_HMAC = "test-secret-do-not-use-in-prod";

function buildArgv(overrides: Record<string, string> = {}, out = "-"): string[] {
  const base: Record<string, string> = {
    "--gstin": VALID_GSTIN,
    "--retail-license": "RL-12345",
    "--shop-name": "Vaidyanath Pharmacy",
    "--valid-days": "365",
    "--edition": "standard",
    "--fingerprint": VALID_FP,
    "--out": out,
    ...overrides,
  };
  return Object.entries(base).flatMap(([k, v]) => [k, v]);
}

describe("pharmacare-license-mint CLI", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrChunks: string[];
  let stdoutChunks: string[];

  beforeEach(() => {
    stderrChunks = []; stdoutChunks = [];
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`__EXIT__:${code ?? 0}`);
    });
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as never);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as never);
  });
  afterEach(() => { exitSpy.mockRestore(); stderrSpy.mockRestore(); stdoutSpy.mockRestore(); });

  it("rejects bad GSTIN with exit 1 and stderr containing 'GSTIN'", () => {
    const argv = buildArgv({ "--gstin": "27ABCDE1234F1Z" }); // 14 chars
    expect(() => runCli(argv, { PHARMACARE_LICENSE_HMAC_SECRET: VALID_HMAC })).toThrow(/__EXIT__:1/);
    expect(stderrChunks.join("")).toMatch(/GSTIN/);
  });

  it("exits 2 when PHARMACARE_LICENSE_HMAC_SECRET is missing", () => {
    expect(() => runCli(buildArgv(), {})).toThrow(/__EXIT__:2/);
    expect(stderrChunks.join("")).toMatch(/PHARMACARE_LICENSE_HMAC_SECRET/);
  });

  it("happy path: writes JSON file matching expected schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "lic-mint-"));
    const out = join(dir, "license.json");
    try {
      runCli(buildArgv({}, out), { PHARMACARE_LICENSE_HMAC_SECRET: VALID_HMAC });
      const rec = JSON.parse(readFileSync(out, "utf8"));
      expect(rec.gstin).toBe(VALID_GSTIN);
      expect(rec.shopName).toBe("Vaidyanath Pharmacy");
      expect(rec.licenseKey).toMatch(/^PCPR-\d{4}-/);
      expect(rec.fingerprint).toBe(VALID_FP);
      expect(rec.fingerprintShort).toBe("aaaaaa");
      expect(rec.edition).toBe("standard");
      expect(rec.validDays).toBe(365);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("--out - writes JSON to stdout", () => {
    runCli(buildArgv({}, "-"), { PHARMACARE_LICENSE_HMAC_SECRET: VALID_HMAC });
    const out = stdoutChunks.join("");
    const rec = JSON.parse(out);
    expect(rec.licenseKey).toMatch(/^PCPR-/);
    expect(rec.gstin).toBe(VALID_GSTIN);
  });
});

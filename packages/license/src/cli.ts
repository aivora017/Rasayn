#!/usr/bin/env node
// pharmacare-license-mint — founder-side CLI for issuing pilot licenses.
// Wraps issueLicense() from ./index.js. Node 22 stdlib only.
//
// Usage:
//   pharmacare-license-mint --gstin 27ABCDE1234F1Z5 --retail-license RL-12345 \
//     --shop-name "Vaidyanath Pharmacy" --valid-days 365 --edition standard \
//     --fingerprint <64-hex> --out license.json
//
// Edition map: trial→free, standard→starter, pro→pro (issueLicense presets).
// Exit codes: 0 ok, 1 validation, 2 missing env, 3 file-write error.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { issueLicense, PRESET_BUNDLES } from "./index.js";

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/;
const HEX64_RE = /^[0-9a-fA-F]{64}$/;

const EDITION_MAP: Record<string, keyof typeof PRESET_BUNDLES> = {
  trial: "free", standard: "starter", pro: "pro",
};

interface MintArgs {
  gstin: string; retailLicense: string; shopName: string; validDays: number;
  edition: string; fingerprint: string; out: string;
}

function fail(code: number, msg: string): never {
  process.stderr.write(`pharmacare-license-mint: ${msg}\n`);
  process.exit(code);
}

function parseAndValidate(argv: string[]): MintArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        gstin: { type: "string" },
        "retail-license": { type: "string" },
        "shop-name": { type: "string" },
        "valid-days": { type: "string" },
        edition: { type: "string" },
        fingerprint: { type: "string" },
        out: { type: "string" },
      },
      strict: true,
    });
  } catch (e) {
    return fail(1, `arg parse error: ${(e as Error).message}`);
  }
  const v = parsed.values;
  const gstin = v.gstin ?? "";
  if (!GSTIN_RE.test(gstin)) {
    return fail(1, `GSTIN invalid (need 15-char format, got ${gstin.length} chars)`);
  }
  const retailLicense = (v["retail-license"] ?? "").trim();
  if (!retailLicense) return fail(1, "retail-license must be non-empty");
  const shopName = (v["shop-name"] ?? "").trim();
  if (!shopName) return fail(1, "shop-name must be non-empty");
  const validDaysStr = v["valid-days"] ?? "";
  const validDays = Number.parseInt(validDaysStr, 10);
  if (!Number.isFinite(validDays) || validDays <= 0 || String(validDays) !== validDaysStr) {
    return fail(1, `valid-days must be positive integer (got ${validDaysStr})`);
  }
  const edition = v.edition ?? "";
  if (!(edition in EDITION_MAP)) {
    return fail(1, `edition must be one of trial|standard|pro (got ${edition})`);
  }
  const fingerprint = v.fingerprint ?? "";
  if (!HEX64_RE.test(fingerprint)) {
    return fail(1, `fingerprint must be 64-hex-char SHA-256 (got ${fingerprint.length} chars)`);
  }
  const out = v.out ?? "";
  if (!out) return fail(1, "out path required (use - for stdout)");
  return { gstin, retailLicense, shopName, validDays, edition, fingerprint, out };
}

export function runCli(argv: string[], env: NodeJS.ProcessEnv): void {
  const args = parseAndValidate(argv);
  if (!env.PHARMACARE_LICENSE_HMAC_SECRET) {
    return fail(2, "missing env PHARMACARE_LICENSE_HMAC_SECRET");
  }
  const preset = EDITION_MAP[args.edition]!;
  const issued = issueLicense({
    preset,
    shopFingerprintShort: args.fingerprint.slice(0, 6).toLowerCase(),
    validForDays: args.validDays,
  });
  const licenseId = `${args.gstin}-${issued.parts.expiryDate}`;
  const record = {
    licenseId,
    licenseKey: issued.raw,
    shopName: args.shopName,
    gstin: args.gstin,
    retailLicense: args.retailLicense,
    edition: args.edition,
    fingerprint: args.fingerprint,
    fingerprintShort: issued.parts.shopFingerprintShort,
    validDays: args.validDays,
    issuedAt: new Date().toISOString(),
    expiryDate: issued.parts.expiryDate,
    editionFlags: issued.parts.editionFlags,
  };
  const json = JSON.stringify(record, null, 2) + "\n";
  if (args.out === "-") {
    process.stdout.write(json);
  } else {
    try {
      writeFileSync(resolve(args.out), json, { encoding: "utf8" });
    } catch (e) {
      return fail(3, `file write failed: ${(e as Error).message}`);
    }
  }
  process.stderr.write(
    `minted license: ${licenseId} for ${args.shopName} (${args.gstin}) valid until ${issued.parts.expiryDate}\n`,
  );
}

const isMain = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("cli.js") || process.argv[1]?.endsWith("cli.ts");
if (isMain) runCli(process.argv.slice(2), process.env);

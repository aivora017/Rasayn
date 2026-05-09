// @pharmacare/migration-import — Marg-export hardening layer.
//
// The base adapters in `index.ts` work on clean exports. Real Marg/Tally CSVs
// from working pharmacies are messier:
//   - UTF-8 BOM at file start
//   - CRLF line endings (handled by parseCsv already)
//   - Mixed date formats: DD/MM/YYYY, DD-Mon-YYYY, DD/MM/YY, DD.MM.YYYY
//   - ₹ / Rs. / INR currency prefix on rates
//   - HSN with stray whitespace, sometimes empty
//   - Manufacturer typos / case variations (Cipla / CIPLA / Cipla Ltd)
//   - Devanagari mixed with English in ItemName
//   - Same ItemCode appearing N times for N batches (must NOT dedupe to one)
//   - Expired batches still in the export — must import + flag, not drop
//
// This module provides the hardened pieces while leaving `adaptMargItemMasterCsv`
// and the rest of the v0 surface untouched.

import { parseCsv } from "./index.js";
import type { ImportRow, ImportSource } from "./index.js";

// ─────────────────────────── HSN ───────────────────────────────────────

/** Trim whitespace; pad to 8 digits if all-numeric and 4-7 digits long.
 *  Returns "" for empty or non-numeric input — caller flags as invalid. */
export function normalizeHsn(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (!/^\d+$/.test(t)) return "";
  if (t.length === 8) return t;
  if (t.length >= 4 && t.length <= 7) return t.padEnd(8, "0");
  return "";
}

/** GST-coherence — 3003 (formulations) vs 3004 (patent meds). */
export function hsnGstCoherent(hsn: string, gst: number): boolean {
  if (!hsn) return true;
  if (hsn.startsWith("3003") || hsn.startsWith("3004")) {
    return gst === 5 || gst === 12 || gst === 18;
  }
  return true;
}

// ─────────────────────────── Schedule class ────────────────────────────

export type ScheduleClass = "OTC" | "H" | "H1" | "X";

/** Normalize ScheduleClass cell. Empty = OTC. Throws on unknown so the caller
 *  can record a per-row error. */
export function normalizeScheduleClass(raw: string): ScheduleClass {
  const u = raw.trim().toUpperCase();
  if (u === "" || u === "OTC" || u === "GENERAL") return "OTC";
  if (u === "H" || u === "SCHEDULE H") return "H";
  if (u === "H1" || u === "SCHEDULE H1") return "H1";
  if (u === "X" || u === "SCHEDULE X") return "X";
  throw new Error(`unknown ScheduleClass "${raw}"`);
}

// ─────────────────────────── Date parsing ──────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Accept DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD/MM/YY (2-digit year → 20YY
 *  if YY<70 else 19YY), DD-Mon-YYYY (case-insensitive). Returns ISO YYYY-MM-DD
 *  or throws Error with the input echoed. */
export function parseMargDate(raw: string): string {
  const s = raw.trim();
  if (!s) throw new Error("empty date");
  let m = /^(\d{1,2})[-\/.](\w{3,9})[-\/.](\d{2,4})$/.exec(s);
  if (m) {
    const day = parseInt(m[1]!, 10);
    const monKey = m[2]!.toLowerCase().slice(0, 3);
    const mon = MONTHS[monKey];
    if (mon !== undefined) {
      const year = expandYear(m[3]!);
      return iso(year, mon, day, raw);
    }
  }
  m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/.exec(s);
  if (m) {
    const day = parseInt(m[1]!, 10);
    const mon = parseInt(m[2]!, 10);
    const year = expandYear(m[3]!);
    return iso(year, mon, day, raw);
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return iso(parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10), raw);
  throw new Error(`unrecognized date format "${raw}"`);
}

function expandYear(yy: string): number {
  if (yy.length === 4) return parseInt(yy, 10);
  const n = parseInt(yy, 10);
  return n < 70 ? 2000 + n : 1900 + n;
}

function iso(y: number, mo: number, d: number, raw: string): string {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) {
    throw new Error(`out-of-range date "${raw}"`);
  }
  return `${y.toString().padStart(4, "0")}-${mo.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
}

/** True if iso is strictly before today (UTC). */
export function isExpired(iso: string, today = new Date()): boolean {
  const t = new Date(today.toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  const d = new Date(iso + "T00:00:00Z").getTime();
  return Number.isFinite(d) && d < t;
}

// ─────────────────────────── Manufacturer canonicalization ────────────

/** Lowercase, trim, drop dots/apostrophes, repeatedly drop trailing
 *  business-suffix words. So "Dr. Reddy's Labs" === "Dr Reddys" === "dr reddys". */
export function canonicalManufacturer(raw: string): string {
  let s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  s = s.replace(/['’]/g, "").replace(/\./g, "");
  for (let i = 0; i < 4; i++) {
    s = s.replace(
      /\s+(?:ltd|limited|pvt|private|pharma|pharmaceutical|pharmaceuticals|india|co|company|corp|corporation|drug|drugs|labs|laboratories)$/g,
      "",
    );
  }
  return s.trim();
}

/** Group input names by canonical key. Keys with >1 distinct raw spelling
 *  are returned as warnings (suggested merges). */
export function detectMfrDuplicates(names: readonly string[]): readonly string[] {
  const groups = new Map<string, Set<string>>();
  for (const n of names) {
    const k = canonicalManufacturer(n);
    if (!k) continue;
    let g = groups.get(k);
    if (!g) { g = new Set(); groups.set(k, g); }
    g.add(n.trim());
  }
  const out: string[] = [];
  for (const [k, set] of groups) {
    if (set.size > 1) {
      out.push(`mfr near-duplicate "${k}": ${Array.from(set).map((s) => `"${s}"`).join(", ")}`);
    }
  }
  return out;
}

// ─────────────────────────── Synthetic-shape Marg adapter ─────────────

export interface HardenedImportResult {
  readonly source: ImportSource;
  readonly errors: readonly { row: number; msg: string }[];
  readonly mfrDupeWarnings: readonly string[];
}

/** Hardened adapter for the SrNo/ItemCode/ItemName/Pack/Manufacturer/HSN/GST%/
 *  MRP/PurchaseRate/SellingRate/ScheduleClass/BatchNo/ExpDate/Qty/Loc/Notes
 *  shape used by the real Marg item-master export wizard.
 *
 *  Multi-batch: each ItemCode emits ONE product row, plus one batch row per
 *  (ItemCode, BatchNo). Duplicate (ItemCode, BatchNo) is warned + skipped.
 *  Expired batches are emitted with `is_expired: 1` so FEFO rejects at sale. */
export function adaptMargItemMasterCsvHardened(
  csv: string,
  today: Date = new Date(),
): HardenedImportResult {
  const rows = parseCsv(csv);
  if (rows.length === 0) {
    return { source: { vendor: "marg", rows: [], warnings: ["empty CSV"] }, errors: [], mfrDupeWarnings: [] };
  }
  const header = rows[0]!.map((h) => h.toLowerCase().trim());
  const ix = (name: string): number => header.indexOf(name.toLowerCase());
  const cols = {
    code: ix("ItemCode"),
    name: ix("ItemName"),
    pack: ix("Pack"),
    mfr: ix("Manufacturer"),
    hsn: ix("HSN"),
    gst: ix("GST%"),
    mrp: ix("MRP"),
    pur: ix("PurchaseRate"),
    sel: ix("SellingRate"),
    sch: ix("ScheduleClass"),
    batch: ix("BatchNo"),
    exp: ix("ExpDate"),
    qty: ix("Qty"),
  };
  const required: (keyof typeof cols)[] = ["code", "name", "mrp", "exp", "batch"];
  const warnings: string[] = [];
  const missing = required.filter((k) => cols[k] < 0);
  if (missing.length) warnings.push(`missing columns: ${missing.join(", ")}`);

  const out: ImportRow[] = [];
  const errors: { row: number; msg: string }[] = [];
  const seenBatches = new Set<string>();
  const seenProducts = new Set<string>();
  const mfrNames: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const code = (r[cols.code] ?? "").trim();
    const name = (r[cols.name] ?? "").trim();
    if (!code || !name) {
      errors.push({ row: i + 1, msg: "missing ItemCode or ItemName" });
      continue;
    }
    let sched: ScheduleClass;
    try { sched = normalizeScheduleClass(r[cols.sch] ?? ""); }
    catch (e) { errors.push({ row: i + 1, msg: (e as Error).message }); continue; }

    const hsn = normalizeHsn(r[cols.hsn] ?? "");
    const gst = parseInt((r[cols.gst] ?? "0").trim(), 10) || 0;
    if (hsn && !hsnGstCoherent(hsn, gst)) {
      warnings.push(`row ${i + 1}: HSN ${hsn} vs GST ${gst}% — non-standard`);
    }
    const mrpP = parseRupee(r[cols.mrp] ?? "");
    const purP = parseRupee(r[cols.pur] ?? "");
    const selP = parseRupee(r[cols.sel] ?? "");

    let expIso: string;
    try { expIso = parseMargDate(r[cols.exp] ?? ""); }
    catch (e) { errors.push({ row: i + 1, msg: (e as Error).message }); continue; }

    const mfrRaw = (r[cols.mfr] ?? "").trim();
    if (mfrRaw) mfrNames.push(mfrRaw);

    if (!seenProducts.has(code)) {
      seenProducts.add(code);
      out.push({
        kind: "product",
        externalId: code,
        fields: {
          name,
          manufacturer: mfrRaw,
          manufacturerCanonical: canonicalManufacturer(mfrRaw),
          hsn: hsn || null,
          gstRate: gst,
          schedule: sched,
          mrpPaise: mrpP,
          purchasePricePaise: purP,
          sellingPricePaise: selP,
          pack: (r[cols.pack] ?? "").trim(),
        },
        sourceLine: i + 1,
      });
    }

    const batchNo = (r[cols.batch] ?? "").trim();
    const batchKey = `${code}|${batchNo}`;
    if (seenBatches.has(batchKey)) {
      warnings.push(`row ${i + 1}: duplicate batch (${code},${batchNo}) — skipped`);
      continue;
    }
    seenBatches.add(batchKey);

    const expired = isExpired(expIso, today);
    out.push({
      kind: "batch",
      externalId: `${code}-${batchNo}`,
      fields: {
        productExternalId: code,
        batchNo,
        expiryIso: expIso,
        qty: parseInt((r[cols.qty] ?? "0").trim(), 10) || 0,
        purchasePricePaise: purP,
        mrpPaise: mrpP,
        is_expired: expired ? 1 : 0,
      },
      sourceLine: i + 1,
    });
  }

  const mfrDupeWarnings = detectMfrDuplicates(mfrNames);
  return {
    source: { vendor: "marg", rows: out, warnings: [...warnings, ...mfrDupeWarnings] },
    errors,
    mfrDupeWarnings,
  };
}

/** Local helper — same currency-prefix tolerance as index.ts. */
function parseRupee(s: string): number {
  if (!s) return 0;
  const cleaned = s
    .replace(/^\s*(?:Rs\.?|INR)\s*/i, "")
    .replace(/[₹,\s]/g, "");
  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

/** Render per-row errors as a CSV blob ready for `import_errors.csv`. */
export function renderErrorReport(errors: readonly { row: number; msg: string }[]): string {
  const lines = ["row,error"];
  for (const e of errors) {
    const msg = /[",\n]/.test(e.msg) ? `"${e.msg.replace(/"/g, '""')}"` : e.msg;
    lines.push(`${e.row},${msg}`);
  }
  return lines.join("\n") + "\n";
}

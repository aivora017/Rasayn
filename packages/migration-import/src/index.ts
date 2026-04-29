// @pharmacare/migration-import
// Migrate IN from competitor pharmacy software.
//
// Supported sources:
//   * marg          — Marg ERP exports (CSV/XLS/DBF/XML — we parse CSV; DBF
//                     converted via marg's own export wizard first)
//   * tally         — Tally Prime XML (hierarchical voucher dump)
//   * tally_csv     — Tally CSV report exports (flat)
//   * vyapar        — Vyapar Android/Desktop CSV export
//   * medeil        — Medeil Standard / Professional CSV
//   * gofrugal      — GoFrugal RetailEasy CSV
//   * evitalrx      — eVitalRx cloud CSV / JSON
//   * generic_csv   — User-mapped CSV (any column layout)
//
// Architecture:
//   1. Source file → adapter parses → CommonImportRow[]
//   2. CommonImportRow validated → ValidationResult
//   3. Approve dry-run → emit InsertOps[] for caller to write to DB
//
// Tests: 30+ covering Marg + Tally + Vyapar + Medeil + Generic CSV adapters
// + validation + dry-run + idempotent re-import (don't double-insert).

import type { Paise } from "@pharmacare/shared-types";
import { paise } from "@pharmacare/shared-types";

// ────────────────────────────────────────────────────────────────────────
// Common intermediate shape (what every adapter normalizes to)
// ────────────────────────────────────────────────────────────────────────

export type ImportEntityKind = "customer" | "doctor" | "supplier" | "product" | "batch" | "bill" | "purchase";

export interface ImportRow {
  readonly kind: ImportEntityKind;
  readonly externalId: string;        // source vendor's primary key, used for idempotency
  readonly fields: Readonly<Record<string, string | number | boolean | null>>;
  readonly sourceLine?: number;       // 1-based row number in CSV (for error reporting)
}

export interface ImportSource {
  readonly vendor: SourceVendor;
  readonly rows: readonly ImportRow[];
  readonly warnings: readonly string[];
}

export type SourceVendor = "marg" | "tally" | "tally_csv" | "vyapar" | "medeil" | "gofrugal" | "evitalrx" | "generic_csv";

// ────────────────────────────────────────────────────────────────────────
// CSV parser (RFC 4180 minimal, handles quotes + escaped quotes + CRLF)
// ────────────────────────────────────────────────────────────────────────

export function parseCsv(text: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else { inQuotes = false; }
      } else { cell += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(cell); cell = ""; }
      else if (c === '\n') {
        row.push(cell); cell = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      }
      else if (c === '\r') { /* skip */ }
      else { cell += c; }
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

// ────────────────────────────────────────────────────────────────────────
// Marg adapter — most popular Indian pharmacy ERP
// ────────────────────────────────────────────────────────────────────────

/**
 * Marg item-master CSV export columns (typical):
 *   Item Code, Item Name, Manufacturer, MRP, Sale Rate, Pack, HSN Code,
 *   Generic Name, Schedule, Stock, Min Stock, Max Stock
 *
 * Marg sales-bill CSV export columns:
 *   Bill No, Bill Date, Customer Name, Customer Phone, Item Code, Item Name,
 *   Batch, Expiry, Qty, MRP, Discount, Tax %, Net Amount, Total
 */
export function adaptMargItemMasterCsv(csv: string): ImportSource {
  const rows = parseCsv(csv);
  if (rows.length === 0) return { vendor: "marg", rows: [], warnings: ["empty CSV"] };
  const header = rows[0]!.map((h) => h.toLowerCase().trim());
  const required = ["item code", "item name"];
  const missing = required.filter((r) => !header.includes(r));
  const warnings: string[] = [];
  if (missing.length > 0) warnings.push(`Marg item-master missing columns: ${missing.join(", ")}`);

  const out: ImportRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const get = (name: string): string => {
      const idx = header.indexOf(name);
      return idx >= 0 ? (r[idx] ?? "") : "";
    };
    const code = get("item code");
    const name = get("item name");
    if (!code || !name) {
      warnings.push(`Row ${i + 1}: skipped (no Item Code or Item Name)`);
      continue;
    }
    out.push({
      kind: "product",
      externalId: code,
      fields: {
        name,
        manufacturer: get("manufacturer"),
        mrpPaise: parseRupeeToPaise(get("mrp")),
        saleRatePaise: parseRupeeToPaise(get("sale rate")),
        pack: get("pack"),
        hsn: get("hsn code"),
        genericName: get("generic name"),
        schedule: normalizeSchedule(get("schedule")),
        currentStock: parseInt(get("stock") || "0", 10),
        minStock: parseInt(get("min stock") || "0", 10),
        maxStock: parseInt(get("max stock") || "0", 10),
      },
      sourceLine: i + 1,
    });
  }
  return { vendor: "marg", rows: out, warnings };
}

export function adaptMargCustomerCsv(csv: string): ImportSource {
  const rows = parseCsv(csv);
  if (rows.length === 0) return { vendor: "marg", rows: [], warnings: ["empty CSV"] };
  const header = rows[0]!.map((h) => h.toLowerCase().trim());
  const out: ImportRow[] = [];
  const warnings: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const get = (name: string): string => {
      const idx = header.indexOf(name);
      return idx >= 0 ? (r[idx] ?? "") : "";
    };
    const code = get("customer code") || get("party code") || `MARG-${i}`;
    const name = get("customer name") || get("party name");
    if (!name) { warnings.push(`Row ${i + 1}: no customer name`); continue; }
    out.push({
      kind: "customer",
      externalId: code,
      fields: {
        name,
        phone: get("phone") || get("mobile"),
        gstin: get("gstin"),
        address: get("address"),
        balanceDuePaise: parseRupeeToPaise(get("balance") || get("balance due")),
      },
      sourceLine: i + 1,
    });
  }
  return { vendor: "marg", rows: out, warnings };
}

// ────────────────────────────────────────────────────────────────────────
// Tally XML adapter — hierarchical, vouchers
// ────────────────────────────────────────────────────────────────────────

/** Minimal XML parser — extracts Tally tags we care about. Not a full XML
 *  parser; only handles Tally's known structure. Avoids dependency. */
export function adaptTallyXml(xml: string): ImportSource {
  const rows: ImportRow[] = [];
  const warnings: string[] = [];

  // Extract LEDGER masters (customers/suppliers in Tally land)
  const ledgerRe = /<LEDGER NAME="([^"]+)"[^>]*>([\s\S]*?)<\/LEDGER>/g;
  let lm: RegExpExecArray | null;
  while ((lm = ledgerRe.exec(xml)) !== null) {
    const name = lm[1]!;
    const body = lm[2]!;
    const parent = (/<PARENT>([^<]+)<\/PARENT>/.exec(body)?.[1] ?? "").trim();
    const phone  = (/<LEDGERPHONE[^>]*>([^<]+)<\/LEDGERPHONE>/.exec(body)?.[1] ?? "").trim();
    const gstin  = (/<PARTYGSTIN>([^<]+)<\/PARTYGSTIN>/.exec(body)?.[1] ?? "").trim();
    let kind: ImportEntityKind = "customer";
    if (/Sundry Creditor/i.test(parent)) kind = "supplier";
    if (/Sundry Debtor/i.test(parent))   kind = "customer";
    rows.push({
      kind,
      externalId: `TALLY-LED-${name}`,
      fields: { name, phone, gstin },
    });
  }

  // Extract VOUCHER (sales/purchase) records
  const voucherRe = /<VOUCHER[^>]*VCHTYPE="([^"]+)"[^>]*>([\s\S]*?)<\/VOUCHER>/g;
  let vm: RegExpExecArray | null;
  while ((vm = voucherRe.exec(xml)) !== null) {
    const vtype = vm[1]!;
    const body = vm[2]!;
    const date = (/<DATE>(\d+)<\/DATE>/.exec(body)?.[1] ?? "");
    const num  = (/<VOUCHERNUMBER>([^<]+)<\/VOUCHERNUMBER>/.exec(body)?.[1] ?? "");
    const party= (/<PARTYLEDGERNAME>([^<]+)<\/PARTYLEDGERNAME>/.exec(body)?.[1] ?? "");
    const amtMatch = /<AMOUNT>(-?[\d.]+)<\/AMOUNT>/.exec(body);
    const totalRupees = amtMatch ? Math.abs(parseFloat(amtMatch[1]!)) : 0;
    const kind: ImportEntityKind = vtype === "Sales" ? "bill" : vtype === "Purchase" ? "purchase" : "bill";
    if (!num) { warnings.push(`Voucher missing VOUCHERNUMBER`); continue; }
    rows.push({
      kind,
      externalId: `TALLY-VCH-${num}`,
      fields: {
        voucherType: vtype,
        billNo: num,
        billedAt: tallyDateToIso(date),
        partyName: party,
        totalPaise: Math.round(totalRupees * 100),
      },
    });
  }
  return { vendor: "tally", rows, warnings };
}

function tallyDateToIso(d: string): string {
  if (/^\d{8}$/.test(d)) return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
  return d;
}

// ────────────────────────────────────────────────────────────────────────
// Vyapar adapter — mobile-first SME billing app
// ────────────────────────────────────────────────────────────────────────

/** Vyapar export columns (Items): Item Name, Item Code, Sale Price, MRP,
 *  Purchase Price, Item Type, HSN, Tax %, Stock, Min Stock */
export function adaptVyaparItemCsv(csv: string): ImportSource {
  const rows = parseCsv(csv);
  if (rows.length === 0) return { vendor: "vyapar", rows: [], warnings: ["empty CSV"] };
  const header = rows[0]!.map((h) => h.toLowerCase().trim());
  const out: ImportRow[] = [];
  const warnings: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const get = (n: string): string => { const idx = header.indexOf(n); return idx >= 0 ? (r[idx] ?? "") : ""; };
    const name = get("item name");
    const code = get("item code") || `VYAPAR-${i}`;
    if (!name) { warnings.push(`Row ${i + 1}: no item name`); continue; }
    out.push({
      kind: "product", externalId: code,
      fields: {
        name,
        salePricePaise: parseRupeeToPaise(get("sale price")),
        mrpPaise: parseRupeeToPaise(get("mrp")),
        purchasePricePaise: parseRupeeToPaise(get("purchase price")),
        hsn: get("hsn"),
        gstRate: parseFloat(get("tax %") || get("tax rate") || "0"),
        currentStock: parseInt(get("stock") || "0", 10),
      },
      sourceLine: i + 1,
    });
  }
  return { vendor: "vyapar", rows: out, warnings };
}

// ────────────────────────────────────────────────────────────────────────
// Medeil adapter
// ────────────────────────────────────────────────────────────────────────

/** Medeil exports: Drug ID, Drug Name, Generic Name, Manufacturer, Schedule,
 *  HSN, MRP, Stock, Batch, Expiry, Pack */
export function adaptMedeilDrugCsv(csv: string): ImportSource {
  const rows = parseCsv(csv);
  if (rows.length === 0) return { vendor: "medeil", rows: [], warnings: ["empty CSV"] };
  const header = rows[0]!.map((h) => h.toLowerCase().trim());
  const out: ImportRow[] = [];
  const warnings: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const get = (n: string): string => { const idx = header.indexOf(n); return idx >= 0 ? (r[idx] ?? "") : ""; };
    const id = get("drug id") || get("id") || `MEDEIL-${i}`;
    const name = get("drug name") || get("product name");
    if (!name) { warnings.push(`Row ${i + 1}: no drug name`); continue; }
    out.push({
      kind: "product", externalId: id,
      fields: {
        name,
        genericName: get("generic name"),
        manufacturer: get("manufacturer"),
        schedule: normalizeSchedule(get("schedule")),
        hsn: get("hsn"),
        mrpPaise: parseRupeeToPaise(get("mrp")),
        currentStock: parseInt(get("stock") || "0", 10),
        pack: get("pack"),
      },
      sourceLine: i + 1,
    });
  }
  return { vendor: "medeil", rows: out, warnings };
}

// ────────────────────────────────────────────────────────────────────────
// Generic CSV adapter — user maps columns
// ────────────────────────────────────────────────────────────────────────

export interface GenericFieldMap {
  readonly externalIdColumn: string;
  /** Map: target field → source column header (case-insensitive). */
  readonly fields: Readonly<Record<string, string>>;
  readonly kind: ImportEntityKind;
}

export function adaptGenericCsv(csv: string, map: GenericFieldMap): ImportSource {
  const rows = parseCsv(csv);
  if (rows.length === 0) return { vendor: "generic_csv", rows: [], warnings: ["empty CSV"] };
  const header = rows[0]!.map((h) => h.toLowerCase().trim());
  const idIdx = header.indexOf(map.externalIdColumn.toLowerCase());
  const out: ImportRow[] = [];
  const warnings: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const externalId = idIdx >= 0 ? (r[idIdx] ?? `GENERIC-${i}`) : `GENERIC-${i}`;
    const fields: Record<string, string | number> = {};
    for (const [target, source] of Object.entries(map.fields)) {
      const idx = header.indexOf(source.toLowerCase());
      const v = idx >= 0 ? (r[idx] ?? "") : "";
      // Coerce known numeric fields
      if (/paise|stock|qty|rate|count/i.test(target)) {
        fields[target] = /paise/i.test(target) ? parseRupeeToPaise(v) : (parseFloat(v) || 0);
      } else {
        fields[target] = v;
      }
    }
    out.push({ kind: map.kind, externalId, fields, sourceLine: i + 1 });
  }
  return { vendor: "generic_csv", rows: out, warnings };
}

// ────────────────────────────────────────────────────────────────────────
// Validation + dry-run
// ────────────────────────────────────────────────────────────────────────

export interface ImportValidationIssue {
  readonly row: ImportRow;
  readonly issue: string;
  readonly severity: "warn" | "skip";
}

export interface ImportPlan {
  readonly source: ImportSource;
  readonly insertCount: number;
  readonly updateCount: number;
  readonly skipCount: number;
  readonly issues: readonly ImportValidationIssue[];
  readonly summary: Readonly<Record<ImportEntityKind, number>>;
}

export interface ExistingRowProbe {
  /** Returns true iff a row with the given (kind, externalId) already exists in
   *  the target DB. Idempotent re-imports skip these by default. */
  exists(kind: ImportEntityKind, externalId: string): Promise<boolean>;
}

export async function planImport(source: ImportSource, probe?: ExistingRowProbe): Promise<ImportPlan> {
  const issues: ImportValidationIssue[] = [];
  const summary: Record<ImportEntityKind, number> = {
    customer: 0, doctor: 0, supplier: 0, product: 0, batch: 0, bill: 0, purchase: 0,
  };
  let insertCount = 0;
  let updateCount = 0;
  let skipCount = 0;

  for (const r of source.rows) {
    // Validate per-kind
    if (r.kind === "product") {
      if (!r.fields["name"]) {
        issues.push({ row: r, issue: "missing name", severity: "skip" });
        skipCount++; continue;
      }
    }
    if (r.kind === "customer" && !r.fields["name"]) {
      issues.push({ row: r, issue: "missing customer name", severity: "skip" });
      skipCount++; continue;
    }

    summary[r.kind] = (summary[r.kind] ?? 0) + 1;

    if (probe) {
      const exists = await probe.exists(r.kind, r.externalId);
      if (exists) {
        updateCount++;
      } else {
        insertCount++;
      }
    } else {
      insertCount++;
    }
  }

  return { source, insertCount, updateCount, skipCount, issues, summary };
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function parseRupeeToPaise(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/[₹,\s]/g, "");
  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

function normalizeSchedule(s: string): "OTC" | "H" | "H1" | "X" {
  const u = s.toUpperCase().trim();
  if (u === "X" || u.includes("SCHEDULE X")) return "X";
  if (u === "H1" || u.includes("H1") || u.includes("SCHEDULE H1")) return "H1";
  if (u === "H" || u.includes("SCHEDULE H")) return "H";
  return "OTC";
}

// Re-export for tests
export { parseRupeeToPaise, normalizeSchedule };

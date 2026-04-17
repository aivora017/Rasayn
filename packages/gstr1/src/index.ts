/**
 * @pharmacare/gstr1 — Public API
 *
 * Given a period (MMYYYY), a shop, and its bills for that period, produce:
 *   - a GSTR-1 JSON payload (GSTN offline-tool v3.1.3 shape)
 *   - a 6-file CSV bundle (Tally-parity for CA hand-off)
 *   - a summary (counts, totals, invalid bills, doc-series gaps)
 *
 * Pure, deterministic, zero runtime deps.
 */

import type {
  GenerateGstr1Input,
  Gstr1Payload,
  Gstr1CsvBundle,
  Gstr1Result,
  Gstr1Summary,
} from "./types.js";
import { GSTR1_SCHEMA_VERSION } from "./types.js";
import { buildPeriod, fiscalYearFromPeriod, isoInPeriod } from "./format.js";
import {
  classifyBills,
  buildB2BBlocks,
  buildB2CLBlocks,
  buildB2CSRows,
  buildHsnBlocks,
  buildExempRows,
  buildDocBlock,
} from "./aggregate.js";
import { csvB2B, csvB2CL, csvB2CS, csvHsn, csvExemp, csvDoc } from "./csv.js";

export function generateGstr1(input: GenerateGstr1Input): Gstr1Result {
  const period = buildPeriod(input.period.mm, input.period.yyyy);
  const shopState = input.shop.stateCode;

  // 1. Period filter — only bills whose billed_at falls inside the period (IST).
  const inPeriod = input.bills.filter(
    (b) => isoInPeriod(b.billedAt, input.period.mm, input.period.yyyy),
  );

  // 2. Classify valid bills into sections
  const c = classifyBills(inPeriod, shopState);

  // 3. Build JSON blocks
  const b2b = buildB2BBlocks(c.b2b);
  const b2cl = buildB2CLBlocks(c.b2cl, shopState);
  const b2cs = buildB2CSRows(c.b2cs, shopState);
  const hsn = buildHsnBlocks(c.b2b, [...c.b2cl, ...c.b2cs]);
  const exemp = buildExempRows(c.exempt, shopState);
  // Doc section: pass ALL in-period bills (including voided) so cancelled count works.
  const doc = buildDocBlock(inPeriod);

  // Suppress unused fp local lint; schema does use fp at top of JSON
  const fy = fiscalYearFromPeriod(period);
  void fy;

  // 4. Assemble JSON payload
  const json: Gstr1Payload = {
    gstin: input.shop.gstin,
    fp: period,
    version: GSTR1_SCHEMA_VERSION,
    hash: "hash",               // GSTN placeholder; real hash written by Rust persist layer
    b2b,
    b2cl,
    b2cs,
    hsn,
    nil: { inv: exemp },
    doc_issue: { doc_det: [doc.block] },
    cdnr: [],
    cdnur: [],
    b2ba: [],
    b2cla: [],
    b2csa: [],
    cdnra: [],
    cdnura: [],
    exp: [],
  };

  // 5. Build CSV bundle
  const csv: Gstr1CsvBundle = {
    b2b: csvB2B(b2b),
    b2cl: csvB2CL(b2cl),
    b2cs: csvB2CS(b2cs),
    hsn: csvHsn([...hsn.hsn_b2b.data, ...hsn.hsn_b2c.data]),
    exemp: csvExemp(exemp),
    doc: csvDoc(doc.block),
  };

  // 6. Summary
  const grandTotalPaise = c.valid.reduce((s, b) => s + b.grandTotalPaise, 0);
  const summary: Gstr1Summary = {
    billCount: c.valid.length,
    b2bCount: c.b2b.length,
    b2clCount: c.b2cl.length,
    b2csRowCount: b2cs.length,
    hsnB2bRowCount: hsn.hsn_b2b.data.length,
    hsnB2cRowCount: hsn.hsn_b2c.data.length,
    exempRowCount: exemp.length,
    docRowCount: doc.block.docs.length,
    grandTotalPaise,
    gaps: doc.gaps,
    invalid: c.invalid,
  };

  return { json, csv, summary };
}

/** Deterministic JSON serialiser (sorted keys would break GSTN shape; we preserve
 * our own insertion order). Exposed for consumers wanting a canonical string. */
export function serialiseJson(payload: Gstr1Payload): string {
  return JSON.stringify(payload, null, 0);
}

/** GSTN offline-tool default filename: {MM}{YYYY}_GSTR1_{GSTIN}.json. */
export function gstr1Filename(periodMm: string, periodYyyy: string, gstin: string): string {
  return `${periodMm}${periodYyyy}_GSTR1_${gstin}.json`;
}

export * from "./types.js";
export { fiscalYearFromPeriod, parsePeriod, buildPeriod, isoInPeriod } from "./format.js";

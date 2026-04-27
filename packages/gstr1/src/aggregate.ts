import type {
  BillForGstr1,
  BillLineForGstr1,
  B2BBuyerBlock,
  B2BInvoice,
  B2BItem,
  B2CLStateBlock,
  B2CLInvoice,
  B2CSRow,
  CdnrBuyerBlock,
  CdnrItem,
  CdnrNote,
  CdnurNote,
  HsnRow,
  ExempRow,
  DocBlock,
  DocRow,
  ReturnForGstr1,
  ReturnLineForGstr1,
} from "./types.js";
import {
  DEFAULT_DOC_NATURE_CODE,
  DEFAULT_DOC_NATURE_LABEL,
  DEFAULT_UQC,
} from "./types.js";
import {
  classifyBill,
  hasExemptSurface,
  placeOfSupply,
  validateBillForGstr1,
} from "./classify.js";
import { formatDateDDMMYYYY, paiseToRupees } from "./format.js";

export interface Classified {
  readonly valid: readonly BillForGstr1[];
  readonly invalid: readonly { readonly billId: string; readonly reason: string }[];
  readonly b2b: readonly BillForGstr1[];
  readonly b2cl: readonly BillForGstr1[];
  readonly b2cs: readonly BillForGstr1[];
  readonly exempt: readonly BillForGstr1[];
}

/** Classify all bills + surface validity errors.
 * A bill may appear in one of {b2b,b2cl,b2cs} AND in `exempt` simultaneously. */
export function classifyBills(
  bills: readonly BillForGstr1[],
  shopStateCode: string,
): Classified {
  const valid: BillForGstr1[] = [];
  const invalid: { billId: string; reason: string }[] = [];
  const b2b: BillForGstr1[] = [];
  const b2cl: BillForGstr1[] = [];
  const b2cs: BillForGstr1[] = [];
  const exempt: BillForGstr1[] = [];

  for (const b of bills) {
    const reasons = validateBillForGstr1(b, shopStateCode);
    if (reasons.length > 0) {
      invalid.push({ billId: b.id, reason: reasons.join("; ") });
      continue;
    }
    valid.push(b);
    const section = classifyBill(b);
    if (section === "b2b") b2b.push(b);
    else if (section === "b2cl") b2cl.push(b);
    else b2cs.push(b);
    if (hasExemptSurface(b)) exempt.push(b);
  }

  return { valid, invalid, b2b, b2cl, b2cs, exempt };
}

// ─── B2B aggregation ────────────────────────────────────────────────────

function aggregateLinesByRate(lines: readonly BillLineForGstr1[]): B2BItem[] {
  // GSTN accepts one item per rate bucket per invoice
  const buckets = new Map<number, {
    txval: number; iamt: number; camt: number; samt: number; csamt: number;
  }>();
  for (const ln of lines) {
    const b = buckets.get(ln.gstRate) ?? { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
    b.txval += ln.taxableValuePaise;
    b.iamt += ln.igstPaise;
    b.camt += ln.cgstPaise;
    b.samt += ln.sgstPaise;
    b.csamt += ln.cessPaise;
    buckets.set(ln.gstRate, b);
  }
  // Deterministic: sort by rate ascending
  const sortedRates = Array.from(buckets.keys()).sort((a, b) => a - b);
  return sortedRates.map((rate, i) => ({
    num: i + 1,
    itm_det: {
      txval: paiseToRupees(buckets.get(rate)!.txval),
      rt: rate,
      iamt: paiseToRupees(buckets.get(rate)!.iamt),
      camt: paiseToRupees(buckets.get(rate)!.camt),
      samt: paiseToRupees(buckets.get(rate)!.samt),
      csamt: paiseToRupees(buckets.get(rate)!.csamt),
    },
  }));
}

export function buildB2BBlocks(bills: readonly BillForGstr1[]): B2BBuyerBlock[] {
  // Group by buyer GSTIN
  const byBuyer = new Map<string, BillForGstr1[]>();
  for (const b of bills) {
    const gstin = b.customer?.gstin?.trim() ?? "";
    if (gstin.length !== 15) continue; // defensive
    const arr = byBuyer.get(gstin) ?? [];
    arr.push(b);
    byBuyer.set(gstin, arr);
  }
  const buyers = Array.from(byBuyer.keys()).sort();
  return buyers.map((ctin) => {
    const invArr = (byBuyer.get(ctin) ?? [])
      .slice()
      .sort((x, y) => x.billNo.localeCompare(y.billNo));
    const inv: B2BInvoice[] = invArr.map((b) => ({
      inum: b.billNo,
      idt: formatDateDDMMYYYY(b.billedAt),
      val: paiseToRupees(b.grandTotalPaise),
      pos: b.customer?.stateCode?.trim() ?? ctin.substring(0, 2),
      rchrg: "N",
      inv_typ: "R",
      itms: aggregateLinesByRate(b.lines),
    }));
    return { ctin, inv };
  });
}

// ─── B2CL aggregation (by state, invoices listed) ───────────────────────

export function buildB2CLBlocks(
  bills: readonly BillForGstr1[],
  shopStateCode: string,
): B2CLStateBlock[] {
  const byPos = new Map<string, BillForGstr1[]>();
  for (const b of bills) {
    const pos = placeOfSupply(b, shopStateCode);
    const arr = byPos.get(pos) ?? [];
    arr.push(b);
    byPos.set(pos, arr);
  }
  const positions = Array.from(byPos.keys()).sort();
  return positions.map((pos) => {
    const sorted = (byPos.get(pos) ?? [])
      .slice()
      .sort((x, y) => x.billNo.localeCompare(y.billNo));
    const inv: B2CLInvoice[] = sorted.map((b) => ({
      inum: b.billNo,
      idt: formatDateDDMMYYYY(b.billedAt),
      val: paiseToRupees(b.grandTotalPaise),
      itms: aggregateLinesByRate(b.lines),
    }));
    return { pos, inv };
  });
}

// ─── B2CS aggregation (pos+rate, supply-type INTRA/INTER) ───────────────

export function buildB2CSRows(
  bills: readonly BillForGstr1[],
  shopStateCode: string,
): B2CSRow[] {
  // Key = `${sply_ty}|${pos}|${rate}`
  const buckets = new Map<string, {
    sply_ty: "INTRA" | "INTER"; pos: string; rt: number;
    txval: number; iamt: number; camt: number; samt: number; csamt: number;
  }>();

  for (const b of bills) {
    const sply_ty = b.gstTreatment === "inter_state" ? "INTER" : "INTRA";
    const pos = placeOfSupply(b, shopStateCode);
    for (const ln of b.lines) {
      const key = `${sply_ty}|${pos}|${ln.gstRate}`;
      const cur = buckets.get(key) ?? {
        sply_ty, pos, rt: ln.gstRate,
        txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0,
      };
      cur.txval += ln.taxableValuePaise;
      cur.iamt += ln.igstPaise;
      cur.camt += ln.cgstPaise;
      cur.samt += ln.sgstPaise;
      cur.csamt += ln.cessPaise;
      buckets.set(key, cur);
    }
  }

  const keys = Array.from(buckets.keys()).sort();
  return keys.map((k) => {
    const v = buckets.get(k)!;
    return {
      sply_ty: v.sply_ty,
      pos: v.pos,
      typ: "OE" as const,
      rt: v.rt,
      txval: paiseToRupees(v.txval),
      iamt: paiseToRupees(v.iamt),
      camt: paiseToRupees(v.camt),
      samt: paiseToRupees(v.samt),
      csamt: paiseToRupees(v.csamt),
    };
  });
}

// ─── HSN aggregation (split B2B / B2C) ──────────────────────────────────

function aggregateHsn(
  bills: readonly BillForGstr1[],
): HsnRow[] {
  // Key = hsn|rate
  const buckets = new Map<string, {
    hsn: string; rt: number; qty: number;
    txval: number; iamt: number; camt: number; samt: number; csamt: number;
  }>();
  for (const b of bills) {
    for (const ln of b.lines) {
      const key = `${ln.hsn}|${ln.gstRate}`;
      const cur = buckets.get(key) ?? {
        hsn: ln.hsn, rt: ln.gstRate, qty: 0,
        txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0,
      };
      cur.qty += ln.qty;
      cur.txval += ln.taxableValuePaise;
      cur.iamt += ln.igstPaise;
      cur.camt += ln.cgstPaise;
      cur.samt += ln.sgstPaise;
      cur.csamt += ln.cessPaise;
      buckets.set(key, cur);
    }
  }
  const keys = Array.from(buckets.keys()).sort();
  return keys.map((k, i) => {
    const v = buckets.get(k)!;
    return {
      num: i + 1,
      hsn_sc: v.hsn,
      desc: null,
      uqc: DEFAULT_UQC,
      qty: Number(v.qty.toFixed(3)), // 3dp, common UQC convention
      rt: v.rt,
      txval: paiseToRupees(v.txval),
      iamt: paiseToRupees(v.iamt),
      camt: paiseToRupees(v.camt),
      samt: paiseToRupees(v.samt),
      csamt: paiseToRupees(v.csamt),
    };
  });
}

export function buildHsnBlocks(
  b2bBills: readonly BillForGstr1[],
  b2cBills: readonly BillForGstr1[],
): { hsn_b2b: { data: HsnRow[] }; hsn_b2c: { data: HsnRow[] } } {
  return {
    hsn_b2b: { data: aggregateHsn(b2bBills) },
    hsn_b2c: { data: aggregateHsn(b2cBills) },
  };
}

// ─── EXEMP aggregation ──────────────────────────────────────────────────

export function buildExempRows(
  bills: readonly BillForGstr1[],
  shopStateCode: string,
): ExempRow[] {
  const buckets = new Map<string, {
    sply_ty: ExempRow["sply_ty"];
    nil: number; expt: number; ngsup: number;
  }>();
  for (const b of bills) {
    const isInter = b.gstTreatment === "inter_state";
    const isB2B = (b.customer?.gstin?.trim() ?? "").length === 15;
    const sply_ty: ExempRow["sply_ty"] = isInter
      ? (isB2B ? "INTRB2B" : "INTRB2C")
      : (isB2B ? "INTRAB2B" : "INTRAB2C");

    let nilAmt = 0;
    let expAmt = 0;
    let ngsAmt = 0;

    if (b.gstTreatment === "nil_rated") {
      nilAmt += b.subtotalPaise;
    } else if (b.gstTreatment === "exempt") {
      expAmt += b.subtotalPaise;
    } else {
      // Mix: per-line 0-rate contributes to exempt bucket
      for (const ln of b.lines) {
        if (ln.gstRate === 0) expAmt += ln.taxableValuePaise;
      }
    }
    if (nilAmt === 0 && expAmt === 0 && ngsAmt === 0) continue;

    const cur = buckets.get(sply_ty) ?? { sply_ty, nil: 0, expt: 0, ngsup: 0 };
    cur.nil += nilAmt;
    cur.expt += expAmt;
    cur.ngsup += ngsAmt;
    buckets.set(sply_ty, cur);
  }
  // Suppress unused-var warning on shopStateCode
  void shopStateCode;

  const order: readonly ExempRow["sply_ty"][] = ["INTRAB2B", "INTRAB2C", "INTRB2B", "INTRB2C"];
  const rows: ExempRow[] = [];
  for (const key of order) {
    const v = buckets.get(key);
    if (!v) continue;
    rows.push({
      sply_ty: key,
      nil_amt: paiseToRupees(v.nil),
      expt_amt: paiseToRupees(v.expt),
      ngsup_amt: paiseToRupees(v.ngsup),
    });
  }
  return rows;
}

// ─── DOC aggregation + gap detection ────────────────────────────────────

interface DocGapResult {
  readonly block: DocBlock;
  readonly gaps: readonly { readonly series: string; readonly gapNums: readonly string[] }[];
}

export function buildDocBlock(
  allBills: readonly BillForGstr1[], // NOTE: pass ALL bills (incl. voided) for this period
): DocGapResult {
  // Group by docSeries
  const bySeries = new Map<string, BillForGstr1[]>();
  for (const b of allBills) {
    const series = b.docSeries || "INV";
    const arr = bySeries.get(series) ?? [];
    arr.push(b);
    bySeries.set(series, arr);
  }

  const docs: DocRow[] = [];
  const gapsOut: { series: string; gapNums: string[] }[] = [];

  const seriesSorted = Array.from(bySeries.keys()).sort();
  let docIdx = 1;
  for (const series of seriesSorted) {
    const arr = bySeries.get(series)!.slice();
    arr.sort((x, y) => x.billNo.localeCompare(y.billNo));
    if (arr.length === 0) continue;
    const from = arr[0]!.billNo;
    const to = arr[arr.length - 1]!.billNo;
    const totnum = arr.length;
    const cancel = arr.filter((b) => b.isVoided === 1).length;
    const net_issue = totnum - cancel;
    docs.push({
      num: docIdx++,
      from,
      to,
      totnum,
      cancel,
      net_issue,
    });

    // Gap detection: only for numeric-tail bill numbers like 'INV-0001'
    // Extract trailing digits from each bill_no; find any missing contiguous integer in range.
    const nums: number[] = [];
    for (const b of arr) {
      const m = /(\d+)$/.exec(b.billNo);
      if (m) nums.push(parseInt(m[1]!, 10));
    }
    if (nums.length >= 2) {
      nums.sort((a, b) => a - b);
      const min = nums[0]!;
      const max = nums[nums.length - 1]!;
      const present = new Set(nums);
      const missing: string[] = [];
      for (let i = min; i <= max; i++) {
        if (!present.has(i)) missing.push(i.toString());
      }
      if (missing.length > 0) gapsOut.push({ series, gapNums: missing });
    }
  }

  return {
    block: {
      doc_num: DEFAULT_DOC_NATURE_CODE,
      doc_typ: DEFAULT_DOC_NATURE_LABEL,
      docs,
    },
    gaps: gapsOut,
  };
}


// ─── Credit-note classification + aggregation (A8 / ADR 0021 step 4) ────

export interface ClassifiedReturns {
  /** Returns to a B2B (registered) customer. CDNR. */
  readonly cdnr: readonly ReturnForGstr1[];
  /** Returns to an unregistered B2CL-eligible customer (interstate, val > 2.5L).
   *  CDNUR. */
  readonly cdnur: readonly ReturnForGstr1[];
  /** Returns netted into the period's B2CS aggregate (small B2C). */
  readonly b2csNet: readonly ReturnForGstr1[];
  /** Returns rejected with a reason (mirrors classifyBills.invalid). */
  readonly invalid: readonly { readonly returnId: string; readonly reason: string }[];
}

const B2CL_THRESHOLD_PAISE = 250_000_00; // 2.5L rupees

/** Classify a list of returns into the GSTR-1 sections. Mirrors
 * classifyBill / classifyBills for the forward path. */
export function classifyReturns(
  returns: readonly ReturnForGstr1[],
  shopStateCode: string,
): ClassifiedReturns {
  const cdnr: ReturnForGstr1[] = [];
  const cdnur: ReturnForGstr1[] = [];
  const b2csNet: ReturnForGstr1[] = [];
  const invalid: { returnId: string; reason: string }[] = [];

  for (const r of returns) {
    if (r.lines.length === 0) {
      invalid.push({ returnId: r.id, reason: "no return lines" });
      continue;
    }
    if (r.refundTotalPaise <= 0) {
      invalid.push({ returnId: r.id, reason: "non-positive refund_total_paise" });
      continue;
    }
    const cust = r.customer;
    if (cust && cust.gstin) {
      cdnr.push(r);
      continue;
    }
    const isInterstate =
      cust !== null &&
      cust.stateCode !== null &&
      cust.stateCode !== shopStateCode;
    // Original bill total approximation: refundTotalPaise drives B2CL if interstate
    // and the original supply was > 2.5L. For pharmacy POS that threshold is
    // almost never hit on a single line, so b2csNet is the dominant path.
    if (isInterstate && r.refundTotalPaise >= B2CL_THRESHOLD_PAISE) {
      cdnur.push(r);
      continue;
    }
    b2csNet.push(r);
  }

  return { cdnr, cdnur, b2csNet, invalid };
}

/** Aggregate a return's lines into per-rate CDNR items (mirrors
 * aggregateLinesByRate but for ReturnLineForGstr1). */
function aggregateReturnLinesByRate(
  lines: readonly ReturnLineForGstr1[],
): CdnrItem[] {
  const buckets = new Map<
    number,
    { txval: number; iamt: number; camt: number; samt: number; csamt: number }
  >();
  for (const ln of lines) {
    const b = buckets.get(ln.gstRate) ?? {
      txval: 0,
      iamt: 0,
      camt: 0,
      samt: 0,
      csamt: 0,
    };
    b.txval += ln.refundTaxablePaise;
    b.iamt += ln.refundIgstPaise;
    b.camt += ln.refundCgstPaise;
    b.samt += ln.refundSgstPaise;
    b.csamt += ln.refundCessPaise;
    buckets.set(ln.gstRate, b);
  }
  const sortedRates = Array.from(buckets.keys()).sort((a, b) => a - b);
  return sortedRates.map((rate, i) => {
    const b = buckets.get(rate)!;
    return {
      num: i + 1,
      itm_det: {
        txval: paiseToRupees(b.txval),
        rt: rate,
        iamt: paiseToRupees(b.iamt),
        camt: paiseToRupees(b.camt),
        samt: paiseToRupees(b.samt),
        csamt: paiseToRupees(b.csamt),
      },
    };
  });
}

/** Build the cdnr blocks (grouped by buyer GSTIN). */
export function buildCdnrBlocks(
  returns: readonly ReturnForGstr1[],
): CdnrBuyerBlock[] {
  const byBuyer = new Map<string, ReturnForGstr1[]>();
  for (const r of returns) {
    const ctin = r.customer?.gstin;
    if (!ctin) continue;
    const arr = byBuyer.get(ctin) ?? [];
    arr.push(r);
    byBuyer.set(ctin, arr);
  }
  const sortedCtin = Array.from(byBuyer.keys()).sort();
  return sortedCtin.map((ctin) => {
    const arr = byBuyer.get(ctin)!;
    arr.sort((a, b) => a.returnNo.localeCompare(b.returnNo));
    const nt: CdnrNote[] = arr.map((r) => ({
      nt_num: r.returnNo,
      nt_dt: formatDateDDMMYYYY(r.createdAt),
      val: paiseToRupees(r.refundTotalPaise),
      ntty: "C",
      inum: r.originalBillNo,
      idt: formatDateDDMMYYYY(r.originalBilledAt),
      itms: aggregateReturnLinesByRate(r.lines),
    }));
    return { ctin, nt };
  });
}

/** Build the cdnur notes (no buyer grouping — interstate B2CL credit notes). */
export function buildCdnurNotes(
  returns: readonly ReturnForGstr1[],
  shopStateCode: string,
): CdnurNote[] {
  const sorted = [...returns].sort((a, b) =>
    a.returnNo.localeCompare(b.returnNo),
  );
  return sorted.map((r) => ({
    nt_num: r.returnNo,
    nt_dt: formatDateDDMMYYYY(r.createdAt),
    val: paiseToRupees(r.refundTotalPaise),
    ntty: "C",
    typ: "B2CL",
    inum: r.originalBillNo,
    idt: formatDateDDMMYYYY(r.originalBilledAt),
    pos: r.customer?.stateCode ?? shopStateCode,
    itms: aggregateReturnLinesByRate(r.lines),
  }));
}

/** Net B2CS-small refunds back into the B2CS rows. For each (pos, rate, sply_ty)
 * bucket we subtract the refund taxable/tax. The result is clamped at 0 — a
 * period that net-refunded more than it sold in a small B2C bucket emits 0
 * (the next period's CDNR/CDNUR catches up via amendments). */
export function netB2csForReturns(
  rows: readonly B2CSRow[],
  returns: readonly ReturnForGstr1[],
  shopStateCode: string,
): B2CSRow[] {
  if (returns.length === 0) return [...rows];
  // Key by pos|sply_ty|rate
  const map = new Map<string, B2CSRow>();
  for (const r of rows) {
    const k = `${r.pos}|${r.sply_ty}|${r.rt}`;
    map.set(k, { ...r });
  }
  for (const ret of returns) {
    const cust = ret.customer;
    const pos = cust?.stateCode ?? shopStateCode;
    const sply_ty = pos === shopStateCode ? "INTRA" : "INTER";
    for (const ln of ret.lines) {
      const k = `${pos}|${sply_ty}|${ln.gstRate}`;
      const cur = map.get(k);
      if (!cur) continue; // no matching bucket — skip silently
      const txval = Math.max(
        0,
        Math.round(cur.txval * 100 - ln.refundTaxablePaise) / 100,
      );
      const iamt = Math.max(
        0,
        Math.round(cur.iamt * 100 - ln.refundIgstPaise) / 100,
      );
      const camt = Math.max(
        0,
        Math.round(cur.camt * 100 - ln.refundCgstPaise) / 100,
      );
      const samt = Math.max(
        0,
        Math.round(cur.samt * 100 - ln.refundSgstPaise) / 100,
      );
      const csamt = Math.max(
        0,
        Math.round(cur.csamt * 100 - ln.refundCessPaise) / 100,
      );
      map.set(k, { ...cur, txval, iamt, camt, samt, csamt });
    }
  }
  // Drop rows whose taxable + tax all zero out (return wiped the bucket).
  return Array.from(map.values()).filter(
    (r) => r.txval > 0 || r.iamt > 0 || r.camt > 0 || r.samt > 0 || r.csamt > 0,
  );
}

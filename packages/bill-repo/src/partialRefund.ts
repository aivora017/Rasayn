// @pharmacare/bill-repo · partial-refund pro-rata math (ADR 0021 step 2).
// -----------------------------------------------------------------------------
// Pure-TS line math for A8 partial refunds. Host-side mirror of what the Rust
// `save_partial_return` command will do inside Tauri (ADR 0021 step 3, later PR).
//
// Scope of this file:
//   * computeLineProRata     — pro-rata every tax component on qty_returned/qty.
//   * computeTenderReversal  — proportional split across original tenders,
//                              residual-to-largest to preserve sum invariance
//                              (ADR 0021 §2 rule 2).
//   * computeRoundOffPaise   — invoice-level ±50 paise rounding cap on the
//                              sum of per-line refunds vs the tender total
//                              (mirrors A8 round-off on grand_total).
//
// Non-goals:
//   * No DB access. No Tauri. No UI. Pure functions only.
//   * Does NOT emit GSTR-1 cdnr rows (ADR 0021 step 4).
//   * Does NOT talk to the IRN adapter (ADR 0021 step 6).
//
// Rounding policy matches @pharmacare/gst-engine.computeLine: integer paise
// via the shared `paise()` helper (Math.round), which for the strictly
// non-negative pro-rata refund amounts is equivalent to half-away-from-zero.
// We deliberately REUSE `paise()` rather than duplicating a separate rounding
// helper so refund math and bill math can never drift apart.
// -----------------------------------------------------------------------------

import { paise, type Paise } from "@pharmacare/shared-types";

// ---- Errors ----------------------------------------------------------------

/** Matches the Rust error code `QTY_EXCEEDS_REFUNDABLE:bill_line=...`. */
export class QtyExceedsRefundableError extends Error {
  public readonly billLineId: string | undefined;
  public readonly qtyReturned: number;
  public readonly origQty: number;
  constructor(qtyReturned: number, origQty: number, billLineId?: string) {
    super(
      `QTY_EXCEEDS_REFUNDABLE: qty_returned ${qtyReturned} > original qty ${origQty}` +
        (billLineId ? ` (bill_line=${billLineId})` : ""),
    );
    this.name = "QtyExceedsRefundableError";
    this.qtyReturned = qtyReturned;
    this.origQty = origQty;
    this.billLineId = billLineId;
  }
}

/** qty_returned must be strictly > 0. */
export class InvalidReturnQtyError extends Error {
  public readonly qtyReturned: number;
  constructor(qtyReturned: number) {
    super(`INVALID_RETURN_QTY: qty_returned ${qtyReturned} must be > 0`);
    this.name = "InvalidReturnQtyError";
    this.qtyReturned = qtyReturned;
  }
}

/** Tender reversal cannot allocate across a negative / zero / NaN total. */
export class InvalidRefundTotalError extends Error {
  public readonly refundTotalPaise: number;
  constructor(refundTotalPaise: number) {
    super(
      `INVALID_REFUND_TOTAL: refund_total_paise ${refundTotalPaise} must be > 0`,
    );
    this.name = "InvalidRefundTotalError";
    this.refundTotalPaise = refundTotalPaise;
  }
}

// ---- Types -----------------------------------------------------------------

/**
 * Input shape for pro-rata compute — mirrors the columns we read off
 * `bill_lines` at save time. All paise fields must be integers.
 */
export interface BillLineProRataInput {
  readonly billLineId?: string;
  readonly qty: number;
  readonly taxableValuePaise: Paise;
  readonly discountPaise: Paise;
  readonly cgstPaise: Paise;
  readonly sgstPaise: Paise;
  readonly igstPaise: Paise;
  readonly cessPaise: Paise;
  /** Persisted column on bill_lines. Used for the NPPA-cap cross-check. */
  readonly lineTotalPaise: Paise;
}

export interface ProRataResult {
  readonly refundTaxablePaise: Paise;
  readonly refundDiscountPaise: Paise;
  readonly refundCgstPaise: Paise;
  readonly refundSgstPaise: Paise;
  readonly refundIgstPaise: Paise;
  readonly refundCessPaise: Paise;
  /** taxable − discount + cgst + sgst + igst + cess */
  readonly refundAmountPaise: Paise;
}

/** Subset of `Tender` shape we care about for reversal math. Kept local so
 *  this module does not depend on the TenderMode union (ADR 0022 may widen
 *  it with `credit_note` and we do not want to block on that). */
export interface ReturnTender {
  readonly mode: string;
  readonly amountPaise: Paise;
  readonly refNo?: string | null;
}

// ---- Pro-rata compute ------------------------------------------------------

/**
 * Pro-rata every tax component of an original bill_line by
 * qty_returned / orig.qty, rounded via the shared paise() helper.
 *
 * Throws:
 *   - InvalidReturnQtyError   if qty_returned <= 0 or NaN.
 *   - QtyExceedsRefundableError if qty_returned > orig.qty (defence in
 *     depth; the DB trigger trg_return_lines_qty_limit will also reject
 *     based on the dynamic remaining-refundable computation).
 */
export function computeLineProRata(
  orig: BillLineProRataInput,
  qtyReturned: number,
): ProRataResult {
  if (!Number.isFinite(qtyReturned) || qtyReturned <= 0) {
    throw new InvalidReturnQtyError(qtyReturned);
  }
  if (!Number.isFinite(orig.qty) || orig.qty <= 0) {
    // Original qty CHECK (> 0) on bill_lines would prevent this, but we are
    // a pure function — no DB — so defend against garbage input.
    throw new InvalidReturnQtyError(orig.qty);
  }
  if (qtyReturned > orig.qty) {
    throw new QtyExceedsRefundableError(qtyReturned, orig.qty, orig.billLineId);
  }

  const ratio = qtyReturned / orig.qty;

  const refundTaxable = paise(orig.taxableValuePaise * ratio);
  const refundDiscount = paise(orig.discountPaise * ratio);
  const refundCgst = paise(orig.cgstPaise * ratio);
  const refundSgst = paise(orig.sgstPaise * ratio);
  const refundIgst = paise(orig.igstPaise * ratio);
  const refundCess = paise(orig.cessPaise * ratio);

  // Line total mirrors @pharmacare/gst-engine.computeLine's shape exactly:
  //   lineTotal = taxable − discount + cgst + sgst + igst + cess
  const refundAmount = paise(
    refundTaxable -
      refundDiscount +
      refundCgst +
      refundSgst +
      refundIgst +
      refundCess,
  );

  return {
    refundTaxablePaise: refundTaxable,
    refundDiscountPaise: refundDiscount,
    refundCgstPaise: refundCgst,
    refundSgstPaise: refundSgst,
    refundIgstPaise: refundIgst,
    refundCessPaise: refundCess,
    refundAmountPaise: refundAmount,
  };
}

// ---- Tender reversal -------------------------------------------------------

/**
 * Allocate `refundTotalPaise` across the original tenders proportionally to
 * their original amounts. Rounds each allocation via paise(); the residual
 * (∑allocations may differ from refundTotalPaise by a few paise due to
 * rounding) is absorbed by the largest-amount original tender so the sum is
 * exactly `refundTotalPaise`.
 *
 * Tenders with amountPaise === 0 are filtered out of the result (they cannot
 * be proportionally allocated against, and a zero-refund tender row is
 * meaningless for the credit note).
 *
 * Order of the result preserves the input order so downstream UI can render
 * reversals alongside original tender rows.
 *
 * Throws:
 *   - InvalidRefundTotalError if refundTotalPaise <= 0 or NaN.
 *   - Error('NO_TENDERS') if origTenders is empty.
 *   - Error('ZERO_TENDER_TOTAL') if every original tender has amountPaise === 0.
 */
export function computeTenderReversal(
  origTenders: readonly ReturnTender[],
  refundTotalPaise: number,
): ReturnTender[] {
  if (!Number.isFinite(refundTotalPaise) || refundTotalPaise <= 0) {
    throw new InvalidRefundTotalError(refundTotalPaise);
  }
  if (origTenders.length === 0) {
    throw new Error("NO_TENDERS: cannot allocate refund across empty tender list");
  }

  const origTotal = origTenders.reduce(
    (s, t) => s + t.amountPaise,
    0,
  );
  if (origTotal <= 0) {
    throw new Error(
      "ZERO_TENDER_TOTAL: sum of original tender amounts must be > 0",
    );
  }

  // First pass: proportional round-half-away-from-zero allocation. Track the
  // index of the largest tender so we can dump the residual there.
  let largestIdx = 0;
  let largestAmt = -1;
  const rawAllocs: number[] = new Array(origTenders.length);
  let allocSum = 0;
  for (let i = 0; i < origTenders.length; i++) {
    const t = origTenders[i]!;
    if (t.amountPaise > largestAmt) {
      largestAmt = t.amountPaise;
      largestIdx = i;
    }
    // Guard against negative tenders (shouldn't happen per A8 schema but
    // we're a pure function; treat as zero rather than throw).
    const share = t.amountPaise > 0
      ? paise((t.amountPaise * refundTotalPaise) / origTotal)
      : 0;
    rawAllocs[i] = share;
    allocSum += share;
  }

  const residual = refundTotalPaise - allocSum;
  rawAllocs[largestIdx] = paise((rawAllocs[largestIdx] ?? 0) + residual);

  const out: ReturnTender[] = [];
  for (let i = 0; i < origTenders.length; i++) {
    const amt = rawAllocs[i] ?? 0;
    if (amt <= 0) continue; // skip zero-amount reversals; see jsdoc
    const t = origTenders[i]!;
    out.push({
      mode: t.mode,
      amountPaise: amt as Paise,
      refNo: t.refNo ?? null,
    });
  }

  return out;
}

// ---- Round-off -------------------------------------------------------------

/**
 * Invoice-level round-off for the credit note. Mirrors A8 `computeInvoice`'s
 * ±50-paise rounding on grand_total. Returns a SIGNED paise delta bounded
 * ±50 that, when added to the sum of per-line refunds, produces `tenderTotal`.
 *
 * Rationale: the sum of `computeLineProRata(...).refundAmountPaise` across N
 * lines is typically a few paise off from the cashier's desired whole-rupee
 * refund total (post tender-reversal). We store this delta in
 * `return_headers.refund_round_off_paise` (CHECK between -50 and 50).
 *
 * Clamps the delta to ±50. If the mismatch is larger than 50 paise the caller
 * has a real bug (mis-computed lines or tender totals) and we throw rather
 * than silently swallow the discrepancy.
 *
 * Throws:
 *   - Error('ROUND_OFF_OUT_OF_RANGE:delta=...') if |tenderTotal − sumLines|
 *     exceeds 50 paise.
 */
export function computeRoundOffPaise(
  lines: readonly ProRataResult[],
  tenderTotal: number,
): number {
  if (!Number.isFinite(tenderTotal)) {
    throw new Error(`ROUND_OFF_OUT_OF_RANGE:tenderTotal=${tenderTotal}`);
  }
  const sum = lines.reduce((s, l) => s + l.refundAmountPaise, 0);
  const delta = tenderTotal - sum;
  if (delta < -50 || delta > 50) {
    throw new Error(`ROUND_OFF_OUT_OF_RANGE:delta=${delta}`);
  }
  return delta;
}

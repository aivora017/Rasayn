// @pharmacare/gst-engine
// India GST calc for pharma retail. All inputs/outputs in paise (integer).
//
// Rules implemented:
//  - MRP-inclusive pricing: taxable = round( (net) * 100 / (100 + gst) )
//  - Line discount applied on gross (pre-tax) — absolute takes precedence over pct.
//  - Intra-state: CGST = SGST = gst/2. Inter-state: IGST = gst. Exempt/nil: 0.
//  - Round-off on invoice grand-total to nearest rupee (±50 paise cap).
//  - Banker-safe: all money in integer paise; no floats in persisted state.
//  - A4: NPPA (DPCO 2013) ceiling check at bill time with typed reason codes.

import { paise, addP, type Paise } from "@pharmacare/shared-types";
import type { GstRate, GstTreatment } from "@pharmacare/shared-types";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface LineInput {
  readonly mrpPaise: Paise;         // per unit, GST-inclusive (batch MRP wins)
  readonly qty: number;              // units (can be decimal, e.g. 0.5 strip)
  readonly gstRate: GstRate;
  readonly discountPct?: number;     // 0..100, optional
  readonly discountPaise?: Paise;    // absolute per-line, optional (wins over pct)
}

export interface LineValidationContext {
  readonly nppaMaxMrpPaise?: Paise | null;  // from products.nppa_max_mrp_paise
  readonly productName?: string;             // for user-facing error text
  readonly batchNo?: string;                 // for audit trail
  readonly isExpired?: boolean;              // from batches (A2 v_fefo_batches)
}

export interface LineTax {
  readonly grossPaise: Paise;        // mrp * qty
  readonly discountPaise: Paise;
  readonly taxableValuePaise: Paise;  // (gross - discount) * 100 / (100 + gst)
  readonly cgstPaise: Paise;
  readonly sgstPaise: Paise;
  readonly igstPaise: Paise;
  readonly cessPaise: Paise;          // reserved (pharma ≈ always 0)
  readonly lineTotalPaise: Paise;     // taxable + all taxes
}

export interface InvoiceTotals {
  readonly subtotalPaise: Paise;       // sum of taxable values
  readonly discountPaise: Paise;
  readonly cgstPaise: Paise;
  readonly sgstPaise: Paise;
  readonly igstPaise: Paise;
  readonly cessPaise: Paise;
  readonly preRoundPaise: Paise;       // subtotal + taxes
  readonly roundOffPaise: Paise;       // signed, ±50 paise
  readonly grandTotalPaise: Paise;     // nearest rupee
}

/** Reason codes surfaced to UI + audit log for blocked bill lines. */
export type BillLineReasonCode =
  | "NPPA_CAP_EXCEEDED"
  | "NEGATIVE_QTY"
  | "DISCOUNT_EXCEEDS_GROSS"
  | "DISCOUNT_PCT_OUT_OF_RANGE"
  | "GST_RATE_INVALID"
  | "EXPIRED_BATCH"
  | "MRP_NON_POSITIVE";

export interface LineValidationOk { readonly ok: true; }
export interface LineValidationFail {
  readonly ok: false;
  readonly reasonCode: BillLineReasonCode;
  readonly message: string;
  readonly detail: Readonly<Record<string, unknown>> | undefined;
}
export type LineValidationResult = LineValidationOk | LineValidationFail;

export class BillValidationError extends Error {
  readonly reasonCode: BillLineReasonCode;
  readonly detail: Readonly<Record<string, unknown>> | undefined;
  constructor(fail: LineValidationFail) {
    super(fail.message);
    this.name = "BillValidationError";
    this.reasonCode = fail.reasonCode;
    this.detail = fail.detail;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────────────────────────────────

const VALID_GST_RATES: ReadonlySet<number> = new Set([0, 5, 12, 18, 28]);

/**
 * Pure validation. Returns { ok: true } or { ok: false, reasonCode, ... }.
 * Call this BEFORE computeLine when NPPA or batch-expiry data is available.
 * Does not throw — caller decides throw vs. UI-surface.
 */
export function validateLine(
  input: LineInput,
  ctx: LineValidationContext = {},
): LineValidationResult {
  if (input.mrpPaise <= 0) {
    return {
      ok: false,
      reasonCode: "MRP_NON_POSITIVE",
      message: "MRP must be greater than zero",
      detail: { mrpPaise: input.mrpPaise },
    };
  }
  if (input.qty < 0) {
    return {
      ok: false,
      reasonCode: "NEGATIVE_QTY",
      message: "Quantity cannot be negative",
      detail: { qty: input.qty },
    };
  }
  if (!VALID_GST_RATES.has(input.gstRate)) {
    return {
      ok: false,
      reasonCode: "GST_RATE_INVALID",
      message: `GST rate ${input.gstRate}% not in allowed set (0, 5, 12, 18, 28)`,
      detail: { gstRate: input.gstRate },
    };
  }
  if (input.discountPct !== undefined &&
      (input.discountPct < 0 || input.discountPct > 100)) {
    return {
      ok: false,
      reasonCode: "DISCOUNT_PCT_OUT_OF_RANGE",
      message: "Discount percent must be between 0 and 100",
      detail: { discountPct: input.discountPct },
    };
  }
  const gross = input.mrpPaise * input.qty;
  let disc = 0;
  if (input.discountPaise !== undefined) {
    disc = input.discountPaise;
  } else if (input.discountPct !== undefined) {
    disc = (gross * input.discountPct) / 100;
  }
  if (disc > gross) {
    return {
      ok: false,
      reasonCode: "DISCOUNT_EXCEEDS_GROSS",
      message: "Discount cannot exceed line gross",
      detail: { grossPaise: gross, discountPaise: disc },
    };
  }

  // NPPA / DPCO 2013 ceiling — batch MRP (== input.mrpPaise) must not exceed
  // the product's notified max. Null/undefined means no cap notified.
  const cap = ctx.nppaMaxMrpPaise;
  if (cap != null && input.mrpPaise > cap) {
    return {
      ok: false,
      reasonCode: "NPPA_CAP_EXCEEDED",
      message:
        `MRP ₹${(input.mrpPaise / 100).toFixed(2)} exceeds NPPA ceiling ` +
        `₹${(cap / 100).toFixed(2)} (DPCO 2013)` +
        (ctx.productName ? ` for ${ctx.productName}` : ""),
      detail: {
        mrpPaise: input.mrpPaise,
        nppaMaxMrpPaise: cap,
        productName: ctx.productName,
        batchNo: ctx.batchNo,
      },
    };
  }

  // Expired batch — hard block, no override at this layer (owner-override is A13 concern).
  if (ctx.isExpired) {
    return {
      ok: false,
      reasonCode: "EXPIRED_BATCH",
      message:
        `Batch ${ctx.batchNo ?? ""} is expired — sale blocked ` +
        `(Drugs & Cosmetics Act 1940)`,
      detail: { batchNo: ctx.batchNo, productName: ctx.productName },
    };
  }

  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// Compute
// ──────────────────────────────────────────────────────────────────────────

/** Compute taxes for a single bill line. Throws on invalid input. */
export function computeLine(input: LineInput, treatment: GstTreatment): LineTax {
  if (input.qty < 0) throw new Error("computeLine: qty must be >= 0");
  if (input.gstRate < 0) throw new Error("computeLine: gstRate must be >= 0");

  const gross = paise(input.mrpPaise * input.qty);

  let discount: Paise;
  if (input.discountPaise !== undefined) {
    discount = input.discountPaise;
  } else if (input.discountPct !== undefined) {
    if (input.discountPct < 0 || input.discountPct > 100)
      throw new Error("computeLine: discountPct out of range");
    discount = paise((gross * input.discountPct) / 100);
  } else {
    discount = paise(0);
  }
  if (discount > gross) throw new Error("computeLine: discount exceeds gross");

  const netInclusive = paise(gross - discount);
  const rate = input.gstRate;

  const taxable = treatment === "exempt" || treatment === "nil_rated" || rate === 0
    ? netInclusive
    : paise((netInclusive * 100) / (100 + rate));

  const totalTax = paise(netInclusive - taxable);

  let cgst = paise(0), sgst = paise(0), igst = paise(0);
  if (treatment === "intra_state") {
    const half = paise(totalTax / 2);
    cgst = half;
    // sgst absorbs odd paisa so cgst + sgst === totalTax exactly.
    sgst = paise(totalTax - half);
  } else if (treatment === "inter_state") {
    igst = totalTax;
  }

  const lineTotal = paise(taxable + cgst + sgst + igst);

  return {
    grossPaise: gross,
    discountPaise: discount,
    taxableValuePaise: taxable,
    cgstPaise: cgst,
    sgstPaise: sgst,
    igstPaise: igst,
    cessPaise: paise(0),
    lineTotalPaise: lineTotal,
  };
}

/**
 * Validate + compute in one call. Throws BillValidationError on validation
 * failure, with structured reasonCode for UI routing.
 */
export function computeLineChecked(
  input: LineInput,
  treatment: GstTreatment,
  ctx: LineValidationContext = {},
): LineTax {
  const v = validateLine(input, ctx);
  if (!v.ok) throw new BillValidationError(v);
  return computeLine(input, treatment);
}

/** Aggregate lines + apply invoice-level round-off to nearest rupee. */
export function computeInvoice(lines: readonly LineTax[]): InvoiceTotals {
  const sum = (pick: (l: LineTax) => Paise): Paise =>
    lines.reduce((acc, l) => addP(acc, pick(l)), paise(0) as Paise);

  const subtotal = sum((l) => l.taxableValuePaise);
  const discount = sum((l) => l.discountPaise);
  const cgst = sum((l) => l.cgstPaise);
  const sgst = sum((l) => l.sgstPaise);
  const igst = sum((l) => l.igstPaise);
  const cess = sum((l) => l.cessPaise);
  const preRound = paise(subtotal + cgst + sgst + igst + cess);

  // Nearest rupee (100 paise); round-off signed and bounded to ±50 paise.
  const grandTotal = paise(Math.round(preRound / 100) * 100);
  const roundOff = paise(grandTotal - preRound);

  return {
    subtotalPaise: subtotal,
    discountPaise: discount,
    cgstPaise: cgst,
    sgstPaise: sgst,
    igstPaise: igst,
    cessPaise: cess,
    preRoundPaise: preRound,
    roundOffPaise: roundOff,
    grandTotalPaise: grandTotal,
  };
}

/** Infer treatment from shop state vs customer state. Exempt overrides everything. */
export function inferTreatment(
  shopStateCode: string,
  customerStateCode: string | null,
  isExempt: boolean,
): GstTreatment {
  if (isExempt) return "exempt";
  if (!customerStateCode) return "intra_state"; // walk-in, same state assumed
  return shopStateCode === customerStateCode ? "intra_state" : "inter_state";
}

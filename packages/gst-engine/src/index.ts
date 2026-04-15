// @pharmacare/gst-engine
// India GST calc for pharma retail. All inputs/outputs in paise (integer).
//
// Rules implemented:
//  - MRP-inclusive pricing: taxable = round( mrp * qty * 100 / (100 + gst) )
//  - Line discount applied on taxable value (pre-tax).
//  - Intra-state: CGST = SGST = gst/2. Inter-state: IGST = gst. Exempt: 0.
//  - Round-off on invoice grand-total to nearest rupee (±50 paise cap).
//  - Banker-safe: all money in integer paise; no floats in state.

import { paise, addP, type Paise } from "@pharmacare/shared-types";
import type { GstRate, GstTreatment } from "@pharmacare/shared-types";

export interface LineInput {
  readonly mrpPaise: Paise;       // per unit, GST-inclusive
  readonly qty: number;            // units (integer or decimal, e.g. 0.5 bottle)
  readonly gstRate: GstRate;
  readonly discountPct?: number;   // 0..100, optional
  readonly discountPaise?: Paise;  // absolute, optional (takes precedence if both)
}

export interface LineTax {
  readonly grossPaise: Paise;       // mrp * qty
  readonly discountPaise: Paise;
  readonly taxableValuePaise: Paise; // (gross - discount) * 100 / (100 + gst)
  readonly cgstPaise: Paise;
  readonly sgstPaise: Paise;
  readonly igstPaise: Paise;
  readonly cessPaise: Paise;         // reserved (tobacco/sugar not applicable to pharma, keep 0)
  readonly lineTotalPaise: Paise;    // taxable + tax (= gross - discount, modulo rounding drift)
}

export interface InvoiceTotals {
  readonly subtotalPaise: Paise;      // sum of taxable values
  readonly discountPaise: Paise;
  readonly cgstPaise: Paise;
  readonly sgstPaise: Paise;
  readonly igstPaise: Paise;
  readonly cessPaise: Paise;
  readonly preRoundPaise: Paise;      // subtotal + taxes
  readonly roundOffPaise: Paise;      // signed, ±50 paise
  readonly grandTotalPaise: Paise;    // nearest rupee
}

/** Compute taxes for a single bill line. */
export function computeLine(input: LineInput, treatment: GstTreatment): LineTax {
  if (input.qty < 0) throw new Error("computeLine: qty must be >= 0");
  if (input.gstRate < 0) throw new Error("computeLine: gstRate must be >= 0");

  const gross = paise(input.mrpPaise * input.qty);

  // Discount: absolute takes precedence, else percentage on gross.
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

  // Reverse-charge formula for MRP-inclusive retail.
  const taxable = treatment === "exempt" || treatment === "nil_rated" || rate === 0
    ? netInclusive
    : paise((netInclusive * 100) / (100 + rate));

  const totalTax = paise(netInclusive - taxable);

  let cgst = paise(0), sgst = paise(0), igst = paise(0);
  if (treatment === "intra_state") {
    const half = paise(totalTax / 2);
    cgst = half;
    // sgst takes the remainder to absorb odd paise (so cgst+sgst === totalTax exactly).
    sgst = paise(totalTax - half);
  } else if (treatment === "inter_state") {
    igst = totalTax;
  }
  // exempt / nil_rated => all zero

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

  // Round to nearest rupee (100 paise). Round-off is signed and bounded to ±50 paise.
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
  if (!customerStateCode) return "intra_state"; // B2C walk-in, same state assumed
  return shopStateCode === customerStateCode ? "intra_state" : "inter_state";
}

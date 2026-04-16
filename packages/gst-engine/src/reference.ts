// Reference calculator for A4 golden-fixture cross-check.
//
// Rewrites `computeLine` / `computeInvoice` in BigInt integer arithmetic.
// Purpose: catch regressions that stem from JS Number precision on large
// values, accidental float drift, or transcription bugs in the production
// path. This is a regression-guard oracle, not a fully-independent algebraic
// derivation — the formula itself is the same (taxable = round(net * 100 /
// (100 + rate))), matching CBIC Rule 32(3A) for MRP-inclusive pricing.
//
// Independent algebraic verification lives in the 10 hand-authored
// CANONICAL cases in scripts/generate-golden.ts.

import type { Paise } from "@pharmacare/shared-types";
import type { GstRate, GstTreatment } from "@pharmacare/shared-types";
import type { LineInput, LineTax, InvoiceTotals } from "./index.js";

const toP = (n: number): Paise => Math.round(n) as Paise;
const toB = (n: number): bigint => BigInt(Math.round(n));
const fromB = (b: bigint): Paise => Number(b) as Paise;

/** Half-away-from-zero BigInt division — matches JS Math.round for non-negatives. */
function bdivRound(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new Error("bdivRound: div by zero");
  if (num === 0n) return 0n;
  const sign = (num < 0n) !== (den < 0n) ? -1n : 1n;
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const q = n / d;
  const r = n - q * d;
  return sign * (2n * r >= d ? q + 1n : q);
}

export function referenceComputeLine(
  input: LineInput,
  treatment: GstTreatment,
): LineTax {
  if (input.qty < 0) throw new Error("referenceComputeLine: qty < 0");

  const grossB = toB(input.mrpPaise * input.qty);

  let discB: bigint;
  if (input.discountPaise !== undefined) {
    discB = toB(input.discountPaise);
  } else if (input.discountPct !== undefined) {
    if (input.discountPct < 0 || input.discountPct > 100)
      throw new Error("referenceComputeLine: discountPct out of range");
    discB = bdivRound(grossB * toB(input.discountPct), 100n);
  } else {
    discB = 0n;
  }
  if (discB > grossB) throw new Error("referenceComputeLine: discount > gross");

  const netB = grossB - discB;
  const rateB = BigInt(input.gstRate);

  let taxableB: bigint;
  let taxB: bigint;
  if (treatment === "exempt" || treatment === "nil_rated" || input.gstRate === 0) {
    taxableB = netB;
    taxB = 0n;
  } else {
    // Same algebraic path as production: taxable = round(net * 100 / (100 + rate)).
    taxableB = bdivRound(netB * 100n, 100n + rateB);
    taxB = netB - taxableB;
  }

  let cgstB = 0n, sgstB = 0n, igstB = 0n;
  if (treatment === "intra_state") {
    // Production uses paise(totalTax / 2) = Math.round, which bumps the odd paisa
    // INTO cgst (half-away-from-zero). Mirror that.
    cgstB = bdivRound(taxB, 2n);
    sgstB = taxB - cgstB;
  } else if (treatment === "inter_state") {
    igstB = taxB;
  }

  const lineTotalB = taxableB + cgstB + sgstB + igstB;

  return {
    grossPaise: fromB(grossB),
    discountPaise: fromB(discB),
    taxableValuePaise: fromB(taxableB),
    cgstPaise: fromB(cgstB),
    sgstPaise: fromB(sgstB),
    igstPaise: fromB(igstB),
    cessPaise: toP(0),
    lineTotalPaise: fromB(lineTotalB),
  };
}

export function referenceComputeInvoice(lines: readonly LineTax[]): InvoiceTotals {
  const sumB = (pick: (l: LineTax) => Paise): bigint =>
    lines.reduce((acc, l) => acc + toB(pick(l)), 0n);

  const subtotalB = sumB((l) => l.taxableValuePaise);
  const discountB = sumB((l) => l.discountPaise);
  const cgstB = sumB((l) => l.cgstPaise);
  const sgstB = sumB((l) => l.sgstPaise);
  const igstB = sumB((l) => l.igstPaise);
  const cessB = sumB((l) => l.cessPaise);
  const preRoundB = subtotalB + cgstB + sgstB + igstB + cessB;

  const grandTotalB = bdivRound(preRoundB, 100n) * 100n;
  const roundOffB = grandTotalB - preRoundB;

  return {
    subtotalPaise: fromB(subtotalB),
    discountPaise: fromB(discountB),
    cgstPaise: fromB(cgstB),
    sgstPaise: fromB(sgstB),
    igstPaise: fromB(igstB),
    cessPaise: fromB(cessB),
    preRoundPaise: fromB(preRoundB),
    roundOffPaise: fromB(roundOffB),
    grandTotalPaise: fromB(grandTotalB),
  };
}

export type { GstRate, GstTreatment };

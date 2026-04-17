import type { BillForGstr1 } from "./types.js";
import { B2CL_THRESHOLD_PAISE } from "./types.js";

export type GstrSection = "b2b" | "b2cl" | "b2cs";

/**
 * Deterministic section dispatch for a bill.
 * Rules (ADR 0015):
 *   1. Has customer.gstin (trimmed, 15 chars) → b2b
 *   2. Interstate + grand_total_paise > ₹1L → b2cl
 *   3. Otherwise → b2cs
 * Exempt/nil surfacing is parallel — handled by aggregate.ts.
 */
export function classifyBill(bill: BillForGstr1): GstrSection {
  const gstin = bill.customer?.gstin?.trim() ?? "";
  if (gstin.length === 15) return "b2b";
  if (bill.gstTreatment === "inter_state" && bill.grandTotalPaise > B2CL_THRESHOLD_PAISE) {
    return "b2cl";
  }
  return "b2cs";
}

/** True if bill has any exempt/nil surface (any 0-rate line OR treatment ∈ exempt/nil_rated). */
export function hasExemptSurface(bill: BillForGstr1): boolean {
  if (bill.gstTreatment === "exempt" || bill.gstTreatment === "nil_rated") return true;
  return bill.lines.some((l) => l.gstRate === 0);
}

/** Validate a bill's eligibility for inclusion in GSTR-1 generation.
 * Returns array of reasons (empty = valid). */
export function validateBillForGstr1(
  bill: BillForGstr1,
  shopStateCode: string,
): readonly string[] {
  const reasons: string[] = [];
  if (bill.isVoided === 1) reasons.push("bill is voided");
  if (bill.lines.length === 0) reasons.push("no lines");
  if (!bill.billNo || bill.billNo.trim() === "") reasons.push("missing bill_no");
  if (!/^\d{4}-\d{2}-\d{2}/.test(bill.billedAt)) reasons.push("invalid billed_at");

  // HSN required on every line
  for (const line of bill.lines) {
    if (!line.hsn || line.hsn.trim() === "") {
      reasons.push(`line ${line.id} missing HSN`);
      break; // one msg is enough
    }
  }

  // B2B integrity
  const gstin = bill.customer?.gstin?.trim() ?? "";
  if (gstin.length > 0 && gstin.length !== 15) {
    reasons.push(`customer GSTIN wrong length (${gstin.length})`);
  }

  // Place-of-supply consistency
  if (bill.gstTreatment === "inter_state") {
    const cust = bill.customer?.stateCode?.trim() ?? "";
    if (cust.length > 0 && cust === shopStateCode) {
      reasons.push("interstate bill but customer state matches shop state");
    }
  }
  if (bill.gstTreatment === "intra_state") {
    const cust = bill.customer?.stateCode?.trim() ?? "";
    if (cust.length > 0 && cust !== shopStateCode) {
      reasons.push("intrastate bill but customer state ≠ shop state");
    }
  }

  return reasons;
}

/** Extract the place-of-supply state code for a bill.
 * Priority: customer.stateCode → shop.stateCode (intra) → first 2 chars of customer.gstin.
 */
export function placeOfSupply(bill: BillForGstr1, shopStateCode: string): string {
  if (bill.customer?.stateCode && bill.customer.stateCode.trim().length === 2) {
    return bill.customer.stateCode.trim();
  }
  const gstin = bill.customer?.gstin?.trim() ?? "";
  if (gstin.length === 15) return gstin.substring(0, 2);
  return shopStateCode;
}

// X3 — photo-of-paper-bill → GRN draft. ADR 0024.
//
// Phase 1: package scaffold only. The orchestrator is a stub that returns
// an empty Tier-A result with confidence=0 so downstream callers can wire
// the call site immediately. Tier A/B/C implementations land in
// subsequent phases (see ADR 0024 §"Build phases").
//
// Public API: photoToGrn(input) → PhotoGrnResult.

import type { ParsedBill } from "@pharmacare/gmail-inbox";
import type { PhotoInput, PhotoGrnResult } from "./types.js";

export * from "./types.js";
export { tierA, RE_INVOICE_NO, RE_INVOICE_DATE, RE_GSTIN, RE_SUPPLIER_HEADER, RE_TOTAL, RE_LINE, type TierAOutput } from "./tierA.js";

const EMPTY_BILL: ParsedBill = {
  tier: "A",
  header: {
    invoiceNo: null,
    invoiceDate: null,
    totalPaise: null,
    supplierHint: null,
    confidence: 0,
  },
  lines: [],
};

/**
 * Phase-1 stub. Returns an empty ParsedBill with `requiresOperatorReview=true`
 * so the existing GrnScreen import-banner workflow surfaces the same UX it
 * already has for "Tier A could not parse" outcomes from X1.
 *
 * Replace this implementation in Phase 2 with the real Tier-A → B → C
 * orchestrator (see orchestrate.ts when it lands).
 */
export async function photoToGrn(input: PhotoInput): Promise<PhotoGrnResult> {
  // Reference inputs to silence the unused-param lint until the real impl ships.
  void input.photoPath;
  void input.photoSha256;
  void input.reportedMime;
  void input.shopId;

  return {
    bill: EMPTY_BILL,
    winningTier: "A",
    tiersAttempted: ["A"],
    modelVersion: "stub-0.0.1",
    requiresOperatorReview: true,
    costPaise: 0,
  };
}

/** Orchestrator wrapper: takes pre-OCRd text, runs Tier-A regex, returns
 * a PhotoGrnResult. Use this when you have OCR text from any source
 * (tesseract.js, server-side OCR, etc.) but don't yet have Tier-B/C wired.
 */
import { tierA as _tierA } from "./tierA.js";
import { TIER_A_ESCALATION_THRESHOLD } from "./types.js";
export function photoToGrnFromText(rawOcrText: string, modelVersion = "tier-a-regex-0.1.0"): PhotoGrnResult {
  const { bill, tierConfidence } = _tierA(rawOcrText);
  const requiresOperatorReview = tierConfidence < TIER_A_ESCALATION_THRESHOLD;
  return {
    bill,
    winningTier: "A",
    tiersAttempted: ["A"],
    modelVersion,
    requiresOperatorReview,
    costPaise: 0,
  };
}

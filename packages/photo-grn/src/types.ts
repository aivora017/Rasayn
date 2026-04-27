// X3 photo-of-paper-bill GRN types.
// Per ADR 0024 §3 — uniform ParsedBill shape with X1.
import type { ParsedBill } from "@pharmacare/gmail-inbox";

/** Input to the photo-grn pipeline. */
export interface PhotoInput {
  /** Absolute path to the photo file on disk. */
  readonly photoPath: string;
  /** SHA-256 of the photo bytes for dedupe + audit. */
  readonly photoSha256: string;
  /** Reported MIME — usually 'image/jpeg' from the phone-share intent. */
  readonly reportedMime: string;
  /** Shop id — used to scope per-shop cost cap accounting. */
  readonly shopId: string;
}

/** A single tier's result before orchestration decides whether to escalate. */
export interface TierResult {
  readonly tier: "A" | "B" | "C";
  readonly bill: ParsedBill;
  readonly modelVersion: string;
  /** Aggregate per-tier confidence, [0, 1]. */
  readonly tierConfidence: number;
  /** When tier===C, this is always true. */
  readonly requiresOperatorReview: boolean;
}

/** End-to-end orchestrator output. Always returns a ParsedBill — even if
 * every tier fails, the empty-bill fallback is returned with tier='A'
 * confidence=0 so the GrnScreen import banner can surface "type manually". */
export interface PhotoGrnResult {
  readonly bill: ParsedBill;
  readonly winningTier: "A" | "B" | "C";
  readonly tiersAttempted: readonly ("A" | "B" | "C")[];
  readonly modelVersion: string;
  readonly requiresOperatorReview: boolean;
  /** Cost in paise charged for this run. Tier A = 0, B = ~₹0.50, C = ~₹15. */
  readonly costPaise: number;
}

/** Confidence thresholds — see ADR 0024 §4. */
export const TIER_A_ESCALATION_THRESHOLD = 0.9;
export const TIER_B_ESCALATION_THRESHOLD = 0.92;
export const TIER_B_TOTAL_RECONCILE_TOLERANCE = 0.005; // 0.5%

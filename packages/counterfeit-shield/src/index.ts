// @pharmacare/counterfeit-shield
// TamperShield score combiner: GS1 DataMatrix authenticity + visual-CNN match.
// ADR-0047. The CNN inference + DataMatrix decode happen at the runtime layer
// (printer-escpos for the matrix, ar-shelf / WebGPU for the CNN). This package
// is the pure score-combination logic + decision rules.

// ────────────────────────────────────────────────────────────────────────
// Verdict primitives
// ────────────────────────────────────────────────────────────────────────

export type DataMatrixMatch = "ok" | "fail" | "absent";
export type VisualMatch = "ok" | "suspect" | "unknown";

export interface CounterfeitVerdict {
  /** 0..1, higher = more likely genuine. */
  readonly tamperShieldScore: number;
  readonly dataMatrixMatch: DataMatrixMatch;
  readonly visualMatch: VisualMatch;
  readonly reason?: string;
  /** UI label. "block" = refuse to dispense, "warn" = pharmacist confirms,
   *  "ok" = pass. */
  readonly action: "ok" | "warn" | "block";
}

// ────────────────────────────────────────────────────────────────────────
// Inputs
// ────────────────────────────────────────────────────────────────────────

export interface DataMatrixInputs {
  /** Decoded matrix (gtin/batch/expiry/serial), or null if no DataMatrix on pack. */
  readonly decoded: { gtin: string; batchNo: string; expiry: string; serial: string } | null;
  /** Did the matrix verify against the national registry / our supplier feed? */
  readonly registryVerified: boolean | null;
}

export interface VisualInputs {
  /** Cosine distance vs nearest match in our X2 image library (0=exact, 1=opposite).
   *  null if we couldn't run inference (no camera frame, model not loaded, etc). */
  readonly cosineDistanceToNearest: number | null;
  /** Top-K nearest neighbour decision strength [0..1]. */
  readonly topKConfidence: number | null;
}

// ────────────────────────────────────────────────────────────────────────
// Score thresholds
// ────────────────────────────────────────────────────────────────────────

/** Below this we BLOCK dispensing. Calibrated against pilot fixture set. */
export const SCORE_BLOCK_THRESHOLD = 0.30;
/** Below this we WARN (pharmacist confirms). */
export const SCORE_WARN_THRESHOLD  = 0.60;
/** Above WARN_THRESHOLD = OK. */

/** Distance below this (visual match strong) gives "ok". */
export const VISUAL_MATCH_DISTANCE_OK     = 0.15;
/** Distance above this (visual match weak/wrong) gives "suspect". */
export const VISUAL_MATCH_DISTANCE_SUSPECT = 0.40;

// ────────────────────────────────────────────────────────────────────────
// Combiner
// ────────────────────────────────────────────────────────────────────────

/** Map cosine distance + topK confidence → VisualMatch enum. */
export function classifyVisual(v: VisualInputs): VisualMatch {
  if (v.cosineDistanceToNearest === null) return "unknown";
  if (v.cosineDistanceToNearest <= VISUAL_MATCH_DISTANCE_OK
      && (v.topKConfidence ?? 1) >= 0.7) return "ok";
  if (v.cosineDistanceToNearest >= VISUAL_MATCH_DISTANCE_SUSPECT) return "suspect";
  // Middle band — treat as suspect when topK is low, otherwise ok
  return (v.topKConfidence ?? 0) >= 0.7 ? "ok" : "suspect";
}

/** Map decoded+registry → DataMatrixMatch enum. */
export function classifyDataMatrix(d: DataMatrixInputs): DataMatrixMatch {
  if (!d.decoded) return "absent";
  if (d.registryVerified === true) return "ok";
  if (d.registryVerified === false) return "fail";
  return "absent";  // null = couldn't verify (offline) → treat as absent for scoring
}

/** Combine into a final TamperShield score and action. */
export function combineVerdict(
  d: DataMatrixInputs,
  v: VisualInputs,
): CounterfeitVerdict {
  const dm = classifyDataMatrix(d);
  const vis = classifyVisual(v);

  // Score = weighted average — DataMatrix when present is high-signal (0.6),
  // visual is supporting evidence (0.4). Both 'ok' → 1.0; both bad → 0.0.
  const dmScore = dm === "ok" ? 1.0 : dm === "fail" ? 0.0 : 0.5;     // absent = neutral
  const visScore = vis === "ok" ? 1.0 : vis === "suspect" ? 0.0 : 0.5; // unknown = neutral
  const tamperShieldScore = (dmScore * 0.6) + (visScore * 0.4);

  // Hard rules:
  // - DataMatrix FAIL (registry says counterfeit) ALWAYS blocks regardless of vision.
  // - Visual SUSPECT alone with no DataMatrix only WARNS (ambiguous case).
  let action: CounterfeitVerdict["action"];
  let reason: string | undefined;
  if (dm === "fail") {
    action = "block";
    reason = "GS1 DataMatrix did NOT verify against national registry — possible counterfeit.";
  } else if (vis === "suspect" && dm === "absent") {
    action = "warn";
    reason = "Visual match weak and no DataMatrix to corroborate — pharmacist confirm pack identity.";
  } else if (vis === "suspect" && dm === "ok") {
    // Edge case: matrix verifies but visual is off — could be relabeled stock.
    action = "warn";
    reason = "DataMatrix verified but visual match weak — relabeled or repacked? Confirm.";
  } else if (tamperShieldScore < SCORE_BLOCK_THRESHOLD) {
    action = "block";
    reason = "TamperShield score below safe threshold.";
  } else if (tamperShieldScore < SCORE_WARN_THRESHOLD) {
    action = "warn";
    reason = "TamperShield score in caution band — pharmacist confirm.";
  } else {
    action = "ok";
  }

  return {
    tamperShieldScore,
    dataMatrixMatch: dm,
    visualMatch: vis,
    action,
    ...(reason !== undefined ? { reason } : {}),
  };
}

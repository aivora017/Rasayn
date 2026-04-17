// @pharmacare/gmail-grn-bridge — X1.2 moat (see ADR-0020).
//
// Pure-function bridge from Tier-A ParsedLine (productHint + optional HSN)
// to a local ProductHit selection. Caller supplies candidates — typically
// the top-5 from searchProductsRpc(hint). We score each candidate and
// pick the best match, or declare unmatched.
//
// Zero Tauri imports, zero I/O. Unit-tested in isolation.

export type MatchType = "exact-name" | "token-overlap" | "hsn-assist" | "none";

/** Minimal product candidate shape — mirrors the apps/desktop ProductHit. */
export interface CandidateProduct {
  readonly id: string;
  readonly name: string;
  /** GST HSN code (e.g. "30049099"). May be empty when unknown. */
  readonly hsn?: string | null;
  readonly mrpPaise?: number | null;
}

export interface LineMatch {
  readonly kind: "matched" | "unmatched";
  readonly product: CandidateProduct | null;
  readonly matchType: MatchType;
  /** Confidence on 0..1 scale. 0 for unmatched. */
  readonly confidence: number;
  /** Short human-readable reason; used in chip tooltip. */
  readonly reason: string;
}

/** Confidence thresholds (UI-facing — see ADR-0020). */
export const CONF_HIGH = 0.80;
export const CONF_MEDIUM = 0.50;

/** ADR-0020 rule-2 cutoff: token-Jaccard must be >= 0.6 for token-overlap. */
export const TOKEN_JACCARD_MIN = 0.6;

/** ADR-0020 rule-3 cutoff: hsn-assist requires token-Jaccard >= 0.3. */
export const HSN_JACCARD_MIN = 0.3;

/** Lowercase, strip non-alphanumeric-except-space, collapse runs of space. */
export function normaliseHint(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens = normaliseHint split on space, excluding empties. */
export function tokenise(s: string): readonly string[] {
  const n = normaliseHint(s);
  if (!n) return [];
  return n.split(" ");
}

/** Jaccard similarity over token sets. 0 when both empty. */
export function tokenJaccard(a: string, b: string): number {
  const A = new Set(tokenise(a));
  const B = new Set(tokenise(b));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Match one parsed line's hint (and optional HSN) against the given candidates.
 * Rules applied first-match-wins per ADR-0020:
 *   1. exact-name (conf 0.95)
 *   2. token-overlap (conf = Jaccard × 0.85) if Jaccard >= 0.6
 *   3. hsn-assist   (conf = Jaccard × 0.60) if parsed HSN matches a
 *      candidate HSN AND Jaccard >= 0.3
 *   4. unmatched (conf 0)
 */
export function matchParsedLine(
  hint: string,
  hsn: string | null | undefined,
  candidates: readonly CandidateProduct[],
): LineMatch {
  const normHint = normaliseHint(hint);

  // Guard: empty hint -> unmatched. Don't explode on malformed parses.
  if (normHint.length === 0 || candidates.length === 0) {
    return {
      kind: "unmatched",
      product: null,
      matchType: "none",
      confidence: 0,
      reason: normHint.length === 0 ? "empty hint" : "no candidates",
    };
  }

  // Rule 1: exact normalised name match. Prefer shortest name on ties.
  const exact = candidates
    .filter((c) => normaliseHint(c.name) === normHint)
    .sort((a, b) => a.name.length - b.name.length);
  if (exact.length > 0) {
    return {
      kind: "matched",
      product: exact[0]!,
      matchType: "exact-name",
      confidence: 0.95,
      reason: `exact name: "${exact[0]!.name}"`,
    };
  }

  // Rule 2: token-overlap. Score every candidate, pick best if >= TOKEN_JACCARD_MIN.
  // Ties: higher jaccard wins; then shorter name (more specific).
  const scored = candidates
    .map((c) => ({ c, j: tokenJaccard(hint, c.name) }))
    .sort((a, b) => (b.j - a.j) || (a.c.name.length - b.c.name.length));

  const topScored = scored[0];
  if (topScored && topScored.j >= TOKEN_JACCARD_MIN) {
    const conf = Math.round(topScored.j * 0.85 * 100) / 100;
    return {
      kind: "matched",
      product: topScored.c,
      matchType: "token-overlap",
      confidence: conf,
      reason: `token-overlap: Jaccard=${topScored.j.toFixed(2)}`,
    };
  }

  // Rule 3: hsn-assist. If parsed HSN present, pull candidates whose
  // HSN matches AND whose token-Jaccard is >= HSN_JACCARD_MIN. Pick the
  // one with the highest Jaccard.
  const parsedHsn = (hsn ?? "").trim();
  if (parsedHsn.length > 0) {
    const hsnScored = candidates
      .filter((c) => (c.hsn ?? "").trim() === parsedHsn)
      .map((c) => ({ c, j: tokenJaccard(hint, c.name) }))
      .filter((x) => x.j >= HSN_JACCARD_MIN)
      .sort((a, b) => (b.j - a.j) || (a.c.name.length - b.c.name.length));

    if (hsnScored.length > 0) {
      const top = hsnScored[0]!;
      const conf = Math.round(top.j * 0.6 * 100) / 100;
      return {
        kind: "matched",
        product: top.c,
        matchType: "hsn-assist",
        confidence: conf,
        reason: `hsn=${parsedHsn} + Jaccard=${top.j.toFixed(2)}`,
      };
    }
  }

  return {
    kind: "unmatched",
    product: null,
    matchType: "none",
    confidence: 0,
    reason: "no rule matched (exact/token/hsn all failed)",
  };
}

/** UI helper: confidence → severity tier. */
export function confidenceTier(conf: number): "high" | "medium" | "low" {
  if (conf >= CONF_HIGH) return "high";
  if (conf >= CONF_MEDIUM) return "medium";
  return "low";
}

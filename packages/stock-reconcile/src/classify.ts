import type { ReasonCode, VarianceKind } from './types.js';

/**
 * Auto-suggest a reason code from raw signals.
 * These are *suggestions* — the owner always has the final call at finalize time.
 *
 * Rules (ordered):
 *  - uncounted            → null (no adjustment written)
 *  - match (delta = 0)    → null (no adjustment written)
 *  - expiry within 30d, shortage                 → expiry_dump (pharmacist pulled it)
 *  - shortage > 20% of system qty (min abs 5)    → shrinkage (significant loss)
 *  - small shortage (≤2 units or ≤5%)            → data_entry_error (likely mis-punch)
 *  - overage                                     → data_entry_error (GRN double-counted or under-billed)
 *  - fallback                                    → other
 */
export function classifyReason(input: {
  kind: VarianceKind;
  delta: number;
  systemQty: number;
  expiryDate: string;   // YYYY-MM-DD
  today?: string;       // YYYY-MM-DD, injectable for tests
}): ReasonCode | null {
  if (input.kind === 'uncounted' || input.kind === 'match') return null;
  const { delta, systemQty, expiryDate } = input;
  const today = input.today ?? new Date().toISOString().slice(0, 10);

  if (delta < 0) {
    // shortage branch
    const daysToExpiry = diffDaysISO(today, expiryDate);
    if (daysToExpiry <= 30) return 'expiry_dump';

    const shortagePct = systemQty > 0 ? Math.abs(delta) / systemQty : 1;
    if (Math.abs(delta) >= 5 && shortagePct > 0.2) return 'shrinkage';
    if (Math.abs(delta) <= 2 || shortagePct <= 0.05) return 'data_entry_error';
    return 'shrinkage';
  }

  // overage
  return 'data_entry_error';
}

function diffDaysISO(a: string, b: string): number {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  const ay = pa[0] ?? 1970, am = pa[1] ?? 1, ad = pa[2] ?? 1;
  const by = pb[0] ?? 1970, bm = pb[1] ?? 1, bd = pb[2] ?? 1;
  const msA = Date.UTC(ay, am - 1, ad);
  const msB = Date.UTC(by, bm - 1, bd);
  return Math.round((msB - msA) / 86_400_000);
}

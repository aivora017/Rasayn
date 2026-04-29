// @pharmacare/expiry-discard
// Expired-stock discard register builder + loss accounting. Pure data ops.
//
// Compliance:
//   - Drugs & Cosmetics Rules 1945 §65 — expired drugs cannot be sold or
//     stocked for sale. Must be defaced/destroyed and recorded.
//   - For Schedule X / NDPS items, Form D destruction certificate is needed
//     (witnessed by Drug Inspector or police).
//   - For LLP / Pvt Ltd, the loss is a P&L line item — feeds AOC-4 and ITR.

export type DrugSchedule = "OTC" | "H" | "H1" | "X" | "NDPS";

export interface ExpiredBatch {
  readonly batchId: string;
  readonly productId: string;
  readonly productName: string;
  readonly schedule: DrugSchedule;
  readonly batchNo: string;
  readonly expiryDate: string;       // YYYY-MM-DD
  readonly qty: number;
  readonly avgCostPaise: number;
  readonly mrpPaise: number;
}

export interface DiscardEntry {
  readonly batchId: string;
  readonly productName: string;
  readonly schedule: DrugSchedule;
  readonly batchNo: string;
  readonly expiryDate: string;
  readonly qty: number;
  readonly lossPaise: number;          // qty * avgCost (cost of goods written off)
  readonly mrpForgonePaise: number;     // qty * mrp (revenue not realized)
  readonly requiresFormD: boolean;     // X / NDPS need witnessed destruction
  readonly requiresWitness: boolean;
  readonly witnessName?: string;
  readonly destructionMethod: "incinerate" | "deface_then_dispose" | "return_to_supplier";
  readonly destroyedAtIso?: string;
}

export interface DiscardRegister {
  readonly periodStartIso: string;
  readonly periodEndIso: string;
  readonly entries: readonly DiscardEntry[];
  readonly totalLossPaise: number;
  readonly totalMrpForgonePaise: number;
  readonly schedH1Count: number;
  readonly schedXCount: number;
  readonly ndpsCount: number;
  readonly otcCount: number;
}

// ────────────────────────────────────────────────────────────────────────
// Build
// ────────────────────────────────────────────────────────────────────────

export function buildDiscardEntry(
  batch: ExpiredBatch,
  opts: { destroyedAtIso?: string; witnessName?: string } = {},
): DiscardEntry {
  const requiresFormD = batch.schedule === "X" || batch.schedule === "NDPS";
  const requiresWitness = requiresFormD;
  const method: DiscardEntry["destructionMethod"] =
    batch.schedule === "NDPS" ? "incinerate"
    : batch.schedule === "X" ? "incinerate"
    : "deface_then_dispose";
  return {
    batchId: batch.batchId,
    productName: batch.productName,
    schedule: batch.schedule,
    batchNo: batch.batchNo,
    expiryDate: batch.expiryDate,
    qty: batch.qty,
    lossPaise: batch.qty * batch.avgCostPaise,
    mrpForgonePaise: batch.qty * batch.mrpPaise,
    requiresFormD,
    requiresWitness,
    ...(opts.witnessName !== undefined ? { witnessName: opts.witnessName } : {}),
    destructionMethod: method,
    ...(opts.destroyedAtIso !== undefined ? { destroyedAtIso: opts.destroyedAtIso } : {}),
  };
}

export function buildRegister(
  batches: readonly ExpiredBatch[],
  periodStartIso: string,
  periodEndIso: string,
): DiscardRegister {
  const entries = batches.map((b) => buildDiscardEntry(b));
  const totalLoss = entries.reduce((acc, e) => acc + e.lossPaise, 0);
  const totalMrp = entries.reduce((acc, e) => acc + e.mrpForgonePaise, 0);
  return {
    periodStartIso,
    periodEndIso,
    entries,
    totalLossPaise: totalLoss,
    totalMrpForgonePaise: totalMrp,
    schedH1Count: entries.filter((e) => e.schedule === "H1").length,
    schedXCount: entries.filter((e) => e.schedule === "X").length,
    ndpsCount: entries.filter((e) => e.schedule === "NDPS").length,
    otcCount: entries.filter((e) => e.schedule === "OTC").length,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Filtering helpers
// ────────────────────────────────────────────────────────────────────────

/** Find batches that have expired vs a reference date (YYYY-MM-DD). */
export function findExpired(
  allBatches: readonly { id: string; productId: string; batchNo: string; expiryDate: string; qty: number }[],
  asOfYmd: string,
): readonly { id: string; productId: string; batchNo: string; expiryDate: string; qty: number }[] {
  return allBatches.filter((b) => b.expiryDate < asOfYmd && b.qty > 0);
}

/** Items expiring in N days (early-warning). */
export function findExpiring(
  allBatches: readonly { id: string; productId: string; batchNo: string; expiryDate: string; qty: number }[],
  asOfYmd: string,
  days: number,
): readonly { id: string; productId: string; batchNo: string; expiryDate: string; qty: number; daysUntilExpiry: number }[] {
  const asOf = new Date(asOfYmd).getTime();
  const window = days * 24 * 60 * 60 * 1000;
  const out: { id: string; productId: string; batchNo: string; expiryDate: string; qty: number; daysUntilExpiry: number }[] = [];
  for (const b of allBatches) {
    if (b.qty <= 0) continue;
    const exp = new Date(b.expiryDate).getTime();
    if (exp < asOf) continue; // already expired, not "expiring"
    if (exp - asOf <= window) {
      out.push({ ...b, daysUntilExpiry: Math.floor((exp - asOf) / 86_400_000) });
    }
  }
  return out.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
}

// ────────────────────────────────────────────────────────────────────────
// CSV export (one row per discarded batch — for the CA / drug inspector)
// ────────────────────────────────────────────────────────────────────────

export function toCsv(register: DiscardRegister): string {
  const header = [
    "batch_id", "product_name", "schedule", "batch_no", "expiry_date",
    "qty", "loss_rupees", "mrp_forgone_rupees", "requires_form_d",
    "destruction_method", "witness_name", "destroyed_at",
  ].join(",");
  const rows = register.entries.map((e) => [
    e.batchId,
    csvEscape(e.productName),
    e.schedule,
    csvEscape(e.batchNo),
    e.expiryDate,
    e.qty,
    (e.lossPaise / 100).toFixed(2),
    (e.mrpForgonePaise / 100).toFixed(2),
    e.requiresFormD ? "yes" : "no",
    e.destructionMethod,
    csvEscape(e.witnessName ?? ""),
    e.destroyedAtIso ?? "",
  ].join(","));
  return [header, ...rows].join("\n");
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

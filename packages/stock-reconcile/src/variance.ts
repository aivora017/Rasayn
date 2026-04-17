import type {
  BatchSystemState,
  CountLine,
  VarianceReport,
  VarianceRow,
  VarianceKind,
  ProductVarianceAggregate,
} from './types.js';
import { classifyReason } from './classify.js';

/**
 * Compute variance report from (system snapshot, counted lines).
 *
 * Invariants:
 *   - Every row in system state appears exactly once in the output.
 *   - Lines for batches not in system state are silently dropped (validator
 *     catches these as UNKNOWN_BATCH upstream).
 *   - For duplicate lines on same batch, the last-written line wins (the DB
 *     enforces UNIQUE(session, batch) via append-to-revisions so callers only
 *     ever see one line per batch anyway).
 */
export function computeVariance(input: {
  system: BatchSystemState[];
  lines: CountLine[];
  today?: string;
}): VarianceReport {
  const byBatch = new Map<string, CountLine>();
  for (const ln of input.lines) byBatch.set(ln.batchId, ln);

  const rows: VarianceRow[] = input.system.map((b): VarianceRow => {
    const ln = byBatch.get(b.batchId);
    if (!ln) {
      return {
        batchId: b.batchId,
        productId: b.productId,
        productName: b.productName,
        batchNo: b.batchNo,
        expiryDate: b.expiryDate,
        systemQty: b.systemQty,
        countedQty: null,
        delta: 0,
        kind: 'uncounted',
        suggestedReason: null,
      };
    }
    const delta = ln.countedQty - b.systemQty;
    const kind: VarianceKind = delta === 0 ? 'match' : delta < 0 ? 'shortage' : 'overage';
    return {
      batchId: b.batchId,
      productId: b.productId,
      productName: b.productName,
      batchNo: b.batchNo,
      expiryDate: b.expiryDate,
      systemQty: b.systemQty,
      countedQty: ln.countedQty,
      delta,
      kind,
      suggestedReason: classifyReason(
        input.today !== undefined
          ? { kind, delta, systemQty: b.systemQty, expiryDate: b.expiryDate, today: input.today }
          : { kind, delta, systemQty: b.systemQty, expiryDate: b.expiryDate }
      ),
    };
  });

  const totals = {
    batches: rows.length,
    matched: rows.filter((r) => r.kind === 'match').length,
    shortages: rows.filter((r) => r.kind === 'shortage').length,
    overages: rows.filter((r) => r.kind === 'overage').length,
    uncounted: rows.filter((r) => r.kind === 'uncounted').length,
    netDelta: rows.reduce((s, r) => s + r.delta, 0),
    absoluteDelta: rows.reduce((s, r) => s + Math.abs(r.delta), 0),
  };

  return { rows, totals };
}

/**
 * Aggregate variance rows by product.
 * Used for the "shrinkage heatmap" and finalize summary.
 */
export function aggregateByProduct(report: VarianceReport): ProductVarianceAggregate[] {
  const m = new Map<string, ProductVarianceAggregate>();
  for (const r of report.rows) {
    if (r.kind === 'uncounted' || r.kind === 'match') continue;
    const prev = m.get(r.productId);
    if (prev) {
      prev.batchesAffected += 1;
      prev.netDelta += r.delta;
    } else {
      m.set(r.productId, {
        productId: r.productId,
        productName: r.productName,
        batchesAffected: 1,
        netDelta: r.delta,
      });
    }
  }
  // Sort by |netDelta| desc, then productName for stable display.
  return Array.from(m.values()).sort((a, b) => {
    const d = Math.abs(b.netDelta) - Math.abs(a.netDelta);
    return d !== 0 ? d : a.productName.localeCompare(b.productName);
  });
}

/**
 * Filter rows that need an adjustment written at finalize time.
 * (Everything that isn't a match or uncounted.)
 */
export function rowsNeedingAdjustment(report: VarianceReport): VarianceRow[] {
  return report.rows.filter((r) => r.kind === 'shortage' || r.kind === 'overage');
}

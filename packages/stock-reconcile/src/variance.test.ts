import { describe, it, expect } from 'vitest';
import { computeVariance, aggregateByProduct, rowsNeedingAdjustment } from './variance.js';
import type { BatchSystemState, CountLine } from './types.js';

const TODAY = '2026-04-17';

const B = (batchId: string, productId: string, productName: string, systemQty: number, expiryDate = '2027-06-30', batchNo = batchId.toUpperCase()): BatchSystemState =>
  ({ batchId, productId, productName, batchNo, expiryDate, systemQty });

const L = (batchId: string, productId: string, countedQty: number, by = 'u_staff'): CountLine =>
  ({ batchId, productId, countedQty, countedBy: by, countedAt: '2026-04-17T10:00:00.000Z' });

describe('computeVariance', () => {
  it('classifies match / shortage / overage / uncounted correctly', () => {
    const system = [
      B('b1', 'p1', 'Paracetamol 500', 100),
      B('b2', 'p1', 'Paracetamol 500', 50),
      B('b3', 'p2', 'Amoxicillin 250', 30),
      B('b4', 'p3', 'Dolo 650', 20),
    ];
    const lines = [
      L('b1', 'p1', 100),  // match
      L('b2', 'p1', 45),   // shortage -5
      L('b3', 'p2', 33),   // overage +3
      // b4 uncounted
    ];
    const { rows, totals } = computeVariance({ system, lines, today: TODAY });
    expect(rows).toHaveLength(4);
    expect(rows[0].kind).toBe('match');
    expect(rows[1].kind).toBe('shortage');
    expect(rows[1].delta).toBe(-5);
    expect(rows[2].kind).toBe('overage');
    expect(rows[2].delta).toBe(3);
    expect(rows[3].kind).toBe('uncounted');
    expect(rows[3].countedQty).toBeNull();
    expect(totals).toEqual({
      batches: 4,
      matched: 1,
      shortages: 1,
      overages: 1,
      uncounted: 1,
      netDelta: -2,
      absoluteDelta: 8,
    });
  });

  it('attaches a suggestedReason to non-match, non-uncounted rows', () => {
    const system = [
      B('b1', 'p1', 'Paracetamol', 50, '2026-05-01'), // near-expiry
      B('b2', 'p1', 'Paracetamol', 50, '2027-12-31'),
    ];
    const lines = [L('b1', 'p1', 45), L('b2', 'p1', 40)];
    const { rows } = computeVariance({ system, lines, today: TODAY });
    expect(rows[0].suggestedReason).toBe('expiry_dump');
    expect(rows[1].suggestedReason).toBe('shrinkage'); // -10/50 = 20%, abs 10 >= 5 → shrinkage
  });

  it('silently drops lines for unknown batches (validator catches them)', () => {
    const system = [B('b1', 'p1', 'X', 10)];
    const lines = [L('b1', 'p1', 10), L('ghost', 'p9', 5)];
    const { rows } = computeVariance({ system, lines, today: TODAY });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('match');
  });
});

describe('aggregateByProduct', () => {
  it('groups shortages + overages per product, skips matches & uncounted, sorts by |netDelta|', () => {
    const system = [
      B('b1', 'p1', 'Paracetamol', 100),
      B('b2', 'p1', 'Paracetamol', 50),
      B('b3', 'p2', 'Amoxicillin', 30),
      B('b4', 'p3', 'Dolo 650', 20),
    ];
    const lines = [L('b1', 'p1', 95), L('b2', 'p1', 45), L('b3', 'p2', 29), L('b4', 'p3', 20)];
    const report = computeVariance({ system, lines, today: TODAY });
    const agg = aggregateByProduct(report);
    expect(agg).toEqual([
      { productId: 'p1', productName: 'Paracetamol', batchesAffected: 2, netDelta: -10 },
      { productId: 'p2', productName: 'Amoxicillin', batchesAffected: 1, netDelta: -1 },
    ]);
  });
});

describe('rowsNeedingAdjustment', () => {
  it('returns only shortage + overage rows', () => {
    const system = [
      B('b1', 'p1', 'X', 10),
      B('b2', 'p1', 'X', 10),
      B('b3', 'p1', 'X', 10),
      B('b4', 'p1', 'X', 10),
    ];
    const lines = [L('b1', 'p1', 10), L('b2', 'p1', 8), L('b3', 'p1', 12)];
    const report = computeVariance({ system, lines, today: TODAY });
    const adj = rowsNeedingAdjustment(report);
    expect(adj.map((r) => r.batchId).sort()).toEqual(['b2', 'b3']);
  });
});

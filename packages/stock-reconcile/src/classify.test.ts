import { describe, it, expect } from 'vitest';
import { classifyReason } from './classify.js';

describe('classifyReason', () => {
  const today = '2026-04-17';

  it('returns null for matches and uncounted', () => {
    expect(classifyReason({ kind: 'match', delta: 0, systemQty: 10, expiryDate: '2027-01-31', today })).toBeNull();
    expect(classifyReason({ kind: 'uncounted', delta: 0, systemQty: 10, expiryDate: '2027-01-31', today })).toBeNull();
  });

  it('suggests expiry_dump for shortages on batches expiring within 30 days', () => {
    expect(classifyReason({ kind: 'shortage', delta: -8, systemQty: 10, expiryDate: '2026-05-10', today })).toBe('expiry_dump');
    expect(classifyReason({ kind: 'shortage', delta: -1, systemQty: 10, expiryDate: '2026-05-01', today })).toBe('expiry_dump');
  });

  it('suggests shrinkage for large shortages on fresh stock', () => {
    expect(classifyReason({ kind: 'shortage', delta: -20, systemQty: 50, expiryDate: '2027-06-30', today })).toBe('shrinkage');
  });

  it('suggests data_entry_error for tiny shortages', () => {
    expect(classifyReason({ kind: 'shortage', delta: -1, systemQty: 100, expiryDate: '2027-06-30', today })).toBe('data_entry_error');
    expect(classifyReason({ kind: 'shortage', delta: -2, systemQty: 100, expiryDate: '2027-06-30', today })).toBe('data_entry_error');
  });

  it('suggests data_entry_error for overages (negative evidence of a mis-punch)', () => {
    expect(classifyReason({ kind: 'overage', delta: 5, systemQty: 10, expiryDate: '2027-06-30', today })).toBe('data_entry_error');
  });

  it('falls back to shrinkage for medium shortages', () => {
    // 4 of 20 = 20%, not > 20%, abs >= 5 is false → falls through to shrinkage (medium)
    expect(classifyReason({ kind: 'shortage', delta: -4, systemQty: 20, expiryDate: '2027-06-30', today })).toBe('shrinkage');
  });
});

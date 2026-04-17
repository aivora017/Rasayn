import { describe, it, expect } from 'vitest';
import { validateCountSession, canFinalize } from './validate.js';
import type { BatchSystemState, CountLine } from './types.js';

const B = (id: string): BatchSystemState =>
  ({ batchId: id, productId: 'p1', productName: 'X', batchNo: id, expiryDate: '2027-06-30', systemQty: 10 });
const L = (batchId: string, qty: number): CountLine =>
  ({ batchId, productId: 'p1', countedQty: qty, countedBy: 'u_staff', countedAt: '2026-04-17T10:00:00.000Z' });

describe('validateCountSession', () => {
  it('reports SESSION_CLOSED and short-circuits when session is finalized', () => {
    const errs = validateCountSession({ sessionStatus: 'finalized', system: [B('b1')], lines: [L('b1', 10)] });
    expect(errs).toEqual([{ code: 'SESSION_CLOSED', message: expect.stringContaining('finalized') }]);
  });

  it('flags NEGATIVE_QTY, UNKNOWN_BATCH, DUPLICATE_LINE', () => {
    const errs = validateCountSession({
      sessionStatus: 'open',
      system: [B('b1')],
      lines: [L('b1', -1), L('ghost', 5), L('b1', 10)],
    });
    expect(errs.map((e) => e.code).sort()).toEqual(['DUPLICATE_LINE', 'NEGATIVE_QTY', 'UNKNOWN_BATCH']);
  });

  it('flags EMPTY_SESSION on zero lines', () => {
    const errs = validateCountSession({ sessionStatus: 'open', system: [B('b1')], lines: [] });
    expect(errs.map((e) => e.code)).toContain('EMPTY_SESSION');
  });

  it('returns [] for a clean session', () => {
    const errs = validateCountSession({ sessionStatus: 'open', system: [B('b1'), B('b2')], lines: [L('b1', 10), L('b2', 8)] });
    expect(errs).toEqual([]);
  });
});

describe('canFinalize', () => {
  it('rejects non-owner even if active', () => {
    const r = canFinalize({ sessionStatus: 'open', lines: [L('b1', 10)], userRole: 'cashier', userActive: true });
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('owner') });
  });

  it('rejects inactive owner', () => {
    const r = canFinalize({ sessionStatus: 'open', lines: [L('b1', 10)], userRole: 'owner', userActive: false });
    expect(r).toEqual({ ok: false, reason: 'user is inactive' });
  });

  it('rejects empty session', () => {
    const r = canFinalize({ sessionStatus: 'open', lines: [], userRole: 'owner', userActive: true });
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('no counted lines') });
  });

  it('rejects already-closed session', () => {
    const r = canFinalize({ sessionStatus: 'finalized', lines: [L('b1', 10)], userRole: 'owner', userActive: true });
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('finalized') });
  });

  it('accepts active owner with counted lines on open session', () => {
    expect(canFinalize({ sessionStatus: 'open', lines: [L('b1', 10)], userRole: 'owner', userActive: true })).toEqual({ ok: true });
  });
});

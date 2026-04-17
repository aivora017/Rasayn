import type { CountLine, ValidationError, SessionStatus, BatchSystemState } from './types.js';

export function validateCountSession(input: {
  sessionStatus: SessionStatus;
  system: BatchSystemState[];
  lines: CountLine[];
}): ValidationError[] {
  const errs: ValidationError[] = [];
  if (input.sessionStatus !== 'open') {
    errs.push({ code: 'SESSION_CLOSED', message: `Session is ${input.sessionStatus}; cannot record more lines` });
    return errs;
  }
  const known = new Set(input.system.map((b) => b.batchId));
  const seen = new Set<string>();
  for (const ln of input.lines) {
    if (ln.countedQty < 0) {
      errs.push({ code: 'NEGATIVE_QTY', message: `counted_qty must be >= 0`, batchId: ln.batchId });
    }
    if (!known.has(ln.batchId)) {
      errs.push({ code: 'UNKNOWN_BATCH', message: `batch not in shop inventory`, batchId: ln.batchId });
    }
    if (seen.has(ln.batchId)) {
      errs.push({ code: 'DUPLICATE_LINE', message: `multiple lines for same batch`, batchId: ln.batchId });
    }
    seen.add(ln.batchId);
  }
  if (input.lines.length === 0) {
    errs.push({ code: 'EMPTY_SESSION', message: `cannot finalize a session with zero counted lines` });
  }
  return errs;
}

export function canFinalize(input: {
  sessionStatus: SessionStatus;
  lines: CountLine[];
  userRole: string;
  userActive: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (input.sessionStatus !== 'open') return { ok: false, reason: `session is ${input.sessionStatus}` };
  if (!input.userActive) return { ok: false, reason: 'user is inactive' };
  if (input.userRole !== 'owner') return { ok: false, reason: 'only owner can finalize a count session' };
  if (input.lines.length === 0) return { ok: false, reason: 'session has no counted lines' };
  return { ok: true };
}

// Stock-reconcile types — mirrors DB schema (ADR 0016, migration 0015).
// All qty values are whole-unit integers (strips, bottles, tubes).
// All timestamps are ISO-8601 strings (matches SQLite strftime default).

export type ReasonCode =
  | 'shrinkage'
  | 'damage'
  | 'expiry_dump'
  | 'data_entry_error'
  | 'theft'
  | 'transfer_out'
  | 'other';

export const REASON_CODES: ReadonlyArray<ReasonCode> = [
  'shrinkage',
  'damage',
  'expiry_dump',
  'data_entry_error',
  'theft',
  'transfer_out',
  'other',
] as const;

export type SessionStatus = 'open' | 'finalized' | 'cancelled';

export interface BatchSystemState {
  batchId: string;
  productId: string;
  productName: string;
  batchNo: string;
  expiryDate: string; // YYYY-MM-DD
  systemQty: number;  // batches.qty_on_hand at preview time
}

export interface CountLine {
  batchId: string;
  productId: string;
  countedQty: number;
  countedBy: string;
  countedAt: string;
}

export type VarianceKind = 'match' | 'shortage' | 'overage' | 'uncounted';

export interface VarianceRow {
  batchId: string;
  productId: string;
  productName: string;
  batchNo: string;
  expiryDate: string;
  systemQty: number;
  countedQty: number | null; // null when kind === 'uncounted'
  delta: number;             // counted - system; 0 for uncounted
  kind: VarianceKind;
  suggestedReason: ReasonCode | null; // auto-suggestion, owner can override
}

export interface VarianceReport {
  rows: VarianceRow[];
  totals: {
    batches: number;
    matched: number;
    shortages: number;
    overages: number;
    uncounted: number;
    netDelta: number;             // sum of all deltas (signed)
    absoluteDelta: number;        // sum of |delta|
  };
}

export interface ProductVarianceAggregate {
  productId: string;
  productName: string;
  batchesAffected: number;
  netDelta: number;
}

export type ValidationErrorCode =
  | 'SESSION_CLOSED'
  | 'NEGATIVE_QTY'
  | 'UNKNOWN_BATCH'
  | 'DUPLICATE_LINE'
  | 'EMPTY_SESSION';

export interface ValidationError {
  code: ValidationErrorCode;
  message: string;
  batchId?: string;
}

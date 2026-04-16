// @pharmacare/batch-repo
// -----------------------------------------------------------------------------
// A2 — Batch stock + FEFO allocator + append-only movement ledger.
//
// Host-side mirror (Node / better-sqlite3) of the Rust side that will live in
// apps/desktop/src-tauri/src/batches.rs. Two must stay byte-compatible for the
// perf/regression harness.
//
// Non-negotiables (v2.0 Playbook §2, ADR 0004 row A2):
//   * FEFO deterministic — tiebreak on batch_no.
//   * Expired batches are NEVER returned (enforced both in view and in this repo).
//   * Ledger double-entry: SUM(qty_delta) per batch == batches.qty_on_hand.
//   * All mutations of qty_on_hand MUST go through `recordMovement` (with
//     `alsoUpdateBatch: true`) or through the bill-line trigger. Direct UPDATE
//     outside a transaction is caller error and will break the ledger invariant.
// -----------------------------------------------------------------------------

import type Database from "better-sqlite3";
import type { BatchId, ProductId, UserId, Paise } from "@pharmacare/shared-types";

// -- Types --------------------------------------------------------------------

export type MovementType =
  | "opening"
  | "grn"
  | "bill"
  | "return"
  | "adjust"
  | "waste"
  | "transfer_in"
  | "transfer_out";

export interface FefoAllocation {
  readonly batchId: BatchId;
  readonly batchNo: string;
  readonly qtyTaken: number;
  readonly expiryDate: string;
  readonly mrpPaise: Paise;
}

export interface FefoCandidate {
  readonly batchId: BatchId;
  readonly batchNo: string;
  readonly expiryDate: string;
  readonly qtyOnHand: number;
  readonly mrpPaise: Paise;
}

export interface RecordMovementInput {
  readonly batchId: BatchId;
  readonly qtyDelta: number;             // non-zero; +inbound / -outbound
  readonly movementType: MovementType;
  readonly actorId: UserId | "system";
  readonly refTable?: string | null;     // 'bills' | 'grns' | 'returns' | null
  readonly refId?: string | null;
  readonly reason?: string | null;
}

export interface LedgerDiscrepancy {
  readonly batchId: string;
  readonly productId: string;
  readonly qtyOnHand: number;
  readonly ledgerSum: number;
}

export class InsufficientStockError extends Error {
  public readonly productId: string;
  public readonly qtyNeeded: number;
  public readonly qtyAvailable: number;
  constructor(productId: string, qtyNeeded: number, qtyAvailable: number) {
    super(
      `insufficient stock for product ${productId}: needed ${qtyNeeded}, available ${qtyAvailable}`,
    );
    this.name = "InsufficientStockError";
    this.productId = productId;
    this.qtyNeeded = qtyNeeded;
    this.qtyAvailable = qtyAvailable;
  }
}

// -- Internal helpers ---------------------------------------------------------

/** CSPRNG-free id. Collisions would violate PK, which is caught by the DB; we
 *  accept that because these ids are local-only and get re-issued on retry. */
function newMovementId(): string {
  return `mv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// -- Public API ---------------------------------------------------------------

/**
 * List all FEFO candidates for a product in strict expiry-asc, batch_no-asc
 * order. Excludes expired and zero-qty rows. Used by the Billing screen "Batch
 * override" picker (F7 in A6).
 */
export function listFefoCandidates(
  db: Database.Database,
  productId: ProductId,
): FefoCandidate[] {
  const rows = db
    .prepare(
      `SELECT id, batch_no, expiry_date, qty_on_hand, mrp_paise
         FROM batches
        WHERE product_id = ?
          AND qty_on_hand > 0
          AND expiry_date >= strftime('%Y-%m-%d','now')
        ORDER BY expiry_date ASC, batch_no ASC`,
    )
    .all(productId) as Array<{
      id: string;
      batch_no: string;
      expiry_date: string;
      qty_on_hand: number;
      mrp_paise: number;
    }>;
  return rows.map((r) => ({
    batchId: r.id as BatchId,
    batchNo: r.batch_no,
    expiryDate: r.expiry_date,
    qtyOnHand: r.qty_on_hand,
    mrpPaise: r.mrp_paise as Paise,
  }));
}

/**
 * Allocate `qtyNeeded` units from the oldest non-expired batches of `productId`
 * in FEFO order. Deterministic tiebreak on batch_no. Returns an array of
 * allocations summing to qtyNeeded.
 *
 * Does NOT mutate stock — call `commitAllocations()` inside a transaction to
 * record movements and decrement qty_on_hand.
 *
 * @throws InsufficientStockError if total non-expired stock < qtyNeeded.
 */
export function allocateFefo(
  db: Database.Database,
  productId: ProductId,
  qtyNeeded: number,
): FefoAllocation[] {
  if (!Number.isInteger(qtyNeeded) || qtyNeeded <= 0) {
    throw new Error(`allocateFefo: qtyNeeded must be a positive integer, got ${qtyNeeded}`);
  }

  const candidates = listFefoCandidates(db, productId);

  const allocations: FefoAllocation[] = [];
  let remaining = qtyNeeded;

  for (const c of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(c.qtyOnHand, remaining);
    allocations.push({
      batchId: c.batchId,
      batchNo: c.batchNo,
      qtyTaken: take,
      expiryDate: c.expiryDate,
      mrpPaise: c.mrpPaise,
    });
    remaining -= take;
  }

  if (remaining > 0) {
    const available = qtyNeeded - remaining;
    throw new InsufficientStockError(productId, qtyNeeded, available);
  }

  return allocations;
}

/**
 * Record a single stock movement row. When `alsoUpdateBatch` is true, also
 * mutates `batches.qty_on_hand` by the same delta so the ledger invariant
 * stays intact. Use for GRN inbound, manual adjust, waste, transfer.
 *
 * Do NOT set `alsoUpdateBatch: true` for `'bill'`-type movements — the
 * bill-line trigger writes those and flipping both would double-count.
 *
 * @returns the inserted movement id.
 */
export function recordMovement(
  db: Database.Database,
  input: RecordMovementInput,
  alsoUpdateBatch: boolean = false,
): string {
  if (!Number.isInteger(input.qtyDelta) || input.qtyDelta === 0) {
    throw new Error("recordMovement: qtyDelta must be a non-zero integer");
  }

  const batch = db
    .prepare("SELECT id, product_id, qty_on_hand FROM batches WHERE id = ?")
    .get(input.batchId) as
    | { id: string; product_id: string; qty_on_hand: number }
    | undefined;
  if (!batch) throw new Error(`recordMovement: unknown batchId ${input.batchId}`);

  if (alsoUpdateBatch && batch.qty_on_hand + input.qtyDelta < 0) {
    throw new InsufficientStockError(
      batch.product_id,
      Math.abs(input.qtyDelta),
      batch.qty_on_hand,
    );
  }

  const id = newMovementId();

  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO stock_movements
         (id, batch_id, product_id, qty_delta, movement_type, ref_table, ref_id, actor_id, reason)
       VALUES (@id, @batch_id, @product_id, @qty_delta, @movement_type,
               @ref_table, @ref_id, @actor_id, @reason)`,
    ).run({
      id,
      batch_id: input.batchId,
      product_id: batch.product_id,
      qty_delta: input.qtyDelta,
      movement_type: input.movementType,
      ref_table: input.refTable ?? null,
      ref_id: input.refId ?? null,
      actor_id: input.actorId,
      reason: input.reason ?? null,
    });

    if (alsoUpdateBatch) {
      db.prepare("UPDATE batches SET qty_on_hand = qty_on_hand + ? WHERE id = ?").run(
        input.qtyDelta,
        input.batchId,
      );
    }
  });

  txn();
  return id;
}

/**
 * Commit a set of FEFO allocations as 'bill' movements + qty_on_hand decrements.
 * Atomic: either all rows land or none do. Used directly by bill-core (A6) when
 * the transactional bill-line path is bypassed (rare; mainly for tests).
 *
 * For the common bill flow, the `trg_bill_lines_decrement_stock` trigger does
 * both in one go at INSERT time on bill_lines — you do NOT need to call this.
 */
export function commitAllocations(
  db: Database.Database,
  allocations: readonly FefoAllocation[],
  ref: { table: "bills" | "returns"; id: string; actorId: UserId },
): void {
  const txn = db.transaction(() => {
    for (const a of allocations) {
      recordMovement(
        db,
        {
          batchId: a.batchId,
          qtyDelta: -a.qtyTaken,
          movementType: ref.table === "bills" ? "bill" : "return",
          actorId: ref.actorId,
          refTable: ref.table,
          refId: ref.id,
        },
        true, // alsoUpdateBatch — caller bypassed the bill_lines trigger
      );
    }
  });
  txn();
}

/**
 * Run the double-entry invariant check. Returns an empty array when every
 * batch's ledger sum equals its current qty_on_hand. Used by A11 day-close
 * and by CI perf/regression tests.
 */
export function auditLedger(db: Database.Database): LedgerDiscrepancy[] {
  const rows = db
    .prepare(
      `SELECT b.id  AS batch_id,
              b.product_id,
              b.qty_on_hand,
              COALESCE((SELECT SUM(qty_delta) FROM stock_movements
                        WHERE batch_id = b.id), 0) AS ledger_sum
         FROM batches b`,
    )
    .all() as Array<{
      batch_id: string;
      product_id: string;
      qty_on_hand: number;
      ledger_sum: number;
    }>;

  return rows
    .filter((r) => r.qty_on_hand !== r.ledger_sum)
    .map((r) => ({
      batchId: r.batch_id,
      productId: r.product_id,
      qtyOnHand: r.qty_on_hand,
      ledgerSum: r.ledger_sum,
    }));
}

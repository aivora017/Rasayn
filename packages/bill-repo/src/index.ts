// @pharmacare/bill-repo · canonical bill compute + transactional writer.
// -----------------------------------------------------------------------------
// A6 (ADR 0010). Host-side (Node / better-sqlite3) mirror of what Rust will do
// inside the Tauri `save_bill` command. This package is the single source of
// truth for:
//
//   * Line-tax compute   (via @pharmacare/gst-engine.computeLineChecked — NPPA)
//   * Invoice totals     (via @pharmacare/gst-engine.computeInvoice)
//   * Bill persistence   (bills + bill_lines + audit_log, single transaction)
//   * FEFO auto-pick for draft lines without an explicit batch
//     (via @pharmacare/batch-repo.allocateFefo)
//   * Batch-override candidate listing for the A6 F7 modal
//     (via @pharmacare/batch-repo.listFefoCandidates)
//
// Non-negotiables (Playbook v2.0 §2 / ADR 0004 row A6):
//   * NPPA/DPCO ceiling hard-enforced at save. Breach throws
//     NppaCapExceededError, transaction is never opened.
//   * Expired batch sale = hard block (DB trigger trg_bill_lines_block_expired
//     — we rely on it; do not duplicate the check).
//   * Round-off bounded to ±50 paise; grand_total divisible by 100.
//   * Integer paise only. No float in persisted state.
// -----------------------------------------------------------------------------

import type Database from "better-sqlite3";
import {
  computeLine,
  computeLineChecked,
  computeInvoice,
  inferTreatment,
  BillValidationError,
  type LineInput,
  type LineTax,
  type InvoiceTotals,
  type LineValidationContext,
} from "@pharmacare/gst-engine";
import {
  allocateFefo,
  listFefoCandidates,
  InsufficientStockError,
  type FefoCandidate,
} from "@pharmacare/batch-repo";
import {
  paise,
  TENDER_TOLERANCE_PAISE,
  type GstRate,
  type GstTreatment,
  type Paise,
  type PaymentMode,
  type ProductId,
  type BatchId,
  type Tender,
  type TenderMode,
  type PaymentRow,
} from "@pharmacare/shared-types";

// ---- Types -----------------------------------------------------------------

/** A draft line as seen by the Billing screen before save.
 *  `batchId` null means "let FEFO pick"; non-null = manual override (F7). */
export interface DraftBillLine {
  readonly productId: string;
  readonly batchId: string | null;
  readonly mrpPaise: Paise;
  readonly qty: number;
  readonly gstRate: GstRate;
  readonly discountPct?: number;
  readonly discountPaise?: Paise;
}

export interface SaveBillInput {
  readonly shopId: string;
  readonly billNo: string;
  readonly cashierId: string;
  readonly customerId: string | null;
  readonly doctorId: string | null;
  readonly rxId: string | null;
  readonly paymentMode: PaymentMode;
  /** null or undefined = walk-in (treated as same-state). */
  readonly customerStateCode: string | null;
  readonly lines: ReadonlyArray<DraftBillLine>;
  /**
   * A8 · Split-tender rows (ADR 0012). Optional for backward-compat:
   * - undefined / empty      → single-tender bill = [{mode: paymentMode, amount: grand_total}]
   * - one row (len 1)        → same effect; paymentMode on bills is this row's mode
   * - two+ rows (len >= 2)   → paymentMode on bills is forced to 'split'
   * Sum(amountPaise) MUST equal grand_total_paise ±TENDER_TOLERANCE_PAISE.
   */
  readonly tenders?: ReadonlyArray<Tender>;
}

export interface SaveBillResult {
  readonly billId: string;
  readonly grandTotalPaise: Paise;
  readonly linesInserted: number;
}

export interface ShopCtx {
  readonly shopId: string;
  readonly stateCode: string;
}

/** A single resolved line: an input draft + its computed tax + the
 *  batch that will be debited. */
export interface ResolvedLine {
  readonly input: DraftBillLine;
  readonly batchId: BatchId;
  readonly tax: LineTax;
  readonly warnings: readonly string[];
}

export interface ComputeBillOutput {
  readonly treatment: GstTreatment;
  readonly lines: readonly ResolvedLine[];
  readonly totals: InvoiceTotals;
  readonly warnings: readonly string[];
}

/** Thrown when any line's MRP exceeds the product's NPPA/DPCO ceiling.
 *  Structured so the UI can highlight the offending line. */
export class NppaCapExceededError extends Error {
  public readonly productId: string;
  public readonly mrpPaise: number;
  public readonly capPaise: number;
  public readonly productName: string | undefined;
  constructor(productId: string, mrpPaise: number, capPaise: number, productName?: string) {
    super(
      `NPPA cap exceeded for product ${productName ?? productId}: ` +
      `MRP ${mrpPaise} > cap ${capPaise} (DPCO 2013)`,
    );
    this.name = "NppaCapExceededError";
    this.productId = productId;
    this.mrpPaise = mrpPaise;
    this.capPaise = capPaise;
    this.productName = productName;
  }
}

/** Thrown when sum(tenders) does not match grand_total within tolerance. */
export class TenderMismatchError extends Error {
  public readonly grandTotalPaise: number;
  public readonly tenderSumPaise: number;
  public readonly differencePaise: number;
  constructor(grandTotalPaise: number, tenderSumPaise: number) {
    const diff = tenderSumPaise - grandTotalPaise;
    super(
      `Tender mismatch: tenders sum ${tenderSumPaise} vs grand_total ${grandTotalPaise} ` +
      `(diff ${diff > 0 ? "+" : ""}${diff} paise; tolerance ±${TENDER_TOLERANCE_PAISE})`,
    );
    this.name = "TenderMismatchError";
    this.grandTotalPaise = grandTotalPaise;
    this.tenderSumPaise = tenderSumPaise;
    this.differencePaise = diff;
  }
}

// ---- Internal helpers ------------------------------------------------------

interface ProductMeta {
  readonly name: string;
  readonly nppaMaxMrpPaise: number | null;
}

function loadProductMeta(db: Database.Database, productId: string): ProductMeta {
  const row = db
    .prepare("SELECT name, nppa_max_mrp_paise FROM products WHERE id = ?")
    .get(productId) as { name: string; nppa_max_mrp_paise: number | null } | undefined;
  if (!row) throw new Error(`bill-repo: unknown productId ${productId}`);
  return { name: row.name, nppaMaxMrpPaise: row.nppa_max_mrp_paise };
}

/** Resolve a missing `batchId` via FEFO allocation. */
function resolveBatchId(
  db: Database.Database,
  draft: DraftBillLine,
): BatchId {
  if (draft.batchId) return draft.batchId as BatchId;

  const qtyInt = Math.ceil(draft.qty);
  const allocs = allocateFefo(db, draft.productId as ProductId, qtyInt);

  if (allocs.length === 0) {
    throw new Error(`bill-repo: FEFO returned empty allocation for ${draft.productId}`);
  }

  if (allocs.length > 1) {
    throw new Error(
      `bill-repo: qty ${draft.qty} for product ${draft.productId} spans ${allocs.length} batches; ` +
      `user must split via F7 batch override`,
    );
  }

  return allocs[0]!.batchId;
}

// ---- Public API ------------------------------------------------------------

export function loadShopCtx(db: Database.Database, shopId: string): ShopCtx {
  const row = db.prepare("SELECT state_code FROM shops WHERE id = ?").get(shopId) as
    | { state_code: string } | undefined;
  if (!row) throw new Error(`bill-repo: unknown shopId ${shopId}`);
  return { shopId, stateCode: row.state_code };
}

/** Thin pass-through so UI code only depends on `@pharmacare/bill-repo`. */
export function listCandidateBatches(
  db: Database.Database,
  productId: string,
): readonly FefoCandidate[] {
  return listFefoCandidates(db, productId as ProductId);
}

/**
 * Pure-ish compute pass. Reads shop state and per-product NPPA caps, resolves
 * FEFO auto-picks for any draft line without a batchId, and returns the full
 * resolved bill with totals. Throws:
 *   - NppaCapExceededError    if any line breaches DPCO cap
 *   - InsufficientStockError  if FEFO auto-pick fails
 *   - BillValidationError     if gst-engine rejects (bad GST rate, negative qty, …)
 *   - Error (message only)    for multi-batch split required / bad shop id
 *
 * Does NOT mutate the database.
 */
export function computeBill(
  db: Database.Database,
  input: SaveBillInput,
): ComputeBillOutput {
  const shopCtx = loadShopCtx(db, input.shopId);
  const treatment = inferTreatment(shopCtx.stateCode, input.customerStateCode, false);

  const warnings: string[] = [];
  const resolved: ResolvedLine[] = [];

  for (const draft of input.lines) {
    const batchId = resolveBatchId(db, draft);
    const meta = loadProductMeta(db, draft.productId);

    const lineInput: LineInput = {
      mrpPaise: draft.mrpPaise,
      qty: draft.qty,
      gstRate: draft.gstRate,
      ...(draft.discountPct !== undefined ? { discountPct: draft.discountPct } : {}),
      ...(draft.discountPaise !== undefined ? { discountPaise: draft.discountPaise } : {}),
    };

    const ctx: LineValidationContext = {
      ...(meta.nppaMaxMrpPaise !== null
        ? { nppaMaxMrpPaise: meta.nppaMaxMrpPaise as Paise }
        : {}),
      productName: meta.name,
    };

    let tax: LineTax;
    try {
      tax = computeLineChecked(lineInput, treatment, ctx);
    } catch (e) {
      if (e instanceof BillValidationError && e.reasonCode === "NPPA_CAP_EXCEEDED") {
        throw new NppaCapExceededError(
          draft.productId,
          draft.mrpPaise,
          meta.nppaMaxMrpPaise ?? 0,
          meta.name,
        );
      }
      throw e;
    }

    resolved.push({
      input: draft,
      batchId: batchId as BatchId,
      tax,
      warnings: [],
    });
  }

  const totals = computeInvoice(resolved.map((r) => r.tax));

  return { treatment, lines: resolved, totals, warnings };
}

/**
 * Save a bill + its lines atomically. Writes an audit_log row.
 */
export function saveBill(
  db: Database.Database,
  billId: string,
  input: SaveBillInput,
): SaveBillResult {
  const computed = computeBill(db, input);
  const { treatment, lines, totals } = computed;

  // A8 (ADR 0012) · Resolve tenders:
  // - empty/undefined → single tender = full grand_total in declared paymentMode
  // - one row         → same (mode = row.mode, paymentMode = row.mode)
  // - multiple rows   → split; bills.payment_mode forced to 'split'
  const tendersIn: readonly Tender[] = input.tenders && input.tenders.length > 0
    ? input.tenders
    : [{
        mode: input.paymentMode === "split" ? "cash" : (input.paymentMode as TenderMode),
        amountPaise: totals.grandTotalPaise as Paise,
      }];
  const tenderSum = tendersIn.reduce((a, t) => a + (t.amountPaise as number), 0);
  if (Math.abs(tenderSum - totals.grandTotalPaise) > TENDER_TOLERANCE_PAISE) {
    throw new TenderMismatchError(totals.grandTotalPaise, tenderSum);
  }
  const resolvedPaymentMode: PaymentMode =
    tendersIn.length > 1 ? "split" : (tendersIn[0]!.mode as PaymentMode);

  const txn = db.transaction(() => {
    db.prepare(`
      INSERT INTO bills (id, shop_id, bill_no, customer_id, doctor_id, rx_id, cashier_id,
                        gst_treatment, subtotal_paise, total_discount_paise,
                        total_cgst_paise, total_sgst_paise, total_igst_paise, total_cess_paise,
                        round_off_paise, grand_total_paise, payment_mode)
      VALUES (@id, @shop_id, @bill_no, @customer_id, @doctor_id, @rx_id, @cashier_id,
              @gst_treatment, @subtotal, @discount, @cgst, @sgst, @igst, @cess,
              @round_off, @grand_total, @payment_mode)
    `).run({
      id: billId,
      shop_id: input.shopId,
      bill_no: input.billNo,
      customer_id: input.customerId,
      doctor_id: input.doctorId,
      rx_id: input.rxId,
      cashier_id: input.cashierId,
      gst_treatment: treatment,
      subtotal: totals.subtotalPaise,
      discount: totals.discountPaise,
      cgst: totals.cgstPaise,
      sgst: totals.sgstPaise,
      igst: totals.igstPaise,
      cess: totals.cessPaise,
      round_off: totals.roundOffPaise,
      grand_total: totals.grandTotalPaise,
      payment_mode: resolvedPaymentMode,
    });

    const insertLine = db.prepare(`
      INSERT INTO bill_lines (id, bill_id, product_id, batch_id, qty, mrp_paise,
                              discount_pct, discount_paise, taxable_value_paise, gst_rate,
                              cgst_paise, sgst_paise, igst_paise, cess_paise, line_total_paise)
      VALUES (@id, @bill_id, @product_id, @batch_id, @qty, @mrp,
              @disc_pct, @disc, @taxable, @rate,
              @cgst, @sgst, @igst, @cess, @total)
    `);
    lines.forEach((r, i) => {
      insertLine.run({
        id: `${billId}_l${i + 1}`,
        bill_id: billId,
        product_id: r.input.productId,
        batch_id: r.batchId,
        qty: r.input.qty,
        mrp: r.input.mrpPaise,
        disc_pct: r.input.discountPct ?? 0,
        disc: r.tax.discountPaise,
        taxable: r.tax.taxableValuePaise,
        rate: r.input.gstRate,
        cgst: r.tax.cgstPaise,
        sgst: r.tax.sgstPaise,
        igst: r.tax.igstPaise,
        cess: r.tax.cessPaise,
        total: r.tax.lineTotalPaise,
      });
    });

    const insertPayment = db.prepare(`
      INSERT INTO payments (id, bill_id, mode, amount_paise, ref_no)
      VALUES (@id, @bill_id, @mode, @amount, @ref_no)
    `);
    tendersIn.forEach((t, i) => {
      insertPayment.run({
        id: `${billId}_p${i + 1}`,
        bill_id: billId,
        mode: t.mode,
        amount: t.amountPaise as number,
        ref_no: t.refNo ?? null,
      });
    });

    db.prepare(`INSERT INTO audit_log (actor_id, entity, entity_id, action, payload)
                VALUES (?, 'bill', ?, 'create', ?)`)
      .run(input.cashierId, billId, JSON.stringify({
        billNo: input.billNo,
        total: totals.grandTotalPaise,
        lineCount: lines.length,
        tenderCount: tendersIn.length,
        paymentMode: resolvedPaymentMode,
        treatment,
      }));
  });
  txn();

  return {
    billId,
    grandTotalPaise: paise(totals.grandTotalPaise) as Paise,
    linesInserted: lines.length,
  };
}

export interface BillRow {
  readonly id: string;
  readonly bill_no: string;
  readonly gst_treatment: string;
  readonly subtotal_paise: number;
  readonly total_discount_paise: number;
  readonly total_cgst_paise: number;
  readonly total_sgst_paise: number;
  readonly total_igst_paise: number;
  readonly total_cess_paise: number;
  readonly round_off_paise: number;
  readonly grand_total_paise: number;
  readonly payment_mode: string;
  readonly is_voided: number;
}

export function readBill(db: Database.Database, billId: string): BillRow | undefined {
  return db.prepare("SELECT * FROM bills WHERE id = ?").get(billId) as BillRow | undefined;
}

// Re-exports for UI convenience.
export { computeLine, computeInvoice, inferTreatment, BillValidationError, InsufficientStockError };
export type { LineInput, LineTax, InvoiceTotals, FefoCandidate };


export function listPaymentsByBillId(
  db: Database.Database,
  billId: string,
): readonly PaymentRow[] {
  const rows = db
    .prepare(
      "SELECT id, bill_id, mode, amount_paise, ref_no, created_at " +
      "FROM payments WHERE bill_id = ? ORDER BY id ASC",
    )
    .all(billId) as readonly {
      id: string; bill_id: string; mode: string;
      amount_paise: number; ref_no: string | null; created_at: string;
    }[];
  return rows.map((r) => ({
    id: r.id,
    billId: r.bill_id as unknown as PaymentRow["billId"],
    mode: r.mode as TenderMode,
    amountPaise: paise(r.amount_paise) as Paise,
    refNo: r.ref_no,
    createdAt: r.created_at,
  }));
}

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

/** A13 (ADR 0013) · A sale line pointed at a batch whose expiry_date has
 *  already passed. Hard block — no override possible (Hard Rule 9 / D&C
 *  Act s.27). */
export class ExpiredBatchError extends Error {
  public readonly batchId: string;
  public readonly expiryDate: string;
  public readonly daysPastExpiry: number;
  constructor(batchId: string, expiryDate: string, daysPastExpiry: number) {
    super(
      `Expired batch sale blocked: batch ${batchId} expired ${expiryDate} ` +
      `(${daysPastExpiry} day(s) past expiry)`,
    );
    this.name = "ExpiredBatchError";
    this.batchId = batchId;
    this.expiryDate = expiryDate;
    this.daysPastExpiry = daysPastExpiry;
  }
}

/** A13 (ADR 0013) · A sale line points at a batch that expires within the next
 *  30 days and no matching owner-override audit row exists in the last 10 min
 *  for this batch + cashier. UI must prompt OwnerOverrideModal before retrying. */
export class NearExpiryNoOverrideError extends Error {
  public readonly batchId: string;
  public readonly expiryDate: string;
  public readonly daysToExpiry: number;
  constructor(batchId: string, expiryDate: string, daysToExpiry: number) {
    super(
      `Near-expiry batch requires owner override: batch ${batchId} expires ` +
      `${expiryDate} (${daysToExpiry} day(s) to expiry)`,
    );
    this.name = "NearExpiryNoOverrideError";
    this.batchId = batchId;
    this.expiryDate = expiryDate;
    this.daysToExpiry = daysToExpiry;
  }
}
/**
 * A7 · RX_REQUIRED (ADR 0011). Raised by saveBill when one or more lines
 * reference a Schedule H/H1/X product and input.rxId is null. Callers must
 * record a prescription (via recordPrescription) and retry with rxId set.
 */
export class RxRequiredError extends Error {
  readonly productId: string;
  readonly schedule: string;
  constructor(productId: string, schedule: string) {
    super(`RX_REQUIRED:product_id=${productId}:schedule=${schedule}`);
    this.name = "RxRequiredError";
    this.productId = productId;
    this.schedule = schedule;
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

  // A13 (ADR 0013) · Defensive expiry re-check — server-trust-no-client.
  //   * days_to_expiry <= 0  → hard block (ExpiredBatchError).
  //   * 0 < days <= 30       → require owner-override audit row within last
  //                            10 min keyed by (batch_id, cashier_id).
  //   * days > 30            → pass.
  // Runs BEFORE the write txn so the DB trigger `trg_bill_lines_block_expired`
  // is never reached with a violating row. We still rely on that trigger as a
  // belt-and-braces net; it is not a substitute for this check because it
  // cannot distinguish "expired" from "near-expiry-with-override".
  for (const r of lines) {
    const row = db.prepare(
      "SELECT expiry_date, " +
      "CAST(julianday(expiry_date) - julianday('now') AS REAL) AS days_raw " +
      "FROM batches WHERE id = ?",
    ).get(r.batchId) as { expiry_date: string; days_raw: number } | undefined;
    if (!row) throw new Error(`bill-repo: batch ${r.batchId} not found at expiry re-check`);

    const days = Math.floor(row.days_raw);
    if (days <= 0) {
      throw new ExpiredBatchError(r.batchId, row.expiry_date, -days);
    }
    if (days <= 30) {
      const ok = db.prepare(
        "SELECT COUNT(*) AS c FROM expiry_override_audit " +
        "WHERE batch_id = ? AND actor_user_id = ? " +
        "AND created_at > datetime('now','-10 minutes')",
      ).get(r.batchId, input.cashierId) as { c: number };
      if (ok.c === 0) {
        throw new NearExpiryNoOverrideError(r.batchId, row.expiry_date, days);
      }
    }
  }

  // A7 (ADR 0011) · Rx-required gate — server-trust-no-client.
  // For any line referencing a Schedule H/H1/X product, bills.rx_id must be
  // set. UI opens RxCaptureModal on F8 when an H/H1/X line is present and
  // rx_id is null; this check is belt-and-braces (and is also enforced by DB
  // trigger trg_bill_lines_require_rx from migration 0012).
  if (input.rxId == null) {
    for (const r of lines) {
      const pid = r.input.productId;
      const row = db.prepare(
        "SELECT schedule FROM products WHERE id = ?",
      ).get(pid) as { schedule: string } | undefined;
      if (!row) {
        throw new Error(`bill-repo: product ${pid} not found at rx-gate`);
      }
      if (row.schedule === "H" || row.schedule === "H1" || row.schedule === "X" || row.schedule === "NDPS") {
        throw new RxRequiredError(pid, row.schedule);
      }
    }
  }

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
    const stampOverride = db.prepare(
      "UPDATE expiry_override_audit " +
      "   SET bill_line_id = ?, bill_no = ? " +
      " WHERE batch_id = ? AND actor_user_id = ? " +
      "   AND bill_line_id IS NULL " +
      "   AND created_at > datetime('now','-10 minutes')",
    );
    lines.forEach((r, i) => {
      const lineId = `${billId}_l${i + 1}`;
      insertLine.run({
        id: lineId,
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
      // A13 · Stamp the over-ride audit row with the bill_line_id + bill_no
      // that actually consumed it. Narrow UPDATE: only the latest unstamped
      // row for this batch+cashier gets the link, so repeated same-batch
      // sales don't accidentally share one audit row.
      stampOverride.run(lineId, input.billNo, r.batchId, input.cashierId);
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

// ---------------------------------------------------------------------------
// A13 · recordExpiryOverride (ADR 0013)
// ---------------------------------------------------------------------------
// TS mirror of Rust `record_expiry_override`. Writes a row to
// expiry_override_audit that unblocks exactly one pending near-expiry line
// (matched later, inside saveBill's txn, by (batch_id, actor_user_id, last 10m)).
//
// Contract enforced here (defence-in-depth; DB has CHECK(reason length>=4)
// but not role/expiry):
//   * reason must be >= 4 non-whitespace chars      → REASON_TOO_SHORT
//   * acting user must exist and have role='owner'  → OVERRIDE_FORBIDDEN
//   * batch must not already be expired (days > 0)  → EXPIRED_BATCH_NOT_OVERRIDABLE
//
// Return value gives UI the audit_id + days_past_expiry (negative = days to
// expiry; positive = already expired, but we reject that above) so the
// override chip can show "Overridden (4d to expiry)".
// ---------------------------------------------------------------------------

export interface ExpiryOverrideInput {
  readonly batchId: BatchId;
  readonly actorUserId: string;
  readonly reason: string;
}

export interface ExpiryOverrideResult {
  readonly auditId: string;
  readonly daysPastExpiry: number;
}

export class ExpiryOverrideReasonTooShortError extends Error {
  constructor() {
    super("REASON_TOO_SHORT:min=4");
    this.name = "ExpiryOverrideReasonTooShortError";
  }
}

export class ExpiryOverrideForbiddenError extends Error {
  public readonly actorRole: string;
  constructor(actorRole: string) {
    super(`OVERRIDE_FORBIDDEN:role=${actorRole}`);
    this.name = "ExpiryOverrideForbiddenError";
    this.actorRole = actorRole;
  }
}

export class ExpiryOverrideNotNeededError extends Error {
  public readonly batchId: string;
  public readonly expiryDate: string;
  public readonly daysPastExpiry: number;
  constructor(batchId: string, expiryDate: string, daysPastExpiry: number) {
    super(
      `EXPIRED_BATCH_NOT_OVERRIDABLE:batch=${batchId}:expiry=${expiryDate}:` +
      `days_past=${daysPastExpiry}`,
    );
    this.name = "ExpiryOverrideNotNeededError";
    this.batchId = batchId;
    this.expiryDate = expiryDate;
    this.daysPastExpiry = daysPastExpiry;
  }
}

export function recordExpiryOverride(
  db: Database.Database,
  input: ExpiryOverrideInput,
): ExpiryOverrideResult {
  if (input.reason.trim().length < 4) {
    throw new ExpiryOverrideReasonTooShortError();
  }

  const u = db
    .prepare("SELECT role FROM users WHERE id = ? AND is_active = 1")
    .get(input.actorUserId) as { role: string } | undefined;
  if (!u) throw new ExpiryOverrideForbiddenError("unknown");
  if (u.role !== "owner") throw new ExpiryOverrideForbiddenError(u.role);

  const b = db
    .prepare(
      "SELECT expiry_date, " +
      "CAST(julianday('now') - julianday(expiry_date) AS REAL) AS past " +
      "FROM batches WHERE id = ?",
    )
    .get(input.batchId) as { expiry_date: string; past: number } | undefined;
  if (!b) throw new Error(`bill-repo: batch ${input.batchId} not found`);

  // days_past >= 0 means already expired; override is not a legal escape
  // hatch for that — must be scrapped via return-to-supplier flow.
  const daysPast = Math.floor(b.past);
  if (daysPast >= 0) {
    throw new ExpiryOverrideNotNeededError(input.batchId, b.expiry_date, daysPast);
  }

  const auditId = `eo_${input.batchId}_${Date.now()}`;
  db.prepare(
    "INSERT INTO expiry_override_audit " +
    "(id, product_id, batch_id, actor_user_id, actor_role, reason, days_past_expiry) " +
    "SELECT ?, b.product_id, ?, ?, ?, ?, ? " +
    "  FROM batches b WHERE b.id = ?",
  ).run(
    auditId,
    input.batchId,
    input.actorUserId,
    u.role,
    input.reason.trim(),
    daysPast,
    input.batchId,
  );

  return { auditId, daysPastExpiry: daysPast };
}

// ============================================================================
// A7 · recordPrescription (ADR 0011) — TS mirror of Rust record_prescription
// ----------------------------------------------------------------------------
// Upserts doctor by reg_no, inserts prescriptions row, returns the rx_id.
// retention_until is auto-populated by migration 0012 trigger. Exposed here so
// vitest can exercise the save_bill RX_REQUIRED → retry-with-rxId flow.
// ============================================================================

export interface RecordPrescriptionInput {
  readonly shopId: string;
  readonly customerId: string;
  readonly doctorName: string;
  readonly doctorRegNo: string;
  readonly patientName: string;
  /** ISO-8601 YYYY-MM-DD */
  readonly issuedDate: string;
  readonly kind: "paper" | "digital" | "abdm";
  readonly imagePath: string | null;
  readonly notes: string | null;
}

export interface RecordPrescriptionResult {
  readonly rxId: string;
  readonly doctorId: string;
  readonly retentionUntil: string;
}

export class RxInvalidInputError extends Error {
  readonly field: string;
  constructor(field: string) {
    super(`RX_INVALID_INPUT:${field}`);
    this.name = "RxInvalidInputError";
    this.field = field;
  }
}

export function recordPrescription(
  db: Database.Database,
  input: RecordPrescriptionInput,
): RecordPrescriptionResult {
  if (input.doctorName.trim().length < 2) throw new RxInvalidInputError("doctorName");
  if (input.doctorRegNo.trim().length === 0) throw new RxInvalidInputError("doctorRegNo");
  if (input.patientName.trim().length < 2) throw new RxInvalidInputError("patientName");
  if (!["paper", "digital", "abdm"].includes(input.kind)) throw new RxInvalidInputError("kind");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issuedDate)) throw new RxInvalidInputError("issuedDate");

  const txn = db.transaction(() => {
    const existing = db.prepare(
      "SELECT id FROM doctors WHERE reg_no = ?",
    ).get(input.doctorRegNo.trim()) as { id: string } | undefined;

    let doctorId: string;
    if (existing) {
      doctorId = existing.id;
      db.prepare("UPDATE doctors SET name = ? WHERE id = ?").run(input.doctorName.trim(), doctorId);
    } else {
      doctorId = `d_${Date.now()}`;
      db.prepare("INSERT INTO doctors (id, reg_no, name) VALUES (?, ?, ?)").run(
        doctorId,
        input.doctorRegNo.trim(),
        input.doctorName.trim(),
      );
    }

    const rxId = `rx_${Date.now()}`;
    const noteBody = input.notes && input.notes.trim().length > 0
      ? `patient: ${input.patientName.trim()} | ${input.notes.trim()}`
      : `patient: ${input.patientName.trim()}`;

    db.prepare(
      "INSERT INTO prescriptions (id, shop_id, customer_id, doctor_id, kind, image_path, issued_date, notes) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      rxId,
      input.shopId,
      input.customerId,
      doctorId,
      input.kind,
      input.imagePath,
      input.issuedDate,
      noteBody,
    );

    const retention = db.prepare(
      "SELECT retention_until FROM prescriptions WHERE id = ?",
    ).get(rxId) as { retention_until: string };

    return { rxId, doctorId, retentionUntil: retention.retention_until };
  });

  return txn();
}

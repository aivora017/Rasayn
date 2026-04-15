// @pharmacare/bill-repo · transactional bill writer.
// Host-side (Node/better-sqlite3) mirror of what Rust/rusqlite will do inside Tauri.

import type Database from "better-sqlite3";
import { computeLine, computeInvoice, inferTreatment } from "@pharmacare/gst-engine";
import type { GstRate, PaymentMode, Paise } from "@pharmacare/shared-types";

export interface SaveBillInput {
  readonly shopId: string;
  readonly billNo: string;
  readonly cashierId: string;
  readonly customerId: string | null;
  readonly doctorId: string | null;
  readonly rxId: string | null;
  readonly paymentMode: PaymentMode;
  readonly customerStateCode: string | null;  // null = walk-in
  readonly lines: ReadonlyArray<{
    readonly productId: string;
    readonly batchId: string;
    readonly mrpPaise: Paise;
    readonly qty: number;
    readonly gstRate: GstRate;
    readonly discountPct?: number;
  }>;
}

export interface SaveBillResult {
  readonly billId: string;
  readonly grandTotalPaise: Paise;
  readonly linesInserted: number;
}

/**
 * Save a bill + its lines atomically. Also writes an audit_log row.
 * Returns the inserted billId + grand total. Throws on any CHECK/trigger failure
 * (e.g. expired batch, Schedule H without image) \u2014 transaction rolls back.
 */
export function saveBill(db: Database.Database, billId: string, input: SaveBillInput): SaveBillResult {
  // Resolve shop state for treatment inference.
  const shop = db.prepare("SELECT state_code FROM shops WHERE id = ?").get(input.shopId) as
    | { state_code: string } | undefined;
  if (!shop) throw new Error(`saveBill: unknown shopId ${input.shopId}`);

  const treatment = inferTreatment(shop.state_code, input.customerStateCode, false);

  // Compute every line.
  const taxed = input.lines.map((l) => ({
    raw: l,
    tax: computeLine({
      mrpPaise: l.mrpPaise,
      qty: l.qty,
      gstRate: l.gstRate,
      ...(l.discountPct !== undefined ? { discountPct: l.discountPct } : {}),
    }, treatment),
  }));
  const totals = computeInvoice(taxed.map((t) => t.tax));

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
      payment_mode: input.paymentMode,
    });

    const insertLine = db.prepare(`
      INSERT INTO bill_lines (id, bill_id, product_id, batch_id, qty, mrp_paise,
                              discount_pct, discount_paise, taxable_value_paise, gst_rate,
                              cgst_paise, sgst_paise, igst_paise, cess_paise, line_total_paise)
      VALUES (@id, @bill_id, @product_id, @batch_id, @qty, @mrp,
              @disc_pct, @disc, @taxable, @rate,
              @cgst, @sgst, @igst, @cess, @total)
    `);
    taxed.forEach((t, i) => {
      insertLine.run({
        id: `${billId}_l${i + 1}`,
        bill_id: billId,
        product_id: t.raw.productId,
        batch_id: t.raw.batchId,
        qty: t.raw.qty,
        mrp: t.raw.mrpPaise,
        disc_pct: t.raw.discountPct ?? 0,
        disc: t.tax.discountPaise,
        taxable: t.tax.taxableValuePaise,
        rate: t.raw.gstRate,
        cgst: t.tax.cgstPaise,
        sgst: t.tax.sgstPaise,
        igst: t.tax.igstPaise,
        cess: t.tax.cessPaise,
        total: t.tax.lineTotalPaise,
      });
    });

    db.prepare(`INSERT INTO audit_log (actor_id, entity, entity_id, action, payload)
                VALUES (?, 'bill', ?, 'create', ?)`)
      .run(input.cashierId, billId, JSON.stringify({ billNo: input.billNo, total: totals.grandTotalPaise }));
  });
  txn();

  return {
    billId,
    grandTotalPaise: totals.grandTotalPaise,
    linesInserted: taxed.length,
  };
}

export interface BillRow {
  readonly id: string;
  readonly bill_no: string;
  readonly subtotal_paise: number;
  readonly total_cgst_paise: number;
  readonly total_sgst_paise: number;
  readonly total_igst_paise: number;
  readonly round_off_paise: number;
  readonly grand_total_paise: number;
  readonly gst_treatment: string;
}

export function readBill(db: Database.Database, billId: string): BillRow | undefined {
  return db.prepare("SELECT * FROM bills WHERE id = ?").get(billId) as BillRow | undefined;
}

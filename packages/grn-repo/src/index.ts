// @pharmacare/grn-repo - Goods Receipt Note: receive stock from a supplier
// atomically, writing a grns header row plus per-line batches. Foundation
// for X1 moat (Gmail -> GRN).

import type Database from "better-sqlite3";

export interface SaveGrnLine {
  readonly productId: string;
  readonly batchNo: string;
  readonly mfgDate: string;       // YYYY-MM-DD
  readonly expiryDate: string;    // YYYY-MM-DD
  readonly qty: number;           // > 0
  readonly purchasePricePaise: number;
  readonly mrpPaise: number;
}

export interface SaveGrnInput {
  readonly shopId?: string;
  readonly supplierId: string;
  readonly invoiceNo: string;
  readonly invoiceDate: string;   // YYYY-MM-DD
  readonly source?: "manual" | "gmail" | "photo" | "po_match";
  readonly lines: readonly SaveGrnLine[];
}

export interface SaveGrnResult {
  readonly grnId: string;
  readonly linesInserted: number;
  readonly batchIds: readonly string[];
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Deterministic-ish batch id: b_<grn short>_<idx> - stable within one GRN. */
function batchIdFor(grnId: string, idx: number): string {
  const short = grnId.replace(/^grn_/, "").slice(0, 16);
  return `b_${short}_${String(idx).padStart(3, "0")}`;
}

export function saveGrn(
  db: Database.Database,
  grnId: string,
  input: SaveGrnInput,
): SaveGrnResult {
  assert(grnId.trim().length > 0, "grnId required");
  assert(input.supplierId.trim().length > 0, "supplierId required");
  assert(input.invoiceNo.trim().length > 0, "invoiceNo required");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(input.invoiceDate), "invoiceDate must be YYYY-MM-DD");
  assert(input.lines.length > 0, "at least one line required");

  const shopId = input.shopId
    ?? (db.prepare("SELECT id FROM shops LIMIT 1").get() as { id?: string } | undefined)?.id;
  assert(typeof shopId === "string" && shopId.length > 0, "shopId required (no shop row exists)");

  const insertHeader = db.prepare(`
    INSERT INTO grns (
      id, shop_id, supplier_id, invoice_no, invoice_date,
      total_cost_paise, line_count, status, source
    ) VALUES (
      @id, @shopId, @supplierId, @invoiceNo, @invoiceDate,
      @totalCostPaise, @lineCount, 'posted', @source
    )
  `);

  const insertBatch = db.prepare(`
    INSERT INTO batches (
      id, product_id, batch_no, mfg_date, expiry_date,
      qty_on_hand, purchase_price_paise, mrp_paise,
      supplier_id, grn_id
    ) VALUES (
      @id, @productId, @batchNo, @mfgDate, @expiryDate,
      @qty, @purchasePricePaise, @mrpPaise,
      @supplierId, @grnId
    )
  `);

  const batchIds: string[] = [];

  const tx = db.transaction((lines: readonly SaveGrnLine[]) => {
    let totalCost = 0;
    lines.forEach((ln, i) => {
      assert(ln.qty > 0, `line ${i}: qty must be > 0`);
      assert(ln.purchasePricePaise >= 0, `line ${i}: purchasePricePaise must be >= 0`);
      assert(ln.mrpPaise > 0, `line ${i}: mrpPaise must be > 0`);
      assert(ln.expiryDate >= ln.mfgDate, `line ${i}: expiryDate must be >= mfgDate`);
      totalCost += ln.qty * ln.purchasePricePaise;
    });

    insertHeader.run({
      id: grnId,
      shopId,
      supplierId: input.supplierId,
      invoiceNo: input.invoiceNo,
      invoiceDate: input.invoiceDate,
      totalCostPaise: totalCost,
      lineCount: lines.length,
      source: input.source ?? "manual",
    });

    lines.forEach((ln, i) => {
      const id = batchIdFor(grnId, i + 1);
      insertBatch.run({
        id,
        productId: ln.productId,
        batchNo: ln.batchNo,
        mfgDate: ln.mfgDate,
        expiryDate: ln.expiryDate,
        qty: ln.qty,
        purchasePricePaise: ln.purchasePricePaise,
        mrpPaise: ln.mrpPaise,
        supplierId: input.supplierId,
        grnId,
      });
      batchIds.push(id);
    });
  });

  tx(input.lines);

  return { grnId, linesInserted: input.lines.length, batchIds };
}

export interface GrnHeader {
  readonly id: string;
  readonly supplierId: string;
  readonly invoiceNo: string;
  readonly invoiceDate: string;
  readonly totalCostPaise: number;
  readonly lineCount: number;
  readonly status: string;
  readonly source: string;
  readonly createdAt: string;
}

export function getGrnHeader(db: Database.Database, grnId: string): GrnHeader | null {
  const r = db.prepare(`
    SELECT id, supplier_id, invoice_no, invoice_date,
           total_cost_paise, line_count, status, source, created_at
    FROM grns WHERE id = ?
  `).get(grnId) as any;
  if (!r) return null;
  return {
    id: r.id, supplierId: r.supplier_id, invoiceNo: r.invoice_no,
    invoiceDate: r.invoice_date, totalCostPaise: r.total_cost_paise,
    lineCount: r.line_count, status: r.status, source: r.source,
    createdAt: r.created_at,
  };
}

export function listGrnHeaders(
  db: Database.Database,
  opts?: { readonly shopId?: string; readonly supplierId?: string; readonly fromDate?: string; readonly toDate?: string; readonly limit?: number },
): readonly GrnHeader[] {
  const where: string[] = [];
  const params: any[] = [];
  if (opts?.shopId) { where.push("shop_id = ?"); params.push(opts.shopId); }
  if (opts?.supplierId) { where.push("supplier_id = ?"); params.push(opts.supplierId); }
  if (opts?.fromDate) { where.push("invoice_date >= ?"); params.push(opts.fromDate); }
  if (opts?.toDate) { where.push("invoice_date <= ?"); params.push(opts.toDate); }
  const sql = `
    SELECT id, supplier_id, invoice_no, invoice_date,
           total_cost_paise, line_count, status, source, created_at
    FROM grns
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY invoice_date DESC, created_at DESC
    LIMIT ?
  `;
  params.push(opts?.limit ?? 100);
  return (db.prepare(sql).all(...params) as any[]).map((r) => ({
    id: r.id, supplierId: r.supplier_id, invoiceNo: r.invoice_no,
    invoiceDate: r.invoice_date, totalCostPaise: r.total_cost_paise,
    lineCount: r.line_count, status: r.status, source: r.source,
    createdAt: r.created_at,
  }));
}

/** List all batches that belong to a given GRN - for receipt preview / reprint. */
export function listGrnBatches(db: Database.Database, grnId: string): readonly {
  id: string; productId: string; batchNo: string; expiryDate: string;
  qty: number; purchasePricePaise: number; mrpPaise: number;
}[] {
  const rows = db.prepare(`
    SELECT id, product_id, batch_no, expiry_date, qty_on_hand,
           purchase_price_paise, mrp_paise
    FROM batches
    WHERE grn_id = ?
    ORDER BY id
  `).all(grnId) as any[];
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    batchNo: r.batch_no,
    expiryDate: r.expiry_date,
    qty: r.qty_on_hand,
    purchasePricePaise: r.purchase_price_paise,
    mrpPaise: r.mrp_paise,
  }));
}

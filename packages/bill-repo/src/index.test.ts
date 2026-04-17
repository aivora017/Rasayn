import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb, runMigrations } from "@pharmacare/shared-db";
import { rupeesToPaise, type Paise } from "@pharmacare/shared-types";
import {
  saveBill,
  readBill,
  computeBill,
  loadShopCtx,
  listCandidateBatches,
  NppaCapExceededError,
  InsufficientStockError,
} from "./index.js";

const FAR_FUTURE_1 = "2027-06-30";
const FAR_FUTURE_2 = "2027-12-31";
const FAR_FUTURE_3 = "2028-06-30";
const LAST_YEAR    = "2024-06-30";

function fixture(): Database.Database {
  const db = openDb({ path: ":memory:" });
  runMigrations(db);

  db.prepare(`INSERT INTO shops (id,name,gstin,state_code,retail_license,address)
              VALUES ('shop1','Vaidyanath','27ABCDE1234F1Z5','27','MH-KLN-123','Kalyan')`).run();
  db.prepare(`INSERT INTO users (id,shop_id,name,role,pin_hash)
              VALUES ('u1','shop1','Sourav','owner','x')`).run();
  db.prepare(`INSERT INTO suppliers (id,shop_id,name) VALUES ('sup1','shop1','Cipla')`).run();

  // p_para: NPPA-capped paracetamol (cap = ₹110)
  db.prepare(`INSERT INTO products (id,name,manufacturer,hsn,gst_rate,schedule,pack_form,pack_size,mrp_paise,nppa_max_mrp_paise)
              VALUES ('p_para','Crocin 500','GSK','3004',12,'OTC','tablet',15,11000,11000)`).run();
  db.prepare(`INSERT INTO products (id,name,manufacturer,hsn,gst_rate,schedule,pack_form,pack_size,mrp_paise,image_sha256)
              VALUES ('p_amox','Amoxicillin 500','Cipla','3004',12,'H','capsule',10,5000,'sha256_amox_placeholder')`).run();

  const ins = db.prepare(`INSERT INTO batches
    (id,product_id,batch_no,mfg_date,expiry_date,qty_on_hand,purchase_price_paise,mrp_paise,supplier_id)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  ins.run("b_a1", "p_para", "A001", "2026-01-01", FAR_FUTURE_1, 30, 800, 11000, "sup1");
  ins.run("b_a2", "p_para", "A010", "2026-02-01", FAR_FUTURE_2, 50, 800, 11000, "sup1");
  ins.run("b_a3", "p_para", "A020", "2026-03-01", FAR_FUTURE_3, 50, 800, 11000, "sup1");
  ins.run("b_ax", "p_para", "X999", "2023-01-01", LAST_YEAR,    30, 800, 11000, "sup1");

  ins.run("b_amox", "p_amox", "M001", "2026-01-01", FAR_FUTURE_2, 100, 3500, 5000, "sup1");

  return db;
}

function baseInput(overrides: Partial<Parameters<typeof saveBill>[2]> = {}) {
  return {
    shopId: "shop1",
    billNo: "INV-T-001",
    cashierId: "u1",
    customerId: null,
    doctorId: null,
    rxId: null,
    paymentMode: "cash" as const,
    customerStateCode: null,
    lines: [],
    ...overrides,
  };
}

describe("bill-repo · loadShopCtx", () => {
  it("returns the shop's state code", () => {
    const db = fixture();
    expect(loadShopCtx(db, "shop1")).toEqual({ shopId: "shop1", stateCode: "27" });
  });

  it("throws on unknown shop", () => {
    const db = fixture();
    expect(() => loadShopCtx(db, "nope")).toThrow(/unknown shopId/);
  });
});

describe("bill-repo · listCandidateBatches (F7 data source)", () => {
  it("returns non-expired batches in FEFO order", () => {
    const db = fixture();
    const cs = listCandidateBatches(db, "p_para");
    expect(cs.map((c) => c.batchNo)).toEqual(["A001", "A010", "A020"]);
  });

  it("excludes expired batches", () => {
    const db = fixture();
    const cs = listCandidateBatches(db, "p_para");
    expect(cs.find((c) => c.batchNo === "X999")).toBeUndefined();
  });
});

describe("bill-repo · computeBill (pure)", () => {
  let db: Database.Database;
  beforeEach(() => { db = fixture(); });

  it("FEFO auto-picks when batchId is null", () => {
    const out = computeBill(db, baseInput({
      lines: [{
        productId: "p_para", batchId: null,
        mrpPaise: rupeesToPaise(110) as Paise, qty: 2, gstRate: 12,
      }],
    }));
    expect(out.lines[0]!.batchId).toBe("b_a1");
    expect(out.totals.grandTotalPaise).toBe(22000);
  });

  it("honors manual batch override (F7 simulation)", () => {
    const out = computeBill(db, baseInput({
      lines: [{
        productId: "p_para", batchId: "b_a3",
        mrpPaise: rupeesToPaise(110) as Paise, qty: 2, gstRate: 12,
      }],
    }));
    expect(out.lines[0]!.batchId).toBe("b_a3");
  });

  it("does NOT mutate the database", () => {
    const before: any = db.prepare("SELECT qty_on_hand FROM batches WHERE id='b_a1'").get();
    computeBill(db, baseInput({
      lines: [{
        productId: "p_para", batchId: null,
        mrpPaise: rupeesToPaise(110) as Paise, qty: 2, gstRate: 12,
      }],
    }));
    const after: any = db.prepare("SELECT qty_on_hand FROM batches WHERE id='b_a1'").get();
    expect(after.qty_on_hand).toBe(before.qty_on_hand);
  });

  it("throws NppaCapExceededError when MRP over DPCO cap", () => {
    expect(() => computeBill(db, baseInput({
      lines: [{
        productId: "p_para", batchId: "b_a1",
        mrpPaise: rupeesToPaise(120) as Paise, qty: 1, gstRate: 12,
      }],
    }))).toThrowError(NppaCapExceededError);
  });

  it("surfaces NPPA error with productId + cap for UI to highlight", () => {
    try {
      computeBill(db, baseInput({
        lines: [{
          productId: "p_para", batchId: "b_a1",
          mrpPaise: rupeesToPaise(150) as Paise, qty: 1, gstRate: 12,
        }],
      }));
      throw new Error("expected NppaCapExceededError");
    } catch (e) {
      expect(e).toBeInstanceOf(NppaCapExceededError);
      const err = e as NppaCapExceededError;
      expect(err.productId).toBe("p_para");
      expect(err.capPaise).toBe(11000);
      expect(err.mrpPaise).toBe(15000);
    }
  });

  it("throws InsufficientStockError when FEFO can't cover qty", () => {
    expect(() => computeBill(db, baseInput({
      lines: [{
        productId: "p_amox", batchId: null,
        mrpPaise: rupeesToPaise(50) as Paise, qty: 500, gstRate: 12,
      }],
    }))).toThrowError(InsufficientStockError);
  });

  it("throws MULTI_BATCH_SPLIT on qty spanning multiple batches (needs F7)", () => {
    expect(() => computeBill(db, baseInput({
      lines: [{
        productId: "p_para", batchId: null,
        mrpPaise: rupeesToPaise(110) as Paise, qty: 40, gstRate: 12,
      }],
    }))).toThrow(/spans 2 batches|multi/i);
  });
});

describe("bill-repo · saveBill (transactional)", () => {
  let db: Database.Database;
  beforeEach(() => { db = fixture(); });

  it("1-line intra-state → trigger decrements stock on the FEFO batch", () => {
    const r = saveBill(db, "bill_001", baseInput({
      billNo: "INV-0001",
      lines: [{
        productId: "p_para", batchId: null,
        mrpPaise: rupeesToPaise(110) as Paise, qty: 1, gstRate: 12,
      }],
    }));
    expect(r.linesInserted).toBe(1);
    expect(r.grandTotalPaise).toBe(11000);

    const b = readBill(db, "bill_001")!;
    expect(b.gst_treatment).toBe("intra_state");
    expect(b.total_cgst_paise + b.total_sgst_paise).toBeGreaterThan(0);
    expect(b.total_igst_paise).toBe(0);
    expect(b.grand_total_paise % 100).toBe(0);

    const stock: any = db.prepare("SELECT qty_on_hand FROM batches WHERE id='b_a1'").get();
    expect(stock.qty_on_hand).toBe(29);
  });

  it("inter-state → IGST only, no CGST/SGST", () => {
    db.prepare(`INSERT INTO customers (id,shop_id,name) VALUES ('c1','shop1','Ravi')`).run();
    const r = saveBill(db, "bill_002", baseInput({
      billNo: "INV-0002",
      customerId: "c1",
      paymentMode: "upi",
      customerStateCode: "29",
      lines: [{
        productId: "p_para", batchId: null,
        mrpPaise: rupeesToPaise(110) as Paise, qty: 2, gstRate: 12,
      }],
    }));
    const b = readBill(db, "bill_002")!;
    expect(b.gst_treatment).toBe("inter_state");
    expect(b.total_igst_paise).toBeGreaterThan(0);
    expect(b.total_cgst_paise).toBe(0);
    expect(b.total_sgst_paise).toBe(0);
    expect(r.grandTotalPaise).toBe(22000);
  });

  it("rolls back completely when a trigger aborts mid-transaction", () => {
    expect(() => saveBill(db, "bill_003", baseInput({
      billNo: "INV-0003",
      lines: [
        { productId: "p_para", batchId: "b_a1", mrpPaise: rupeesToPaise(110) as Paise, qty: 1, gstRate: 12 },
        { productId: "p_para", batchId: "b_ax", mrpPaise: rupeesToPaise(110) as Paise, qty: 1, gstRate: 12 },
      ],
    }))).toThrow(/expired batch/i);

    expect(readBill(db, "bill_003")).toBeUndefined();
    const stock: any = db.prepare("SELECT qty_on_hand FROM batches WHERE id='b_a1'").get();
    expect(stock.qty_on_hand).toBe(30);
    const audits: any[] = db.prepare("SELECT * FROM audit_log WHERE entity_id='bill_003'").all();
    expect(audits.length).toBe(0);
  });

  it("NPPA cap breach → no SQL writes at all", () => {
    const stockBefore: any = db.prepare("SELECT qty_on_hand FROM batches WHERE id='b_a1'").get();
    expect(() => saveBill(db, "bill_nppa", baseInput({
      billNo: "INV-NPPA",
      lines: [{
        productId: "p_para", batchId: "b_a1",
        mrpPaise: rupeesToPaise(130) as Paise, qty: 1, gstRate: 12,
      }],
    }))).toThrowError(NppaCapExceededError);

    expect(readBill(db, "bill_nppa")).toBeUndefined();
    const stockAfter: any = db.prepare("SELECT qty_on_hand FROM batches WHERE id='b_a1'").get();
    expect(stockAfter.qty_on_hand).toBe(stockBefore.qty_on_hand);
  });

  it("writes audit_log with lineCount + treatment on success", () => {
    saveBill(db, "bill_004", baseInput({
      billNo: "INV-0004",
      lines: [{
        productId: "p_para", batchId: null,
        mrpPaise: rupeesToPaise(110) as Paise, qty: 1, gstRate: 12,
      }],
    }));
    const row: any = db.prepare("SELECT payload FROM audit_log WHERE entity_id='bill_004'").get();
    const p = JSON.parse(row.payload);
    expect(p.billNo).toBe("INV-0004");
    expect(p.lineCount).toBe(1);
    expect(p.treatment).toBe("intra_state");
  });

  it("3-line bill: per-line cgst+sgst sums equal invoice totals (exact)", () => {
    saveBill(db, "bill_005", baseInput({
      billNo: "INV-0005",
      lines: [
        { productId: "p_para", batchId: "b_a1",  mrpPaise: rupeesToPaise(110) as Paise, qty: 3, gstRate: 12 },
        { productId: "p_amox", batchId: "b_amox", mrpPaise: rupeesToPaise(50)  as Paise, qty: 2, gstRate: 12, discountPct: 5 },
        { productId: "p_para", batchId: "b_a2",  mrpPaise: rupeesToPaise(110) as Paise, qty: 1, gstRate: 12 },
      ],
    }));
    const b = readBill(db, "bill_005")!;
    const sum: any = db.prepare(`
      SELECT SUM(cgst_paise) cg, SUM(sgst_paise) sg, SUM(taxable_value_paise) tax
        FROM bill_lines WHERE bill_id='bill_005'`).get();
    expect(sum.cg).toBe(b.total_cgst_paise);
    expect(sum.sg).toBe(b.total_sgst_paise);
    expect(sum.tax).toBe(b.subtotal_paise);
  });

  it("round_off_paise bounded to ±50, grand_total ends in 00", () => {
    saveBill(db, "bill_006", baseInput({
      billNo: "INV-0006",
      lines: [
        { productId: "p_para", batchId: "b_a1", mrpPaise: rupeesToPaise(110) as Paise, qty: 7, gstRate: 12 },
        { productId: "p_amox", batchId: "b_amox", mrpPaise: rupeesToPaise(50) as Paise, qty: 3, gstRate: 12, discountPct: 3.5 },
      ],
    }));
    const b = readBill(db, "bill_006")!;
    expect(b.round_off_paise).toBeGreaterThanOrEqual(-50);
    expect(b.round_off_paise).toBeLessThanOrEqual(50);
    expect(b.grand_total_paise % 100).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A8 · Payments / tenders (ADR 0012)
// ---------------------------------------------------------------------------
import { listPaymentsByBillId, TenderMismatchError } from "./index.js";

describe("bill-repo · A8 payments", () => {
  let db: Database.Database;
  beforeEach(() => { db = fixture(); });

  it("single-tender bill (no tenders param) writes one payments row", () => {
    saveBill(db, "bill_p1", baseInput({
      billNo: "INV-P-001",
      paymentMode: "upi",
      lines: [{
        productId: "p_para", batchId: "b_a1",
        mrpPaise: rupeesToPaise(110) as Paise, qty: 1, gstRate: 12,
      }],
    }));
    const rows = listPaymentsByBillId(db, "bill_p1");
    expect(rows.length).toBe(1);
    expect(rows[0]!.mode).toBe("upi");
    const b = readBill(db, "bill_p1")!;
    expect(rows[0]!.amountPaise).toBe(b.grand_total_paise as unknown as number);
    expect(b.payment_mode).toBe("upi");
  });

  it("split tender (cash + upi) writes both rows and forces payment_mode='split'", () => {
    saveBill(db, "bill_p2", baseInput({
      billNo: "INV-P-002",
      paymentMode: "split",
      lines: [{
        productId: "p_para", batchId: "b_a1",
        mrpPaise: rupeesToPaise(110) as Paise, qty: 2, gstRate: 12,
      }],
      tenders: [
        { mode: "cash", amountPaise: 10000 as Paise, refNo: null },
        { mode: "upi",  amountPaise: 12000 as Paise, refNo: "RRN123" },
      ],
    }));
    const rows = listPaymentsByBillId(db, "bill_p2");
    expect(rows.map((r) => r.mode)).toEqual(["cash", "upi"]);
    expect(rows[1]!.refNo).toBe("RRN123");
    const b = readBill(db, "bill_p2")!;
    expect(b.payment_mode).toBe("split");
    expect((rows[0]!.amountPaise as unknown as number) + (rows[1]!.amountPaise as unknown as number))
      .toBe(b.grand_total_paise as unknown as number);
  });

  it("throws TenderMismatchError when sum != grand_total beyond tolerance", () => {
    expect(() => saveBill(db, "bill_p3", baseInput({
      billNo: "INV-P-003",
      paymentMode: "split",
      lines: [{
        productId: "p_para", batchId: "b_a1",
        mrpPaise: rupeesToPaise(110) as Paise, qty: 2, gstRate: 12,
      }],
      tenders: [
        { mode: "cash", amountPaise: 5000  as Paise, refNo: null },
        { mode: "upi",  amountPaise: 10000 as Paise, refNo: null }, // total 15000 vs grand 22000
      ],
    }))).toThrowError(TenderMismatchError);
    expect(readBill(db, "bill_p3")).toBeUndefined();
    expect(listPaymentsByBillId(db, "bill_p3").length).toBe(0);
  });

  it("accepts tender sum within ±50 paise tolerance", () => {
    saveBill(db, "bill_p4", baseInput({
      billNo: "INV-P-004",
      paymentMode: "cash",
      lines: [{
        productId: "p_para", batchId: "b_a1",
        mrpPaise: rupeesToPaise(110) as Paise, qty: 1, gstRate: 12,
      }],
      // Bill total is 11000 paise; tender 11040 (+40 paise) is within ±50.
      tenders: [{ mode: "cash", amountPaise: 11040 as Paise, refNo: null }],
    }));
    const rows = listPaymentsByBillId(db, "bill_p4");
    expect(rows.length).toBe(1);
    expect(rows[0]!.amountPaise).toBe(11040);
  });

  it("TenderMismatchError exposes grandTotalPaise/tenderSumPaise/difference", () => {
    try {
      saveBill(db, "bill_p5", baseInput({
        billNo: "INV-P-005",
        paymentMode: "cash",
        lines: [{
          productId: "p_para", batchId: "b_a1",
          mrpPaise: rupeesToPaise(110) as Paise, qty: 1, gstRate: 12,
        }],
        tenders: [{ mode: "cash", amountPaise: 5000 as Paise, refNo: null }],
      }));
      throw new Error("expected TenderMismatchError");
    } catch (e) {
      expect(e).toBeInstanceOf(TenderMismatchError);
      const err = e as TenderMismatchError;
      expect(err.grandTotalPaise).toBe(11000);
      expect(err.tenderSumPaise).toBe(5000);
      expect(err.differencePaise).toBe(-6000);
    }
  });

  it("audit_log payload includes tenderCount and paymentMode='split'", () => {
    saveBill(db, "bill_p6", baseInput({
      billNo: "INV-P-006",
      paymentMode: "split",
      lines: [{
        productId: "p_para", batchId: "b_a1",
        mrpPaise: rupeesToPaise(110) as Paise, qty: 1, gstRate: 12,
      }],
      tenders: [
        { mode: "cash", amountPaise: 6000 as Paise, refNo: null },
        { mode: "card", amountPaise: 5000 as Paise, refNo: "x1234" },
      ],
    }));
    const row: any = db.prepare("SELECT payload FROM audit_log WHERE entity_id='bill_p6'").get();
    const p = JSON.parse(row.payload);
    expect(p.tenderCount).toBe(2);
    expect(p.paymentMode).toBe("split");
  });

  it("ON DELETE CASCADE — deleting a bill removes its payments", () => {
    saveBill(db, "bill_p7", baseInput({
      billNo: "INV-P-007",
      lines: [{
        productId: "p_para", batchId: "b_a1",
        mrpPaise: rupeesToPaise(110) as Paise, qty: 1, gstRate: 12,
      }],
    }));
    expect(listPaymentsByBillId(db, "bill_p7").length).toBe(1);
    db.prepare("DELETE FROM bills WHERE id = ?").run("bill_p7");
    expect(listPaymentsByBillId(db, "bill_p7").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A13 (ADR 0013) · Expiry guard tests
// ---------------------------------------------------------------------------

import {
  ExpiredBatchError,
  NearExpiryNoOverrideError,
  ExpiryOverrideReasonTooShortError,
  ExpiryOverrideForbiddenError,
  ExpiryOverrideNotNeededError,
  recordExpiryOverride,
} from "./index.js";

/** A fixture variant with a batch whose expiry falls inside the 30-day
 *  warn window so the save_bill near-expiry gate engages. */
function fixtureWithNearExpiry(daysFromNow: number): Database.Database {
  const db = fixture();
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  const iso = d.toISOString().slice(0, 10);
  db.prepare(
    "INSERT INTO batches (id,product_id,batch_no,mfg_date,expiry_date,qty_on_hand,purchase_price_paise,mrp_paise,supplier_id) " +
    "VALUES (?,?,?,?,?,?,?,?,?)",
  ).run("b_near", "p_para", "N001", "2026-01-01", iso, 50, 800, 11000, "sup1");
  return db;
}

describe("bill-repo · A13 · saveBill expiry gate", () => {
  it("rejects a line on an already-expired batch with ExpiredBatchError (pre-txn)", () => {
    const db = fixture();
    expect(() =>
      saveBill(db, "bill_exp1", baseInput({
        billNo: "INV-EXP-1",
        lines: [{
          productId: "p_para", batchId: "b_ax",
          mrpPaise: rupeesToPaise(110) as Paise, qty: 1, gstRate: 12,
        }],
      })),
    ).toThrow(ExpiredBatchError);

    // No writes: not even the bills row was inserted (pre-txn guard).
    expect(readBill(db, "bill_exp1")).toBeUndefined();
    const auditCount = db.prepare(
      "SELECT COUNT(*) AS c FROM audit_log WHERE entity_id = 'bill_exp1'",
    ).get() as { c: number };
    expect(auditCount.c).toBe(0);
  });

  it("rejects a near-expiry line (<=30d) without a matching override", () => {
    const db = fixtureWithNearExpiry(15);
    expect(() =>
      saveBill(db, "bill_near1", baseInput({
        billNo: "INV-NEAR-1",
        lines: [{
          productId: "p_para", batchId: "b_near",
          mrpPaise: rupeesToPaise(110) as Paise, qty: 1, gstRate: 12,
        }],
      })),
    ).toThrow(NearExpiryNoOverrideError);
    expect(readBill(db, "bill_near1")).toBeUndefined();
  });

  it("accepts a near-expiry line when an owner-override audit row exists", () => {
    const db = fixtureWithNearExpiry(20);
    const r = recordExpiryOverride(db, {
      batchId: "b_near" as any,
      actorUserId: "u1",
      reason: "urgent patient request, alt batch out-of-stock",
    });
    expect(r.daysPastExpiry).toBeLessThan(0);

    const out = saveBill(db, "bill_near_ok", baseInput({
      billNo: "INV-NEAR-OK",
      lines: [{
        productId: "p_para", batchId: "b_near",
        mrpPaise: rupeesToPaise(110) as Paise, qty: 1, gstRate: 12,
      }],
    }));
    expect(out.linesInserted).toBe(1);

    // The audit row should now be stamped with bill_line_id + bill_no.
    const stamped = db.prepare(
      "SELECT bill_line_id, bill_no FROM expiry_override_audit WHERE batch_id = 'b_near'",
    ).get() as { bill_line_id: string | null; bill_no: string | null };
    expect(stamped.bill_line_id).toBe("bill_near_ok_l1");
    expect(stamped.bill_no).toBe("INV-NEAR-OK");
  });

  it("passes lines > 30 days from expiry without requiring override", () => {
    const db = fixtureWithNearExpiry(120);
    const out = saveBill(db, "bill_far", baseInput({
      billNo: "INV-FAR",
      lines: [{
        productId: "p_para", batchId: "b_near",
        mrpPaise: rupeesToPaise(110) as Paise, qty: 1, gstRate: 12,
      }],
    }));
    expect(out.linesInserted).toBe(1);
    const audits = db.prepare(
      "SELECT COUNT(*) AS c FROM expiry_override_audit",
    ).get() as { c: number };
    expect(audits.c).toBe(0);
  });
});

describe("bill-repo · A13 · recordExpiryOverride", () => {
  it("rejects reason shorter than 4 chars (trimmed)", () => {
    const db = fixtureWithNearExpiry(10);
    expect(() =>
      recordExpiryOverride(db, {
        batchId: "b_near" as any,
        actorUserId: "u1",
        reason: "  ok ",
      }),
    ).toThrow(ExpiryOverrideReasonTooShortError);
  });

  it("rejects a non-owner actor (role=cashier)", () => {
    const db = fixtureWithNearExpiry(10);
    db.prepare(
      "INSERT INTO users (id, shop_id, name, role, pin_hash, is_active) VALUES (?,?,?,?,?,1)",
    ).run("u_cashier", "shop1", "Kajal", "cashier", "x");

    expect(() =>
      recordExpiryOverride(db, {
        batchId: "b_near" as any,
        actorUserId: "u_cashier",
        reason: "legitimate reason here",
      }),
    ).toThrow(ExpiryOverrideForbiddenError);
  });

  it("rejects an already-expired batch (override is not an escape hatch)", () => {
    const db = fixture();
    expect(() =>
      recordExpiryOverride(db, {
        batchId: "b_ax" as any,          // LAST_YEAR expiry
        actorUserId: "u1",
        reason: "trying to override an expired batch",
      }),
    ).toThrow(ExpiryOverrideNotNeededError);
  });
});

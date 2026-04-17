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
    }))).toThrow(/expired batch/);

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

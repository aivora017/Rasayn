import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb, runMigrations } from "@pharmacare/shared-db";
import { saveGrn, listGrnBatches, type SaveGrnInput } from "./index.js";

function seedMinimal(db: Database.Database) {
  db.exec(`
    INSERT INTO shops (id, name, gstin, state_code, retail_license, address)
    VALUES ('shop_test', 'Test Pharmacy', '27ABCDE1234F1Z5', '27', 'MH/KDMC/RX/20-123', 'Kalyan');

    INSERT INTO suppliers (id, shop_id, name, gstin)
    VALUES ('sup_gsk', 'shop_test', 'GlaxoSmithKline', '27AAACG1570E1ZZ');

    INSERT INTO products (id, name, generic_name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise)
    VALUES ('prod_crocin500', 'Crocin 500', 'Paracetamol 500mg', 'GSK', '30049099', 12, 'OTC', 'tablet', 15, 3600),
           ('prod_dolo650',   'Dolo 650',   'Paracetamol 650mg', 'Micro Labs', '30049099', 12, 'OTC', 'tablet', 15, 3495);

    INSERT INTO batches (id, product_id, batch_no, mfg_date, expiry_date, qty_on_hand, purchase_price_paise, mrp_paise, supplier_id)
    VALUES ('bat_existing', 'prod_crocin500', 'CRN2510', '2025-10-01', '2027-09-30', 240, 2400, 3600, 'sup_gsk');
  `);
}

function freshDb(): Database.Database {
  const db = openDb({ path: ":memory:" });
  runMigrations(db);
  seedMinimal(db);
  return db;
}

const BASE: SaveGrnInput = {
  supplierId: "sup_gsk",
  invoiceNo: "GSK/APR/001",
  invoiceDate: "2026-04-15",
  lines: [
    { productId: "prod_crocin500", batchNo: "CRN2604A", mfgDate: "2026-04-01",
      expiryDate: "2028-03-31", qty: 100, purchasePricePaise: 2400, mrpPaise: 3600 },
    { productId: "prod_dolo650", batchNo: "DOL2604A", mfgDate: "2026-04-01",
      expiryDate: "2028-03-31", qty: 50, purchasePricePaise: 2300, mrpPaise: 3495 },
  ],
};

describe("saveGrn", () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it("inserts one batch per line and tags each with grn_id", () => {
    const result = saveGrn(db, "grn_test_001", BASE);
    expect(result.linesInserted).toBe(2);
    expect(result.batchIds).toHaveLength(2);
    const rows = listGrnBatches(db, "grn_test_001");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.qty).toBe(100);
    expect(rows[1]?.batchNo).toBe("DOL2604A");
  });

  it("is atomic: UNIQUE(product_id, batch_no) violation rolls back all lines", () => {
    const bad: SaveGrnInput = {
      ...BASE,
      lines: [
        BASE.lines[0]!,
        { productId: "prod_crocin500", batchNo: "CRN2510", mfgDate: "2026-04-01",
          expiryDate: "2028-03-31", qty: 10, purchasePricePaise: 2400, mrpPaise: 3600 },
      ],
    };
    expect(() => saveGrn(db, "grn_test_002", bad)).toThrow();
    expect(listGrnBatches(db, "grn_test_002")).toHaveLength(0);
  });

  it("Schedule-H product without image_sha256 is rejected at product insert (X2 trigger)", () => {
    expect(() => {
      db.prepare(`INSERT INTO products (id, name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise)
                  VALUES ('prod_noimg', 'NoImg 500', 'X', '30049099', 12, 'H', 'tablet', 10, 5000)`).run();
    }).toThrow(/image_sha256/);
  });

  it("rejects empty lines", () => {
    expect(() => saveGrn(db, "grn_empty", { ...BASE, lines: [] })).toThrow(/at least one line/);
  });

  it("rejects qty <= 0", () => {
    const bad: SaveGrnInput = { ...BASE, lines: [{ ...BASE.lines[0]!, qty: 0 }] };
    expect(() => saveGrn(db, "grn_zero", bad)).toThrow(/qty must be > 0/);
  });

  it("rejects expiry before manufacture", () => {
    const bad: SaveGrnInput = {
      ...BASE,
      lines: [{ ...BASE.lines[0]!, mfgDate: "2026-06-01", expiryDate: "2026-04-01" }],
    };
    expect(() => saveGrn(db, "grn_bad_dates", bad)).toThrow(/expiryDate must be >= mfgDate/);
  });

  it("rejects duplicate (productId, batchNo) within same GRN", () => {
    const bad: SaveGrnInput = { ...BASE, lines: [BASE.lines[0]!, BASE.lines[0]!] };
    expect(() => saveGrn(db, "grn_dup", bad)).toThrow();
    expect(listGrnBatches(db, "grn_dup")).toHaveLength(0);
  });

  it("received stock appears in FEFO view immediately", () => {
    saveGrn(db, "grn_fefo_check", {
      ...BASE,
      lines: [{ productId: "prod_crocin500", batchNo: "CRNNEW", mfgDate: "2026-04-01",
                expiryDate: "2099-12-31", qty: 7, purchasePricePaise: 2400, mrpPaise: 3600 }],
    });
    const row = db.prepare(`SELECT qty_on_hand FROM v_fefo_batches WHERE batch_no = 'CRNNEW'`).get() as any;
    expect(row?.qty_on_hand).toBe(7);
  });
});

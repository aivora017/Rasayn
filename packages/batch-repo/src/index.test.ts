import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb, runMigrations } from "@pharmacare/shared-db";
import type { BatchId, ProductId, UserId, Paise } from "@pharmacare/shared-types";
import {
  allocateFefo,
  listFefoCandidates,
  recordMovement,
  commitAllocations,
  auditLedger,
  InsufficientStockError,
} from "./index.js";

// -----------------------------------------------------------------------------
// Fixture: 1 shop, 1 supplier, 1 product, N batches with staggered expiries.
// Dates are cast to a fixed "today" value by using explicit future / past
// expiry strings so the tests are deterministic regardless of wall clock.
// -----------------------------------------------------------------------------

const FAR_FUTURE_1 = "2027-06-30"; // oldest non-expired in fixture
const FAR_FUTURE_2 = "2027-12-31";
const FAR_FUTURE_3 = "2028-06-30";
const LAST_YEAR    = "2024-06-30"; // already expired at any runtime after 2024

function fixture(): Database.Database {
  const db = openDb({ path: ":memory:" });
  runMigrations(db);

  db.prepare(`INSERT INTO shops (id,name,gstin,state_code,retail_license,address)
              VALUES ('shop1','Vaidyanath','27ABCDE1234F1Z5','27','MH-KLN-123','Kalyan')`).run();
  db.prepare(`INSERT INTO users (id,shop_id,name,role,pin_hash)
              VALUES ('u1','shop1','Sourav','owner','x')`).run();
  db.prepare(`INSERT INTO suppliers (id,shop_id,name) VALUES ('sup1','shop1','Cipla')`).run();

  db.prepare(`INSERT INTO products (id,name,manufacturer,hsn,gst_rate,schedule,pack_form,pack_size,mrp_paise)
              VALUES ('p_para','Crocin 500','GSK','3004',12,'OTC','tablet',15,11200)`).run();
  db.prepare(`INSERT INTO products (id,name,manufacturer,hsn,gst_rate,schedule,pack_form,pack_size,mrp_paise)
              VALUES ('p_amox','Amoxicillin 500','Cipla','3004',12,'OTC','capsule',10,5000)`).run();

  // para: three non-expired batches with staggered expiries + deliberate tie.
  //   bF1 expires 2027-06 qty=20
  //   bF1b expires 2027-06 qty=15   ← same expiry as bF1 → batch_no tiebreak
  //   bF2 expires 2027-12 qty=100
  //   bF3 expires 2028-06 qty=50
  //   bX  expires 2024-06 qty=30    ← expired; must never be picked
  const insBatch = db.prepare(`
    INSERT INTO batches (id,product_id,batch_no,mfg_date,expiry_date,qty_on_hand,
                         purchase_price_paise,mrp_paise,supplier_id)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  insBatch.run("b_f1", "p_para", "A001", "2026-01-01", FAR_FUTURE_1, 20, 800, 11200, "sup1");
  insBatch.run("b_f1b","p_para", "A002", "2026-01-01", FAR_FUTURE_1, 15, 800, 11200, "sup1");
  insBatch.run("b_f2", "p_para", "A010", "2026-02-01", FAR_FUTURE_2, 100, 800, 11200, "sup1");
  insBatch.run("b_f3", "p_para", "A020", "2026-03-01", FAR_FUTURE_3, 50, 800, 11200, "sup1");
  insBatch.run("b_x",  "p_para", "X999", "2023-01-01", LAST_YEAR,    30, 800, 11200, "sup1");

  return db;
}

// -----------------------------------------------------------------------------

describe("batch-repo · listFefoCandidates", () => {
  let db: Database.Database;
  beforeEach(() => { db = fixture(); });

  it("returns non-expired batches in (expiry asc, batch_no asc) order", () => {
    const cs = listFefoCandidates(db, "p_para" as ProductId);
    expect(cs.map((c) => c.batchNo)).toEqual(["A001", "A002", "A010", "A020"]);
  });

  it("excludes expired batches entirely", () => {
    const cs = listFefoCandidates(db, "p_para" as ProductId);
    expect(cs.find((c) => c.batchNo === "X999")).toBeUndefined();
  });

  it("excludes zero-qty batches", () => {
    db.prepare("UPDATE batches SET qty_on_hand = 0 WHERE id = 'b_f1'").run();
    const cs = listFefoCandidates(db, "p_para" as ProductId);
    expect(cs.map((c) => c.batchNo)).toEqual(["A002", "A010", "A020"]);
  });

  it("returns empty array when product has no stock", () => {
    const cs = listFefoCandidates(db, "p_amox" as ProductId);
    expect(cs).toEqual([]);
  });
});

// -----------------------------------------------------------------------------

describe("batch-repo · allocateFefo", () => {
  let db: Database.Database;
  beforeEach(() => { db = fixture(); });

  it("fully fills from the oldest batch when it has enough stock", () => {
    const a = allocateFefo(db, "p_para" as ProductId, 10);
    expect(a).toHaveLength(1);
    expect(a[0]!.batchNo).toBe("A001");
    expect(a[0]!.qtyTaken).toBe(10);
  });

  it("spreads across batches in strict FEFO order with deterministic batch_no tiebreak", () => {
    // Need 40 total: A001=20 + A002=15 + A010=5
    const a = allocateFefo(db, "p_para" as ProductId, 40);
    expect(a.map((x) => [x.batchNo, x.qtyTaken])).toEqual([
      ["A001", 20],
      ["A002", 15],
      ["A010", 5],
    ]);
  });

  it("never picks an expired batch even when non-expired stock is insufficient", () => {
    db.prepare("UPDATE batches SET qty_on_hand = 0 WHERE id IN ('b_f1','b_f1b','b_f2','b_f3')").run();
    // Only b_x (expired, 30 units) remains. Must refuse.
    expect(() => allocateFefo(db, "p_para" as ProductId, 1)).toThrow(InsufficientStockError);
  });

  it("throws InsufficientStockError with (needed, available) when over-allocating", () => {
    // Non-expired total = 20+15+100+50 = 185
    try {
      allocateFefo(db, "p_para" as ProductId, 200);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientStockError);
      const err = e as InsufficientStockError;
      expect(err.qtyNeeded).toBe(200);
      expect(err.qtyAvailable).toBe(185);
    }
  });

  it("rejects non-positive qtyNeeded", () => {
    expect(() => allocateFefo(db, "p_para" as ProductId, 0)).toThrow();
    expect(() => allocateFefo(db, "p_para" as ProductId, -1)).toThrow();
    expect(() => allocateFefo(db, "p_para" as ProductId, 1.5)).toThrow();
  });
});

// -----------------------------------------------------------------------------

describe("batch-repo · recordMovement + ledger invariant", () => {
  let db: Database.Database;
  beforeEach(() => { db = fixture(); });

  it("opening movements seeded for every pre-existing batch", () => {
    // Migration 0007 writes one 'opening' row per non-zero batch.
    const rows = db.prepare(
      `SELECT batch_id, qty_delta, movement_type FROM stock_movements
       WHERE movement_type='opening' ORDER BY batch_id`,
    ).all() as Array<{ batch_id: string; qty_delta: number; movement_type: string }>;
    expect(rows.map((r) => r.batch_id)).toEqual(["b_f1","b_f1b","b_f2","b_f3","b_x"]);
    // Sum of opening rows equals sum of qty_on_hand
    const sumOpen = rows.reduce((s, r) => s + r.qty_delta, 0);
    expect(sumOpen).toBe(20 + 15 + 100 + 50 + 30);
  });

  it("auditLedger returns [] on a fresh DB after migrations", () => {
    expect(auditLedger(db)).toEqual([]);
  });

  it("GRN inbound: recordMovement with alsoUpdateBatch bumps qty + logs row", () => {
    recordMovement(
      db,
      {
        batchId: "b_f1" as BatchId,
        qtyDelta: 50,
        movementType: "grn",
        actorId: "u1" as UserId,
        refTable: "grns",
        refId: "grn_0001",
      },
      true,
    );
    const b = db.prepare("SELECT qty_on_hand FROM batches WHERE id='b_f1'").get() as { qty_on_hand: number };
    expect(b.qty_on_hand).toBe(70);
    expect(auditLedger(db)).toEqual([]);
  });

  it("waste: recordMovement with negative delta decrements + balances", () => {
    recordMovement(
      db,
      {
        batchId: "b_f1" as BatchId,
        qtyDelta: -5,
        movementType: "waste",
        actorId: "u1" as UserId,
        reason: "damaged strip",
      },
      true,
    );
    const b = db.prepare("SELECT qty_on_hand FROM batches WHERE id='b_f1'").get() as { qty_on_hand: number };
    expect(b.qty_on_hand).toBe(15);
    expect(auditLedger(db)).toEqual([]);
  });

  it("rejects qty_delta=0 and non-integer deltas", () => {
    expect(() =>
      recordMovement(db, {
        batchId: "b_f1" as BatchId,
        qtyDelta: 0,
        movementType: "adjust",
        actorId: "u1" as UserId,
      }),
    ).toThrow();
    expect(() =>
      recordMovement(db, {
        batchId: "b_f1" as BatchId,
        qtyDelta: 2.5,
        movementType: "adjust",
        actorId: "u1" as UserId,
      }),
    ).toThrow();
  });

  it("refuses to let qty_on_hand go negative when alsoUpdateBatch=true", () => {
    expect(() =>
      recordMovement(
        db,
        {
          batchId: "b_f1" as BatchId,
          qtyDelta: -9999,
          movementType: "waste",
          actorId: "u1" as UserId,
        },
        true,
      ),
    ).toThrow(InsufficientStockError);

    // Rolled back — batch unchanged, no movement row written.
    const b = db.prepare("SELECT qty_on_hand FROM batches WHERE id='b_f1'").get() as { qty_on_hand: number };
    expect(b.qty_on_hand).toBe(20);
    const mv = db.prepare(
      `SELECT COUNT(*) c FROM stock_movements WHERE batch_id='b_f1' AND movement_type='waste'`,
    ).get() as { c: number };
    expect(mv.c).toBe(0);
  });

  it("stock_movements is append-only — UPDATE is rejected", () => {
    expect(() =>
      db.prepare("UPDATE stock_movements SET qty_delta = 999 WHERE movement_type='opening'").run(),
    ).toThrow(/append-only/);
  });

  it("stock_movements is append-only — DELETE is rejected", () => {
    expect(() =>
      db.prepare("DELETE FROM stock_movements WHERE movement_type='opening'").run(),
    ).toThrow(/append-only/);
  });
});

// -----------------------------------------------------------------------------

describe("batch-repo · bill_lines trigger writes bill movement", () => {
  let db: Database.Database;
  beforeEach(() => { db = fixture(); });

  it("inserting a bill_line decrements qty AND writes a 'bill' stock_movement row", () => {
    db.prepare(`INSERT INTO bills (id,shop_id,bill_no,cashier_id,gst_treatment,
                                   subtotal_paise,total_discount_paise,
                                   total_cgst_paise,total_sgst_paise,total_igst_paise,
                                   total_cess_paise,round_off_paise,grand_total_paise,payment_mode)
                VALUES ('bill_t','shop1','INV-T','u1','intra_state',10000,0,600,600,0,0,0,11200,'cash')`).run();
    db.prepare(`INSERT INTO bill_lines (id,bill_id,product_id,batch_id,qty,mrp_paise,
                                        discount_pct,discount_paise,taxable_value_paise,
                                        gst_rate,cgst_paise,sgst_paise,igst_paise,cess_paise,line_total_paise)
                VALUES ('bl_1','bill_t','p_para','b_f1',3,11200,0,0,30000,12,1800,1800,0,0,33600)`).run();

    const b = db.prepare("SELECT qty_on_hand FROM batches WHERE id='b_f1'").get() as { qty_on_hand: number };
    expect(b.qty_on_hand).toBe(17);  // 20 − 3

    const mv = db.prepare(
      `SELECT qty_delta, movement_type, ref_table, ref_id, actor_id
         FROM stock_movements WHERE batch_id='b_f1' AND movement_type='bill'`,
    ).get() as { qty_delta: number; movement_type: string; ref_table: string; ref_id: string; actor_id: string };
    expect(mv.qty_delta).toBe(-3);
    expect(mv.ref_table).toBe("bills");
    expect(mv.ref_id).toBe("bill_t");
    expect(mv.actor_id).toBe("u1");

    expect(auditLedger(db)).toEqual([]);  // invariant holds
  });

  it("attempting to bill an expired batch is blocked BEFORE any movement row is written", () => {
    db.prepare(`INSERT INTO bills (id,shop_id,bill_no,cashier_id,gst_treatment,
                                   subtotal_paise,total_discount_paise,
                                   total_cgst_paise,total_sgst_paise,total_igst_paise,
                                   total_cess_paise,round_off_paise,grand_total_paise,payment_mode)
                VALUES ('bill_x','shop1','INV-X','u1','intra_state',10000,0,600,600,0,0,0,11200,'cash')`).run();
    expect(() =>
      db.prepare(`INSERT INTO bill_lines (id,bill_id,product_id,batch_id,qty,mrp_paise,
                                          discount_pct,discount_paise,taxable_value_paise,
                                          gst_rate,cgst_paise,sgst_paise,igst_paise,cess_paise,line_total_paise)
                  VALUES ('bl_x','bill_x','p_para','b_x',1,11200,0,0,10000,12,600,600,0,0,11200)`).run(),
    ).toThrow(/expired/i);

    const mv = db.prepare(
      `SELECT COUNT(*) c FROM stock_movements WHERE batch_id='b_x' AND movement_type='bill'`,
    ).get() as { c: number };
    expect(mv.c).toBe(0);
  });
});

// -----------------------------------------------------------------------------

describe("batch-repo · commitAllocations", () => {
  let db: Database.Database;
  beforeEach(() => { db = fixture(); });

  it("applies FEFO allocations atomically as 'bill' movements", () => {
    const a = allocateFefo(db, "p_para" as ProductId, 40);
    commitAllocations(db, a, { table: "bills", id: "bill_manual", actorId: "u1" as UserId });

    const qty = db.prepare(
      "SELECT id, qty_on_hand FROM batches WHERE product_id='p_para' ORDER BY id",
    ).all() as Array<{ id: string; qty_on_hand: number }>;
    expect(qty.find((r) => r.id === "b_f1")!.qty_on_hand).toBe(0);
    expect(qty.find((r) => r.id === "b_f1b")!.qty_on_hand).toBe(0);
    expect(qty.find((r) => r.id === "b_f2")!.qty_on_hand).toBe(95); // 100 − 5

    expect(auditLedger(db)).toEqual([]);
  });
});

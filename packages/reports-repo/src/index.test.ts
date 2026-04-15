import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb, runMigrations } from "@pharmacare/shared-db";
import { dayBook, gstr1Summary, topMovers } from "./index.js";

function seed(db: Database.Database) {
  db.exec(`
    INSERT INTO shops (id, name, gstin, state_code, retail_license, address)
    VALUES ('shop_a', 'A', '27ABCDE1234F1Z5', '27', 'L1', 'Kalyan');
    INSERT INTO users (id, shop_id, name, role, pin_hash)
    VALUES ('u1', 'shop_a', 'Owner', 'owner', 'x');
    INSERT INTO products (id, name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise)
    VALUES ('p_otc', 'OTC-A', 'M', '30049099', 12, 'OTC', 'tablet', 10, 10000),
           ('p_5',   'Low-GST', 'M', '30049099', 5, 'OTC', 'tablet', 10, 5000);

    INSERT INTO suppliers (id, shop_id, name) VALUES ('sup_a', 'shop_a', 'A Supplier');
    INSERT INTO batches (id, product_id, batch_no, mfg_date, expiry_date, qty_on_hand, purchase_price_paise, mrp_paise, supplier_id)
    VALUES ('bx1','p_otc','OTC-B1','2025-01-01','2027-12-31',100,5000,11200,'sup_a'),
           ('bx2','p_5','LOW-B1','2025-01-01','2027-12-31',100,2500,5250,'sup_a'),
           ('bx3','p_otc','OTC-B2','2025-02-01','2027-12-31',50,5000,11200,'sup_a');

    INSERT INTO bills (id, shop_id, bill_no, billed_at, cashier_id, gst_treatment,
                       subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise,
                       grand_total_paise, payment_mode)
    VALUES ('b1','shop_a','B-1','2026-04-14T09:00:00.000Z','u1','intra_state',
             10000, 600, 600, 0, 11200, 'cash'),
           ('b2','shop_a','B-2','2026-04-14T14:30:00.000Z','u1','intra_state',
             5000, 125, 125, 0, 5300, 'upi'),
           ('b3','shop_a','B-3','2026-04-15T10:00:00.000Z','u1','inter_state',
             10000, 0, 0, 1200, 11200, 'card');

    INSERT INTO bill_lines (id, bill_id, product_id, batch_id, qty, mrp_paise,
                            taxable_value_paise, gst_rate, cgst_paise, sgst_paise, igst_paise,
                            line_total_paise)
    VALUES ('l1','b1','p_otc','bx1',1,11200,10000,12,600,600,0,11200),
           ('l2','b2','p_5','bx2',1,5250,5000,5,125,125,0,5300),
           ('l3','b3','p_otc','bx3',1,11200,10000,12,0,0,1200,11200);
  `);
}

function fresh(): Database.Database {
  const db = openDb({ path: ":memory:" });
  runMigrations(db);
  seed(db);
  return db;
}

describe("dayBook", () => {
  let db: Database.Database;
  beforeEach(() => { db = fresh(); });

  it("aggregates all bills for the given day", () => {
    const dm = dayBook(db, "shop_a", "2026-04-14");
    expect(dm.rows).toHaveLength(2);
    expect(dm.summary.billCount).toBe(2);
    expect(dm.summary.grossPaise).toBe(11200 + 5300);
    expect(dm.summary.cgstPaise).toBe(600 + 125);
    expect(dm.summary.byPayment["cash"]).toBe(11200);
    expect(dm.summary.byPayment["upi"]).toBe(5300);
  });

  it("returns empty summary for a day with no bills", () => {
    const dm = dayBook(db, "shop_a", "2026-05-01");
    expect(dm.rows).toHaveLength(0);
    expect(dm.summary.grossPaise).toBe(0);
  });
});

describe("gstr1Summary", () => {
  let db: Database.Database;
  beforeEach(() => { db = fresh(); });

  it("groups by gst_rate across the range", () => {
    const buckets = gstr1Summary(db, "shop_a", "2026-04-14", "2026-04-15");
    expect(buckets).toHaveLength(2);
    const five = buckets.find((b) => b.gstRate === 5)!;
    const twelve = buckets.find((b) => b.gstRate === 12)!;
    expect(five.taxableValuePaise).toBe(5000);
    expect(twelve.taxableValuePaise).toBe(20000);
    expect(twelve.igstPaise).toBe(1200);
    expect(twelve.cgstPaise).toBe(600);
  });
});

describe("topMovers", () => {
  let db: Database.Database;
  beforeEach(() => { db = fresh(); });

  it("ranks by revenue, respects limit", () => {
    const tm = topMovers(db, "shop_a", "2026-04-14", "2026-04-15", 5);
    expect(tm[0]?.productId).toBe("p_otc");
    expect(tm[0]?.revenuePaise).toBe(22400);
    expect(tm[0]?.qtySold).toBe(2);
    expect(tm[1]?.productId).toBe("p_5");
  });
});

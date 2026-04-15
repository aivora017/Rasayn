import { describe, it, expect, beforeEach } from "vitest";
import { openDb, runMigrations, currentVersion } from "./index.js";
import type Database from "better-sqlite3";

function seed(db: Database.Database) {
  db.prepare(`INSERT INTO shops (id,name,gstin,state_code,retail_license,address)
              VALUES ('shop1','Vaidyanath','27ABCDE1234F1Z5','27','MH-KLN-123','Kalyan')`).run();
  db.prepare(`INSERT INTO users (id,shop_id,name,role,pin_hash)
              VALUES ('u1','shop1','Sourav','owner','x')`).run();
  db.prepare(`INSERT INTO suppliers (id,shop_id,name) VALUES ('s1','shop1','Cipla')`).run();
}

describe("shared-db · migrations", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = openDb({ path: ":memory:" });
  });

  it("runs 0001_init cleanly; version = 1", () => {
    const ran = runMigrations(db);
    expect(ran).toBeGreaterThanOrEqual(1);
    expect(currentVersion(db)).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent: second run applies 0 migrations", () => {
    runMigrations(db);
    const ran2 = runMigrations(db);
    expect(ran2).toBe(0);
  });

  it("PRAGMA foreign_keys is ON", () => {
    runMigrations(db);
    const { foreign_keys } = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(foreign_keys).toBe(1);
  });
});

describe("shared-db · X2 Schedule H/H1/X image trigger", () => {
  let db: Database.Database;
  beforeEach(() => { db = openDb({ path: ":memory:" }); runMigrations(db); seed(db); });

  it("blocks Schedule H insert without image_sha256", () => {
    expect(() => db.prepare(`
      INSERT INTO products (id,name,manufacturer,hsn,gst_rate,schedule,pack_form,pack_size,mrp_paise)
      VALUES ('p1','Azithral 500','Alembic','3004',12,'H','tablet',5,11200)
    `).run()).toThrow(/X2 moat/);
  });

  it("allows Schedule H insert with image_sha256", () => {
    db.prepare(`
      INSERT INTO products (id,name,manufacturer,hsn,gst_rate,schedule,pack_form,pack_size,mrp_paise,image_sha256)
      VALUES ('p1','Azithral 500','Alembic','3004',12,'H','tablet',5,11200,'abc123')
    `).run();
    const row: any = db.prepare("SELECT schedule FROM products WHERE id='p1'").get();
    expect(row.schedule).toBe("H");
  });

  it("allows OTC without image", () => {
    db.prepare(`
      INSERT INTO products (id,name,manufacturer,hsn,gst_rate,schedule,pack_form,pack_size,mrp_paise)
      VALUES ('p2','Paracetamol','Cipla','3004',12,'OTC','tablet',10,2400)
    `).run();
    const row: any = db.prepare("SELECT id FROM products WHERE id='p2'").get();
    expect(row.id).toBe("p2");
  });
});

describe("shared-db · expired-batch hard block", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = openDb({ path: ":memory:" });
    runMigrations(db);
    seed(db);
    db.prepare(`INSERT INTO products (id,name,manufacturer,hsn,gst_rate,schedule,pack_form,pack_size,mrp_paise)
                VALUES ('p_otc','Para','Cipla','3004',12,'OTC','tablet',10,2400)`).run();
  });

  it("blocks bill_line insert when batch is expired", () => {
    db.prepare(`INSERT INTO batches (id,product_id,batch_no,mfg_date,expiry_date,qty_on_hand,purchase_price_paise,mrp_paise,supplier_id)
                VALUES ('b_exp','p_otc','BATCH_EXP','2024-01-01','2024-06-30',100,1000,2400,'s1')`).run();
    db.prepare(`INSERT INTO bills (id,shop_id,bill_no,cashier_id,gst_treatment,subtotal_paise,grand_total_paise,payment_mode)
                VALUES ('bill1','shop1','INV-0001','u1','intra_state',10000,11200,'cash')`).run();

    expect(() => db.prepare(`
      INSERT INTO bill_lines (id,bill_id,product_id,batch_id,qty,mrp_paise,taxable_value_paise,gst_rate,line_total_paise)
      VALUES ('bl1','bill1','p_otc','b_exp',1,2400,2143,12,2400)
    `).run()).toThrow(/expired batch/);
  });

  it("allows sale from non-expired batch and decrements stock via trigger", () => {
    db.prepare(`INSERT INTO batches (id,product_id,batch_no,mfg_date,expiry_date,qty_on_hand,purchase_price_paise,mrp_paise,supplier_id)
                VALUES ('b_ok','p_otc','BATCH_OK','2026-01-01','2027-12-31',100,1000,2400,'s1')`).run();
    db.prepare(`INSERT INTO bills (id,shop_id,bill_no,cashier_id,gst_treatment,subtotal_paise,grand_total_paise,payment_mode)
                VALUES ('bill2','shop1','INV-0002','u1','intra_state',10000,11200,'cash')`).run();
    db.prepare(`INSERT INTO bill_lines (id,bill_id,product_id,batch_id,qty,mrp_paise,taxable_value_paise,gst_rate,line_total_paise)
                VALUES ('bl2','bill2','p_otc','b_ok',3,2400,6429,12,7200)`).run();

    const row: any = db.prepare("SELECT qty_on_hand FROM batches WHERE id='b_ok'").get();
    expect(row.qty_on_hand).toBe(97);
  });
});

describe("shared-db · FEFO view", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = openDb({ path: ":memory:" });
    runMigrations(db);
    seed(db);
    db.prepare(`INSERT INTO products (id,name,manufacturer,hsn,gst_rate,schedule,pack_form,pack_size,mrp_paise)
                VALUES ('p_otc','Para','Cipla','3004',12,'OTC','tablet',10,2400)`).run();
    // 3 batches, varying expiry; one expired; one zero-stock
    db.prepare(`INSERT INTO batches (id,product_id,batch_no,mfg_date,expiry_date,qty_on_hand,purchase_price_paise,mrp_paise,supplier_id) VALUES
      ('b_later','p_otc','L','2026-01-01','2028-06-30',50,1000,2400,'s1'),
      ('b_near','p_otc','N','2025-06-01','2027-03-31',30,1000,2400,'s1'),
      ('b_expired','p_otc','E','2024-01-01','2025-01-31',100,1000,2400,'s1'),
      ('b_empty','p_otc','Z','2026-01-01','2027-12-31',0,1000,2400,'s1')
    `).run();
  });

  it("orders by earliest expiry first, excludes expired and empty", () => {
    const rows: any[] = db.prepare("SELECT id FROM v_fefo_batches WHERE product_id='p_otc'").all();
    expect(rows.map((r) => r.id)).toEqual(["b_near", "b_later"]);
  });
});

describe("shared-db · bill round-off CHECK", () => {
  let db: Database.Database;
  beforeEach(() => { db = openDb({ path: ":memory:" }); runMigrations(db); seed(db); });

  it("rejects grand_total not multiple of 100 paise", () => {
    expect(() => db.prepare(`INSERT INTO bills (id,shop_id,bill_no,cashier_id,gst_treatment,subtotal_paise,grand_total_paise,payment_mode)
                             VALUES ('b','shop1','X','u1','intra_state',100,11250,'cash')`).run())
      .toThrow(/CHECK/);
  });

  it("rejects round-off outside ±50 paise", () => {
    expect(() => db.prepare(`INSERT INTO bills (id,shop_id,bill_no,cashier_id,gst_treatment,subtotal_paise,grand_total_paise,round_off_paise,payment_mode)
                             VALUES ('b','shop1','X','u1','intra_state',100,11200,60,'cash')`).run())
      .toThrow(/CHECK/);
  });
});

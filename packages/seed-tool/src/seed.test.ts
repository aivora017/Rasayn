import { describe, it, expect } from "vitest";
import { openDb } from "@pharmacare/shared-db";
import { searchProducts, pickFefoBatch } from "@pharmacare/search-repo";
import { seedInto } from "./seed.js";

describe("seed-tool", () => {
  it("populates an in-memory DB with demo data", () => {
    const db = openDb({ path: ":memory:" });
    const r = seedInto(db);
    expect(r.shops).toBe(1);
    expect(r.products).toBeGreaterThanOrEqual(18);
    expect(r.batches).toBeGreaterThanOrEqual(20);
    db.close();
  });

  it("is idempotent (second run changes nothing)", () => {
    const db = openDb({ path: ":memory:" });
    const a = seedInto(db);
    const b = seedInto(db);
    expect(b.products).toBe(a.products);
    expect(b.batches).toBe(a.batches);
    db.close();
  });

  it("searchProducts finds Azithral via FTS5", () => {
    const db = openDb({ path: ":memory:" });
    seedInto(db);
    const hits = searchProducts(db, "azithral");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.id).toBe("prod_azithral500");
    expect(hits[0]?.schedule).toBe("H");
    db.close();
  });

  it("searchProducts finds by generic (paracetamol)", () => {
    const db = openDb({ path: ":memory:" });
    seedInto(db);
    const hits = searchProducts(db, "paracetamol");
    const ids = hits.map((h) => h.id);
    expect(ids).toContain("prod_crocin500");
    expect(ids).toContain("prod_dolo650");
    db.close();
  });

  it("pickFefoBatch picks earliest-expiry non-expired batch (Crocin A, not B)", () => {
    const db = openDb({ path: ":memory:" });
    seedInto(db);
    const b = pickFefoBatch(db, "prod_crocin500");
    expect(b?.id).toBe("bat_crocin_A");
    expect(b?.expiryDate).toBe("2027-09-30");
    db.close();
  });

  it("FEFO skips expired batch for Dolo650 (bat_expired_dolo ignored)", () => {
    const db = openDb({ path: ":memory:" });
    seedInto(db);
    const b = pickFefoBatch(db, "prod_dolo650");
    expect(b).not.toBeNull();
    expect(b?.id).not.toBe("bat_expired_dolo");
    expect(b?.id).toBe("bat_dolo_A");
    db.close();
  });

  it("DB trigger blocks sale from expired batch", () => {
    const db = openDb({ path: ":memory:" });
    seedInto(db);
    // create a minimum bill to test the bill_lines trigger
    db.prepare(`INSERT INTO bills
      (id, shop_id, bill_no, cashier_id, gst_treatment, subtotal_paise, grand_total_paise, payment_mode)
      VALUES ('bill_test','shop_vaidyanath_kalyan','T-001','user_sourav_owner','intra_state',0,0,'cash')`).run();
    const insLine = db.prepare(`INSERT INTO bill_lines
      (id, bill_id, product_id, batch_id, qty, mrp_paise, taxable_value_paise, gst_rate, line_total_paise)
      VALUES (?, 'bill_test', 'prod_dolo650', 'bat_expired_dolo', 1, 3495, 3120, 12, 3495)`);
    expect(() => insLine.run("line_1")).toThrow(/expired/i);
    db.close();
  });

  it("DB trigger blocks inserting Schedule H product without image", () => {
    const db = openDb({ path: ":memory:" });
    seedInto(db);
    const stmt = db.prepare(`INSERT INTO products
      (id, name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise, image_sha256)
      VALUES ('bad_prod','Evil Rx','X','30049099',12,'H','strip',10,1000,NULL)`);
    expect(() => stmt.run()).toThrow(/X2 moat|image_sha256/i);
    db.close();
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb, runMigrations } from "@pharmacare/shared-db";
import { searchProducts, pickFefoBatch } from "./index.js";

function seed(db: Database.Database) {
  db.prepare(`INSERT INTO shops (id,name,gstin,state_code,retail_license,address)
              VALUES ('s','V','27ABCDE1234F1Z5','27','L','A')`).run();
  db.prepare(`INSERT INTO suppliers (id,shop_id,name) VALUES ('sup','s','X')`).run();
  const ins = db.prepare(`INSERT INTO products (id,name,generic_name,manufacturer,hsn,gst_rate,schedule,pack_form,pack_size,mrp_paise,image_sha256)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const rows: Array<[string,string,string|null,string,string,number,string,string,number,number,string|null]> = [
    ["p1","Crocin 500","Paracetamol","GSK","3004",12,"OTC","tablet",15,11200,null],
    ["p2","Dolo 650","Paracetamol","Micro Labs","3004",12,"OTC","tablet",15,3000,null],
    ["p3","Azithral 500","Azithromycin","Alembic","3004",12,"H","tablet",5,12000,"img_a"],
    ["p4","Pan 40","Pantoprazole","Alkem","3004",12,"H","tablet",15,18000,"img_b"],
    ["p5","Insulin Glargine","Insulin","Sanofi","3004",5,"H1","injection",1,150000,"img_c"],
    ["p6","Augmentin 625","Amoxicillin","GSK","3004",12,"H","tablet",10,22000,"img_d"],
  ];
  for (const r of rows) ins.run(...r);
}

describe("search-repo · FTS5 product search", () => {
  let db: Database.Database;
  beforeEach(() => { db = openDb({ path: ":memory:" }); runMigrations(db); seed(db); });

  it("prefix match by name", () => {
    const hits = searchProducts(db, "croc");
    expect(hits.length).toBe(1);
    expect(hits[0]!.id).toBe("p1");
  });

  it("searches across generic name (molecule)", () => {
    const hits = searchProducts(db, "parace");
    expect(hits.map((h) => h.id).sort()).toEqual(["p1", "p2"]);
  });

  it("searches by manufacturer", () => {
    const hits = searchProducts(db, "gsk");
    expect(hits.map((h) => h.id).sort()).toEqual(["p1", "p6"]);
  });

  it("multi-token AND (all must prefix-match)", () => {
    const hits = searchProducts(db, "pan 40");
    expect(hits.length).toBe(1);
    expect(hits[0]!.id).toBe("p4");
  });

  it("empty query returns empty", () => {
    expect(searchProducts(db, "   ")).toEqual([]);
  });

  it("respects limit", () => {
    const hits = searchProducts(db, "a", 2);
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it("FTS stays in sync on UPDATE", () => {
    db.prepare("UPDATE products SET name = 'Crocin Advance' WHERE id='p1'").run();
    const hits = searchProducts(db, "advance");
    expect(hits.map((h) => h.id)).toEqual(["p1"]);
  });

  it("FTS stays in sync on DELETE", () => {
    db.prepare("DELETE FROM products WHERE id='p2'").run();
    const hits = searchProducts(db, "dolo");
    expect(hits).toEqual([]);
  });

  it("performance: 1000 SKUs < 50ms", () => {
    const ins = db.prepare(`INSERT INTO products (id,name,generic_name,manufacturer,hsn,gst_rate,schedule,pack_form,pack_size,mrp_paise)
                            VALUES (?,?,?,?,'3004',12,'OTC','tablet',10,1000)`);
    const brands = ["Apex","Novo","Sun","Cipla","Lupin","Zydus","Mankind","Torrent","Glenmark","Cadila"];
    const roots  = ["Para","Amox","Azith","Omep","Panto","Ator","Losar","Telmi","Metfor","Levo"];
    db.exec("BEGIN");
    for (let i = 0; i < 1000; i++) {
      ins.run(`bulk_${i}`, `${roots[i % 10]}xyz ${i}`, roots[i%10], brands[i%10]);
    }
    db.exec("COMMIT");
    const t0 = performance.now();
    const hits = searchProducts(db, "para");
    const ms = performance.now() - t0;
    expect(hits.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(50);
  });
});

describe("search-repo · FEFO batch picker", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = openDb({ path: ":memory:" }); runMigrations(db); seed(db);
    db.prepare(`INSERT INTO batches (id,product_id,batch_no,mfg_date,expiry_date,qty_on_hand,purchase_price_paise,mrp_paise,supplier_id)
                VALUES (?,?,?,?,?,?,?,?,?)`).run("b_later","p1","L","2026-01-01","2028-06-30",50,800,11200,"sup");
    db.prepare(`INSERT INTO batches (id,product_id,batch_no,mfg_date,expiry_date,qty_on_hand,purchase_price_paise,mrp_paise,supplier_id)
                VALUES (?,?,?,?,?,?,?,?,?)`).run("b_near","p1","N","2025-06-01","2027-03-31",30,800,11200,"sup");
    db.prepare(`INSERT INTO batches (id,product_id,batch_no,mfg_date,expiry_date,qty_on_hand,purchase_price_paise,mrp_paise,supplier_id)
                VALUES (?,?,?,?,?,?,?,?,?)`).run("b_expired","p1","E","2024-01-01","2025-01-31",100,800,11200,"sup");
  });

  it("picks nearest non-expired batch", () => {
    expect(pickFefoBatch(db, "p1")?.id).toBe("b_near");
  });

  it("returns null if no stock", () => {
    expect(pickFefoBatch(db, "p2")).toBeNull();
  });

  it("skips batch after it becomes empty", () => {
    db.prepare("UPDATE batches SET qty_on_hand = 0 WHERE id='b_near'").run();
    expect(pickFefoBatch(db, "p1")?.id).toBe("b_later");
  });
});

import { listStock } from "./index.js";

describe("search-repo · listStock inventory snapshot", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = openDb({ path: ":memory:" }); runMigrations(db); seed(db);
    const ins = db.prepare(`INSERT INTO batches (id,product_id,batch_no,mfg_date,expiry_date,qty_on_hand,purchase_price_paise,mrp_paise,supplier_id)
                            VALUES (?,?,?,?,?,?,?,?,?)`);
    // p1 Crocin: 2 live batches (30+50=80), nearest expiry 2027-03-31
    ins.run("p1_a","p1","CA","2025-06-01","2027-03-31",30,800,11200,"sup");
    ins.run("p1_b","p1","CB","2026-01-01","2028-06-30",50,800,11200,"sup");
    // p1 also an expired batch sitting on shelf (should not count in total, but hasExpiredStock>0)
    ins.run("p1_x","p1","CX","2024-01-01","2025-06-30",20,800,11200,"sup");
    // p2 Dolo: zero stock (no batches)
    // p3 Azithral: 1 batch, near-expiry in ~60 days from today=2026-04-15 -> 2026-06-14
    ins.run("p3_a","p3","AZ","2026-01-01","2026-06-14",40,900,12000,"sup");
    // p4 Pan40: healthy stock far out
    ins.run("p4_a","p4","PA","2026-01-01","2028-12-31",120,1400,18000,"sup");
  });

  it("aggregates live batches; excludes expired from totals but flags them", () => {
    const rows = listStock(db);
    const crocin = rows.find((r) => r.productId === "p1")!;
    expect(crocin.totalQty).toBe(80);
    expect(crocin.batchCount).toBe(2);
    expect(crocin.nearestExpiry).toBe("2027-03-31");
    expect(crocin.hasExpiredStock).toBe(20);
  });

  it("reports zero stock for products with no batches", () => {
    const rows = listStock(db);
    const dolo = rows.find((r) => r.productId === "p2")!;
    expect(dolo.totalQty).toBe(0);
    expect(dolo.batchCount).toBe(0);
    expect(dolo.nearestExpiry).toBeNull();
    expect(dolo.daysToExpiry).toBeNull();
  });

  it("sorts out-of-stock first, then soonest-expiry", () => {
    const rows = listStock(db);
    // Dolo (p2) and Insulin (p5) and Augmentin (p6) are out-of-stock -> come first
    const outOfStock = rows.filter((r) => r.totalQty === 0).map((r) => r.productId);
    expect(outOfStock).toEqual(expect.arrayContaining(["p2", "p5", "p6"]));
    const inStock = rows.filter((r) => r.totalQty > 0);
    // First in-stock row is the one with the soonest expiry (Azithral p3)
    expect(inStock[0]!.productId).toBe("p3");
  });

  it("near-expiry filter returns only soon-to-expire rows", () => {
    const rows = listStock(db, { nearExpiryDays: 90 });
    const ids = rows.map((r) => r.productId);
    expect(ids).toContain("p3");       // Azithral expires in ~60 days
    expect(ids).not.toContain("p1");   // Crocin's nearest is ~2027-03-31
    expect(ids).not.toContain("p2");   // no live stock, excluded by filter
  });

  it("low-stock filter", () => {
    const rows = listStock(db, { lowStockUnder: 0 });
    // everything with totalQty <= 0 -> the out-of-stock products
    expect(rows.every((r) => r.totalQty === 0)).toBe(true);
  });

  it("text filter (LIKE) on name/generic", () => {
    const rows = listStock(db, { q: "crocin" });
    expect(rows.map((r) => r.productId)).toEqual(["p1"]);
    const rows2 = listStock(db, { q: "paracetamol" });
    expect(rows2.map((r) => r.productId).sort()).toEqual(["p1", "p2"]);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb, runMigrations } from "@pharmacare/shared-db";
import { rupeesToPaise, type Paise } from "@pharmacare/shared-types";
import { saveBill, readBill } from "./index.js";

function fixture(): Database.Database {
  const db = openDb({ path: ":memory:" });
  runMigrations(db);
  db.prepare(`INSERT INTO shops (id,name,gstin,state_code,retail_license,address)
              VALUES ('shop1','Vaidyanath','27ABCDE1234F1Z5','27','MH-KLN-123','Kalyan')`).run();
  db.prepare(`INSERT INTO users (id,shop_id,name,role,pin_hash) VALUES ('u1','shop1','Sourav','owner','x')`).run();
  db.prepare(`INSERT INTO suppliers (id,shop_id,name) VALUES ('sup1','shop1','Cipla')`).run();
  db.prepare(`INSERT INTO products (id,name,manufacturer,hsn,gst_rate,schedule,pack_form,pack_size,mrp_paise)
              VALUES ('p_para','Crocin 500','GSK','3004',12,'OTC','tablet',15,11200)`).run();
  db.prepare(`INSERT INTO batches (id,product_id,batch_no,mfg_date,expiry_date,qty_on_hand,purchase_price_paise,mrp_paise,supplier_id)
              VALUES ('b1','p_para','B1','2025-01-01','2027-12-31',200,800,11200,'sup1')`).run();
  return db;
}

describe("bill-repo · saveBill", () => {
  let db: Database.Database;
  beforeEach(() => { db = fixture(); });

  it("saves a 1-line intra-state bill, tax split matches engine, stock decrements via trigger", () => {
    const r = saveBill(db, "bill_001", {
      shopId: "shop1", billNo: "INV-0001", cashierId: "u1",
      customerId: null, doctorId: null, rxId: null,
      paymentMode: "cash", customerStateCode: null,
      lines: [{ productId: "p_para", batchId: "b1", mrpPaise: rupeesToPaise(112) as Paise, qty: 1, gstRate: 12 }],
    });
    expect(r.linesInserted).toBe(1);
    expect(r.grandTotalPaise).toBe(11200);

    const bill = readBill(db, "bill_001")!;
    expect(bill.gst_treatment).toBe("intra_state");
    expect(bill.subtotal_paise).toBe(10000);
    expect(bill.total_cgst_paise).toBe(600);
    expect(bill.total_sgst_paise).toBe(600);
    expect(bill.total_igst_paise).toBe(0);
    expect(bill.grand_total_paise % 100).toBe(0);

    const stock: any = db.prepare("SELECT qty_on_hand FROM batches WHERE id='b1'").get();
    expect(stock.qty_on_hand).toBe(199);
  });

  it("inter-state when customer state differs: IGST only", () => {
    db.prepare(`INSERT INTO customers (id,shop_id,name) VALUES ('c1','shop1','Ravi')`).run();
    const r = saveBill(db, "bill_002", {
      shopId: "shop1", billNo: "INV-0002", cashierId: "u1",
      customerId: "c1", doctorId: null, rxId: null,
      paymentMode: "upi", customerStateCode: "29",  // Karnataka
      lines: [{ productId: "p_para", batchId: "b1", mrpPaise: rupeesToPaise(112) as Paise, qty: 2, gstRate: 12 }],
    });
    const bill = readBill(db, "bill_002")!;
    expect(bill.gst_treatment).toBe("inter_state");
    expect(bill.total_igst_paise).toBeGreaterThan(0);
    expect(bill.total_cgst_paise).toBe(0);
    expect(bill.total_sgst_paise).toBe(0);
    expect(r.grandTotalPaise).toBe(22400);
  });

  it("rolls back entire transaction if any line triggers expired-batch block", () => {
    db.prepare(`INSERT INTO batches (id,product_id,batch_no,mfg_date,expiry_date,qty_on_hand,purchase_price_paise,mrp_paise,supplier_id)
                VALUES ('b_exp','p_para','EXP','2023-01-01','2024-06-30',50,800,11200,'sup1')`).run();

    expect(() => saveBill(db, "bill_003", {
      shopId: "shop1", billNo: "INV-0003", cashierId: "u1",
      customerId: null, doctorId: null, rxId: null,
      paymentMode: "cash", customerStateCode: null,
      lines: [
        { productId: "p_para", batchId: "b1",    mrpPaise: rupeesToPaise(112) as Paise, qty: 1, gstRate: 12 },
        { productId: "p_para", batchId: "b_exp", mrpPaise: rupeesToPaise(112) as Paise, qty: 1, gstRate: 12 }, // BOOM
      ],
    })).toThrow(/expired batch/);

    expect(readBill(db, "bill_003")).toBeUndefined();
    const stock: any = db.prepare("SELECT qty_on_hand FROM batches WHERE id='b1'").get();
    expect(stock.qty_on_hand).toBe(200); // unchanged \u2014 rollback worked
    const audits: any[] = db.prepare("SELECT * FROM audit_log WHERE entity_id='bill_003'").all();
    expect(audits.length).toBe(0);
  });

  it("writes audit_log on success", () => {
    saveBill(db, "bill_004", {
      shopId: "shop1", billNo: "INV-0004", cashierId: "u1",
      customerId: null, doctorId: null, rxId: null,
      paymentMode: "cash", customerStateCode: null,
      lines: [{ productId: "p_para", batchId: "b1", mrpPaise: rupeesToPaise(112) as Paise, qty: 1, gstRate: 12 }],
    });
    const audits: any[] = db.prepare("SELECT * FROM audit_log WHERE entity_id='bill_004'").all();
    expect(audits.length).toBe(1);
    expect(audits[0].action).toBe("create");
    expect(audits[0].actor_id).toBe("u1");
  });

  it("3-line bill: line tax splits sum to invoice totals (invariant)", () => {
    db.prepare(`INSERT INTO products (id,name,manufacturer,hsn,gst_rate,schedule,pack_form,pack_size,mrp_paise)
                VALUES ('p_b','B','X','3004',18,'OTC','bottle',1,21000)`).run();
    db.prepare(`INSERT INTO batches (id,product_id,batch_no,mfg_date,expiry_date,qty_on_hand,purchase_price_paise,mrp_paise,supplier_id)
                VALUES ('b_b','p_b','BB','2025-01-01','2027-12-31',50,15000,21000,'sup1')`).run();

    saveBill(db, "bill_005", {
      shopId: "shop1", billNo: "INV-0005", cashierId: "u1",
      customerId: null, doctorId: null, rxId: null,
      paymentMode: "cash", customerStateCode: null,
      lines: [
        { productId: "p_para", batchId: "b1",  mrpPaise: rupeesToPaise(112) as Paise, qty: 3, gstRate: 12 },
        { productId: "p_b",    batchId: "b_b", mrpPaise: rupeesToPaise(210) as Paise, qty: 1, gstRate: 18, discountPct: 5 },
      ],
    });
    const bill = readBill(db, "bill_005")!;
    const lineSum: any = db.prepare(`
      SELECT SUM(cgst_paise) cg, SUM(sgst_paise) sg, SUM(taxable_value_paise) tax
      FROM bill_lines WHERE bill_id='bill_005'
    `).get();
    expect(lineSum.cg).toBe(bill.total_cgst_paise);
    expect(lineSum.sg).toBe(bill.total_sgst_paise);
    expect(lineSum.tax).toBe(bill.subtotal_paise);
  });
});

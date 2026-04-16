import { describe, it, expect } from "vitest";
import type Database from "better-sqlite3";
import { openDb, runMigrations } from "@pharmacare/shared-db";
import {
  upsertCustomer, searchCustomers, lookupCustomerByPhone,
  ensureWalkInCustomer, getWalkInCustomer, walkInIdForShop,
  upsertDoctor, searchDoctors,
  createPrescription, listPrescriptions,
  normalizePhone, validateDoctorRegNo,
} from "./index.js";

function fresh(): Database.Database {
  const db = openDb({ path: ":memory:" });
  runMigrations(db);
  db.exec(`INSERT INTO shops (id,name,gstin,state_code,retail_license,address)
           VALUES ('shop_a','A','27ABCDE1234F1Z5','27','L1','Kalyan');`);
  db.exec(`INSERT INTO shops (id,name,gstin,state_code,retail_license,address)
           VALUES ('shop_b','B','27ABCDE1234F2Z4','27','L2','Thane');`);
  return db;
}

// ---- phone normaliser ------------------------------------------------------

describe("normalizePhone", () => {
  it("strips non-digits and takes last 10", () => {
    expect(normalizePhone("+91 98220-01122")).toBe("9822001122");
    expect(normalizePhone("(98220) 01.122")).toBe("9822001122");
    expect(normalizePhone("91-9822001122")).toBe("9822001122");
    expect(normalizePhone("9822001122")).toBe("9822001122");
  });
  it("returns null for too-short or empty input", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
  });
  it("matches SQL trigger for a range of user inputs", () => {
    const db = fresh();
    const samples = [
      "+91 98220-01122",
      "(98220) 01.122",
      "91 9822001122",
      "9822001122",
    ];
    for (const [i, s] of samples.entries()) {
      upsertCustomer(db, { id: `c_${i}`, shopId: "shop_a", name: `N${i}`, phone: s });
      const row = db.prepare("SELECT phone_norm FROM customers WHERE id=?").get(`c_${i}`) as any;
      expect(row.phone_norm).toBe(normalizePhone(s));
    }
  });
});

// ---- doctor reg-no validator ----------------------------------------------

describe("validateDoctorRegNo", () => {
  it("accepts common India formats", () => {
    for (const r of ["MH12345", "MCI-12345", "NMC/2024/98765", "12345", "KMC-2020-001"]) {
      expect(validateDoctorRegNo(r)).toBeNull();
    }
  });
  it("rejects empty / too short", () => {
    expect(validateDoctorRegNo("")).toMatch(/required/);
    expect(validateDoctorRegNo("  ")).toMatch(/required/);
    expect(validateDoctorRegNo("ab")).toMatch(/at least 3/);
  });
  it("rejects no-digit", () => {
    expect(validateDoctorRegNo("ABCDEF")).toMatch(/at least one digit/);
  });
  it("rejects disallowed chars", () => {
    expect(validateDoctorRegNo("MH@12345")).toMatch(/may contain only/);
    expect(validateDoctorRegNo("MH 12345$")).toMatch(/may contain only/);
  });
  it("rejects overly long", () => {
    expect(validateDoctorRegNo("X".repeat(41) + "1")).toMatch(/at most 40/);
  });
});

// ---- walk-in default -------------------------------------------------------

describe("walk-in customer", () => {
  it("deterministic id pattern", () => {
    expect(walkInIdForShop("shop_a")).toBe("cus_walkin_shop_a");
  });
  it("idempotent ensure + get", () => {
    const db = fresh();
    const id1 = ensureWalkInCustomer(db, "shop_a");
    const id2 = ensureWalkInCustomer(db, "shop_a");
    expect(id1).toBe(id2);
    const w = getWalkInCustomer(db, "shop_a");
    expect(w.id).toBe(id1);
    expect(w.isWalkIn).toBe(true);
    expect(w.name).toBe("Walk-in Customer");
    expect(w.phone).toBeNull();
    // second shop isolated
    const id3 = ensureWalkInCustomer(db, "shop_b");
    expect(id3).not.toBe(id1);
    expect(id3).toBe("cus_walkin_shop_b");
  });
  it("regular customer not flagged as walk-in", () => {
    const db = fresh();
    const cid = upsertCustomer(db, { shopId: "shop_a", name: "R" });
    const r = searchCustomers(db, "shop_a", "R", 5);
    expect(r[0]?.isWalkIn).toBe(false);
    expect(cid).not.toMatch(/^cus_walkin_/);
  });
  it("bill FK accepts walk-in id (no foreign-key breakage)", () => {
    const db = fresh();
    const wid = ensureWalkInCustomer(db, "shop_a");
    // seed user + product to satisfy FKs on bills / bill_lines
    db.exec(`INSERT INTO users (id, shop_id, name, role, pin_hash) VALUES ('u1','shop_a','Cashier','cashier','x');`);
    const ok = db.prepare(`
      INSERT INTO bills (id, shop_id, bill_no, customer_id, cashier_id, gst_treatment,
                         subtotal_paise, grand_total_paise, payment_mode)
      VALUES (?, 'shop_a','B-001',?,'u1','intra_state',0,0,'cash')
    `).run("b_walkin_1", wid);
    expect(ok.changes).toBe(1);
  });
});

// ---- customers -------------------------------------------------------------

describe("customers", () => {
  it("insert → search by name/phone/gstin", () => {
    const db = fresh();
    const id = upsertCustomer(db, { shopId: "shop_a", name: "Rohan Desai", phone: "+919822001122" });
    expect(id).toMatch(/^cus_/);
    expect(searchCustomers(db, "shop_a", "rohan", 5)).toHaveLength(1);
    expect(searchCustomers(db, "shop_a", "98220", 5)).toHaveLength(1);
    expect(searchCustomers(db, "shop_a", "xyz", 5)).toHaveLength(0);
  });
  it("update via id preserves phone_norm consistency", () => {
    const db = fresh();
    const id = upsertCustomer(db, { shopId: "shop_a", name: "A" });
    upsertCustomer(db, { id, shopId: "shop_a", name: "A Updated", phone: "+91 1112223334" });
    const row = db.prepare("SELECT phone, phone_norm FROM customers WHERE id=?").get(id) as any;
    expect(row.phone_norm).toBe("1112223334");
  });
  it("rejects empty name", () => {
    expect(() => upsertCustomer(fresh(), { shopId: "shop_a", name: "  " })).toThrow(/name required/);
  });
  it("consent fields persisted with timestamp", () => {
    const db = fresh();
    const id = upsertCustomer(db, {
      shopId: "shop_a", name: "Abdm User", consentAbdm: true, consentMethod: "otp",
    });
    const row = db.prepare("SELECT consent_abdm, consent_captured_at, consent_method FROM customers WHERE id=?").get(id) as any;
    expect(row.consent_abdm).toBe(1);
    expect(row.consent_method).toBe("otp");
    expect(row.consent_captured_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

// ---- phone lookup (A3 hot path) -------------------------------------------

describe("lookupCustomerByPhone", () => {
  it("finds exact match via normalized phone", () => {
    const db = fresh();
    upsertCustomer(db, { shopId: "shop_a", name: "Raju", phone: "+91 98220-01122" });
    const hit = lookupCustomerByPhone(db, "shop_a", "9822001122");
    expect(hit?.name).toBe("Raju");
    expect(hit?.phoneNorm).toBe("9822001122");
  });
  it("normalises query input (various user-typed formats)", () => {
    const db = fresh();
    upsertCustomer(db, { shopId: "shop_a", name: "Raju", phone: "9822001122" });
    for (const q of ["+919822001122", "91-9822001122", "(98220) 01122", "98220 01122"]) {
      expect(lookupCustomerByPhone(db, "shop_a", q)?.name).toBe("Raju");
    }
  });
  it("returns null for no match or invalid input", () => {
    const db = fresh();
    upsertCustomer(db, { shopId: "shop_a", name: "Raju", phone: "9822001122" });
    expect(lookupCustomerByPhone(db, "shop_a", "0000000000")).toBeNull();
    expect(lookupCustomerByPhone(db, "shop_a", "abc")).toBeNull();
    expect(lookupCustomerByPhone(db, "shop_a", "")).toBeNull();
  });
  it("shop-isolated — same phone in another shop does not leak", () => {
    const db = fresh();
    upsertCustomer(db, { shopId: "shop_a", name: "A-Raju", phone: "9822001122" });
    upsertCustomer(db, { shopId: "shop_b", name: "B-Other", phone: "9822001122" });
    const a = lookupCustomerByPhone(db, "shop_a", "9822001122");
    const b = lookupCustomerByPhone(db, "shop_b", "9822001122");
    expect(a?.name).toBe("A-Raju");
    expect(b?.name).toBe("B-Other");
  });
  it("uses idx_customers_phone_norm (EXPLAIN QUERY PLAN)", () => {
    const db = fresh();
    const plan = db.prepare(
      "EXPLAIN QUERY PLAN SELECT * FROM customers WHERE shop_id=? AND phone_norm=? LIMIT 1"
    ).all("shop_a", "9822001122") as any[];
    const used = plan.some((r) => String(r.detail ?? "").includes("idx_customers_phone_norm"));
    expect(used).toBe(true);
  });
});

// ---- doctors ---------------------------------------------------------------

describe("doctors", () => {
  it("insert → search by reg_no and name", () => {
    const db = fresh();
    upsertDoctor(db, { regNo: "MH12345", name: "Dr. Patel" });
    expect(searchDoctors(db, "mh12", 5)).toHaveLength(1);
    expect(searchDoctors(db, "patel", 5)[0]?.regNo).toBe("MH12345");
  });
  it("requires valid regNo", () => {
    expect(() => upsertDoctor(fresh(), { regNo: "", name: "X" })).toThrow(/required/);
    expect(() => upsertDoctor(fresh(), { regNo: "ABCDEF", name: "X" })).toThrow(/digit/);
    expect(() => upsertDoctor(fresh(), { regNo: "MH@12345", name: "X" })).toThrow(/may contain only/);
  });
});

// ---- prescriptions ---------------------------------------------------------

describe("prescriptions", () => {
  it("create and list per customer, newest first", () => {
    const db = fresh();
    const cid = upsertCustomer(db, { shopId: "shop_a", name: "Pt" });
    const did = upsertDoctor(db, { regNo: "MH1/2024/001", name: "Dr" });
    createPrescription(db, { shopId: "shop_a", customerId: cid, doctorId: did, kind: "paper", issuedDate: "2026-04-10" });
    createPrescription(db, { shopId: "shop_a", customerId: cid, doctorId: did, kind: "paper", issuedDate: "2026-04-14" });
    const rx = listPrescriptions(db, cid);
    expect(rx).toHaveLength(2);
    expect(rx[0]?.issuedDate).toBe("2026-04-14");
  });
  it("rejects bad date format", () => {
    const db = fresh();
    const cid = upsertCustomer(db, { shopId: "shop_a", name: "Pt" });
    expect(() => createPrescription(db, { shopId: "shop_a", customerId: cid, kind: "paper", issuedDate: "10-04-2026" }))
      .toThrow(/YYYY-MM-DD/);
  });
});

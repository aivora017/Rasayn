import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb, runMigrations } from "@pharmacare/shared-db";
import {
  upsertCustomer, searchCustomers,
  upsertDoctor, searchDoctors,
  createPrescription, listPrescriptions,
} from "./index.js";

function fresh(): Database.Database {
  const db = openDb({ path: ":memory:" });
  runMigrations(db);
  db.exec(`INSERT INTO shops (id,name,gstin,state_code,retail_license,address)
           VALUES ('shop_a','A','27ABCDE1234F1Z5','27','L1','Kalyan');`);
  return db;
}

describe("customers", () => {
  it("insert → search by name/phone/gstin", () => {
    const db = fresh();
    const id = upsertCustomer(db, { shopId: "shop_a", name: "Rohan Desai", phone: "+919822001122" });
    expect(id).toMatch(/^cus_/);
    expect(searchCustomers(db, "shop_a", "rohan", 5)).toHaveLength(1);
    expect(searchCustomers(db, "shop_a", "98220", 5)).toHaveLength(1);
    expect(searchCustomers(db, "shop_a", "xyz", 5)).toHaveLength(0);
  });
  it("update via id", () => {
    const db = fresh();
    const id = upsertCustomer(db, { shopId: "shop_a", name: "A" });
    upsertCustomer(db, { id, shopId: "shop_a", name: "A Updated", phone: "123" });
    const rows = searchCustomers(db, "shop_a", "updated", 5);
    expect(rows[0]?.phone).toBe("123");
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

describe("doctors", () => {
  it("insert → search by reg_no and name", () => {
    const db = fresh();
    upsertDoctor(db, { regNo: "MH12345", name: "Dr. Patel" });
    expect(searchDoctors(db, "mh12", 5)).toHaveLength(1);
    expect(searchDoctors(db, "patel", 5)[0]?.regNo).toBe("MH12345");
  });
  it("requires regNo", () => {
    expect(() => upsertDoctor(fresh(), { regNo: "", name: "X" })).toThrow(/regNo required/);
  });
});

describe("prescriptions", () => {
  it("create and list per customer, newest first", () => {
    const db = fresh();
    const cid = upsertCustomer(db, { shopId: "shop_a", name: "Pt" });
    const did = upsertDoctor(db, { regNo: "MH1", name: "Dr" });
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

import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb, runMigrations } from "@pharmacare/shared-db";
import {
  upsertSupplierTemplate, listSupplierTemplates, getSupplierTemplate,
  deleteSupplierTemplate, markTemplateTested,
} from "./repo.js";

function seed(db: Database.Database) {
  db.exec(`
    INSERT INTO shops (id, name, gstin, state_code, retail_license, address)
    VALUES ('shop_test','Test','27ABCDE1234F1Z5','27','MH/KDMC/RX/20','Kalyan');
    INSERT INTO suppliers (id, shop_id, name, gstin)
    VALUES ('sup_gsk','shop_test','GSK','27AAACG1570E1ZZ');
  `);
}

function fresh(): Database.Database {
  const db = openDb({ path: ":memory:" });
  runMigrations(db);
  seed(db);
  return db;
}

describe("supplier_templates repo", () => {
  let db: Database.Database;
  beforeEach(() => { db = fresh(); });

  const sample = {
    shopId: "shop_test",
    supplierId: "sup_gsk",
    name: "GSK v1",
    headerPatterns: { invoiceNo: "Inv\\s*(\\S+)", invoiceDate: "Date\\s*(\\S+)", total: "Total\\s*(\\S+)" },
    linePatterns: { row: "^(\\w+)\\s+(\\d+)$" },
    columnMap: { product: 0, qty: 1 },
    dateFormat: "DD/MM/YYYY" as const,
  };

  it("insert + get roundtrip", () => {
    const id = upsertSupplierTemplate(db, sample);
    const got = getSupplierTemplate(db, id);
    expect(got?.name).toBe("GSK v1");
    expect(got?.columnMap.product).toBe(0);
  });

  it("list returns templates for the shop, filtered by supplier", () => {
    upsertSupplierTemplate(db, sample);
    upsertSupplierTemplate(db, { ...sample, name: "GSK v2" });
    const all = listSupplierTemplates(db, "shop_test");
    expect(all).toHaveLength(2);
    const scoped = listSupplierTemplates(db, "shop_test", "sup_gsk");
    expect(scoped).toHaveLength(2);
  });

  it("upsert with id overwrites existing", () => {
    const id = upsertSupplierTemplate(db, sample);
    upsertSupplierTemplate(db, { ...sample, id, name: "GSK v1 edited" });
    const got = getSupplierTemplate(db, id);
    expect(got?.name).toBe("GSK v1 edited");
  });

  it("delete removes row", () => {
    const id = upsertSupplierTemplate(db, sample);
    deleteSupplierTemplate(db, id);
    expect(getSupplierTemplate(db, id)).toBeNull();
  });

  it("markTemplateTested updates last_test_ok", () => {
    const id = upsertSupplierTemplate(db, sample);
    markTemplateTested(db, id, true);
    const r = db.prepare("SELECT last_test_ok FROM supplier_templates WHERE id=?").get(id) as any;
    expect(r.last_test_ok).toBe(1);
  });

  it("UNIQUE(supplier_id,name) prevents duplicate names per supplier", () => {
    upsertSupplierTemplate(db, sample);
    expect(() => upsertSupplierTemplate(db, sample)).toThrow();
  });
});

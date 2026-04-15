// Idempotent seeder. Opens (or creates) a SQLite DB, runs migrations,
// then inserts demo master data. Safe to re-run (INSERT OR IGNORE).

import type Database from "better-sqlite3";
import { openDb, runMigrations } from "@pharmacare/shared-db";
import { SHOP, USERS, SUPPLIERS, CUSTOMERS, DOCTORS, PRODUCTS, BATCHES } from "./data.js";

export interface SeedResult {
  readonly path: string;
  readonly migrationsRan: number;
  readonly shops: number;
  readonly users: number;
  readonly suppliers: number;
  readonly customers: number;
  readonly doctors: number;
  readonly products: number;
  readonly batches: number;
}

// Insecure stub hash — demo only. Real PINs use argon2 via crypto package.
function pinStub(pin: string): string {
  return `stub$${pin}$${pin.length}`;
}

export function seedInto(db: Database.Database): Omit<SeedResult, "path"> {
  const migrationsRan = runMigrations(db);

  db.exec("BEGIN");
  try {
    const insShop = db.prepare(
      `INSERT OR IGNORE INTO shops (id, name, gstin, state_code, retail_license, address)
       VALUES (@id, @name, @gstin, @stateCode, @retailLicense, @address)`,
    );
    insShop.run(SHOP);

    const insUser = db.prepare(
      `INSERT OR IGNORE INTO users (id, shop_id, name, role, pin_hash)
       VALUES (@id, @shopId, @name, @role, @pinHash)`,
    );
    for (const u of USERS) insUser.run({ ...u, pinHash: pinStub(u.pin) });

    const insSupplier = db.prepare(
      `INSERT OR IGNORE INTO suppliers (id, shop_id, name, gstin, phone)
       VALUES (@id, @shopId, @name, @gstin, @phone)`,
    );
    for (const s of SUPPLIERS) insSupplier.run(s);

    const insCustomer = db.prepare(
      `INSERT OR IGNORE INTO customers (id, shop_id, name, phone)
       VALUES (@id, @shopId, @name, @phone)`,
    );
    for (const c of CUSTOMERS) insCustomer.run(c);

    const insDoctor = db.prepare(
      `INSERT OR IGNORE INTO doctors (id, reg_no, name) VALUES (@id, @regNo, @name)`,
    );
    for (const d of DOCTORS) insDoctor.run(d);

    const insProduct = db.prepare(
      `INSERT OR IGNORE INTO products
       (id, name, generic_name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise, image_sha256)
       VALUES (@id, @name, @generic, @manufacturer, @hsn, @gst, @schedule, @packForm, @packSize, @mrpPaise, @imageSha)`,
    );
    for (const p of PRODUCTS) insProduct.run(p);

    const insBatch = db.prepare(
      `INSERT OR IGNORE INTO batches
       (id, product_id, batch_no, mfg_date, expiry_date, qty_on_hand, purchase_price_paise, mrp_paise, supplier_id)
       VALUES (@id, @productId, @batchNo, @mfg, @expiry, @qty, @costPaise, @mrpPaise, @supplierId)`,
    );
    for (const b of BATCHES) insBatch.run(b);

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  const count = (sql: string): number => (db.prepare(sql).get() as { c: number }).c;
  return {
    migrationsRan,
    shops: count("SELECT COUNT(*) AS c FROM shops"),
    users: count("SELECT COUNT(*) AS c FROM users"),
    suppliers: count("SELECT COUNT(*) AS c FROM suppliers"),
    customers: count("SELECT COUNT(*) AS c FROM customers"),
    doctors: count("SELECT COUNT(*) AS c FROM doctors"),
    products: count("SELECT COUNT(*) AS c FROM products"),
    batches: count("SELECT COUNT(*) AS c FROM batches"),
  };
}

export function seedFile(path: string): SeedResult {
  const db = openDb({ path });
  try {
    const r = seedInto(db);
    return { path, ...r };
  } finally {
    db.close();
  }
}

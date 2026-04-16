// @pharmacare/directory-repo — customers, doctors, prescriptions.
//
// A3 additions (ADR 0006):
//   - normalizePhone(), validateDoctorRegNo() — shared with the bill
//     screen's F2 (customer pick) + F7 (Rx capture) flows.
//   - ensureWalkInCustomer() / getWalkInCustomer() — deterministic default
//     so bill_lines.customer_id is never NULL.
//   - lookupCustomerByPhone() — equality lookup via idx_customers_phone_norm,
//     p95 <10 ms on 10k rows (verified by src/perf.test.ts).

import type Database from "better-sqlite3";

// ---- Types -----------------------------------------------------------------

export interface Customer {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly phoneNorm: string | null;
  readonly gstin: string | null;
  readonly gender: "M" | "F" | "O" | null;
  readonly consentAbdm: number;
  readonly consentMarketing: number;
  readonly isWalkIn: boolean;
}

export interface Doctor {
  readonly id: string;
  readonly regNo: string;
  readonly name: string;
  readonly phone: string | null;
}

export interface Prescription {
  readonly id: string;
  readonly customerId: string;
  readonly doctorId: string | null;
  readonly kind: "paper" | "digital" | "abdm";
  readonly imagePath: string | null;
  readonly issuedDate: string;
  readonly notes: string | null;
}

// ---- Helpers ---------------------------------------------------------------

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Canonical India phone form = last 10 digits after stripping every
 * non-digit. Matches migration 0009's SQL trigger byte-for-byte so that
 * the app-layer write and any raw SQL writer converge on the same value.
 *
 * Returns null if fewer than 10 digits survive the strip — those get
 * stored but can't be used for fast lookup.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (phone == null) return null;
  const digits = phone.replace(/\D+/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/**
 * India medical registration number — NMC, MCI legacy, and state council
 * formats are all permitted. The real authority is the NMC online registry;
 * this validator catches obvious garbage (too short, bad chars, no digits).
 *
 * Rules:
 *   - 3–40 chars after trim
 *   - ASCII letters, digits, '/', '-', '.', ' ' only
 *   - must contain at least one digit (every reg format does)
 *   - first and last char must be alphanumeric
 *
 * Returns null if valid, else a user-facing error string.
 */
export function validateDoctorRegNo(regNo: string): string | null {
  const t = regNo.trim();
  if (!t) return "doctor regNo is required";
  if (t.length < 3) return "doctor regNo must be at least 3 characters";
  if (t.length > 40) return "doctor regNo must be at most 40 characters";
  if (!/^[A-Za-z0-9][A-Za-z0-9/\-. ]*[A-Za-z0-9]$/.test(t)) {
    return "doctor regNo may contain only letters, digits, '/', '-', '.', spaces";
  }
  if (!/\d/.test(t)) return "doctor regNo must contain at least one digit";
  return null;
}

function rowToCustomer(r: any): Customer {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    phoneNorm: r.phone_norm,
    gstin: r.gstin,
    gender: r.gender,
    consentAbdm: r.consent_abdm,
    consentMarketing: r.consent_marketing,
    isWalkIn: typeof r.id === "string" && r.id.startsWith("cus_walkin_"),
  };
}

// ---- Walk-in customer ------------------------------------------------------

const WALKIN_NAME = "Walk-in Customer";

export function walkInIdForShop(shopId: string): string {
  return `cus_walkin_${shopId}`;
}

/**
 * Idempotently create the walk-in default row for this shop. Safe to call
 * on every bill creation, on app startup, on seed. Returns the id.
 */
export function ensureWalkInCustomer(db: Database.Database, shopId: string): string {
  if (!shopId) throw new Error("shopId required");
  const id = walkInIdForShop(shopId);
  db.prepare(`
    INSERT INTO customers (id, shop_id, name, phone, consent_marketing, consent_abdm)
    VALUES (?, ?, ?, NULL, 0, 0)
    ON CONFLICT(id) DO NOTHING
  `).run(id, shopId, WALKIN_NAME);
  return id;
}

export function getWalkInCustomer(db: Database.Database, shopId: string): Customer {
  const id = ensureWalkInCustomer(db, shopId);
  const row = db.prepare(`
    SELECT id, name, phone, phone_norm, gstin, gender, consent_abdm, consent_marketing
    FROM customers WHERE id = ?
  `).get(id) as any;
  if (!row) throw new Error(`walk-in row missing after ensure for shop ${shopId}`);
  return rowToCustomer(row);
}

// ---- Customers -------------------------------------------------------------

/**
 * Fast equality lookup on canonical phone form. Uses idx_customers_phone_norm.
 * Accepts any user input format ("+91 98220-01122", "9822001122", etc.).
 * Returns null if input isn't a valid 10-digit phone or no match.
 */
export function lookupCustomerByPhone(
  db: Database.Database,
  shopId: string,
  phone: string,
): Customer | null {
  const norm = normalizePhone(phone);
  if (norm === null) return null;
  const row = db.prepare(`
    SELECT id, name, phone, phone_norm, gstin, gender, consent_abdm, consent_marketing
    FROM customers
    WHERE shop_id = ? AND phone_norm = ?
    LIMIT 1
  `).get(shopId, norm) as any;
  return row ? rowToCustomer(row) : null;
}

export function searchCustomers(
  db: Database.Database, shopId: string, q: string, limit = 20,
): readonly Customer[] {
  const like = `%${q.toLowerCase()}%`;
  const rows = db.prepare(`
    SELECT id, name, phone, phone_norm, gstin, gender, consent_abdm, consent_marketing
    FROM customers
    WHERE shop_id = ?
      AND (LOWER(name) LIKE ? OR phone LIKE ? OR LOWER(COALESCE(gstin,'')) LIKE ?)
    ORDER BY name ASC
    LIMIT ?
  `).all(shopId, like, `%${q}%`, like, limit) as any[];
  return rows.map(rowToCustomer);
}

export interface UpsertCustomerInput {
  readonly id?: string;
  readonly shopId: string;
  readonly name: string;
  readonly phone?: string | null;
  readonly gstin?: string | null;
  readonly gender?: "M" | "F" | "O" | null;
  readonly consentAbdm?: boolean;
  readonly consentMarketing?: boolean;
  readonly consentMethod?: "verbal" | "signed" | "otp" | "app" | null;
}

export function upsertCustomer(db: Database.Database, input: UpsertCustomerInput): string {
  if (!input.name.trim()) throw new Error("customer name required");
  const id = input.id ?? genId("cus");
  const consentAt = (input.consentAbdm || input.consentMarketing)
    ? new Date().toISOString() : null;
  db.prepare(`
    INSERT INTO customers (id, shop_id, name, phone, gstin, gender,
                           consent_marketing, consent_abdm, consent_captured_at, consent_method)
    VALUES (@id, @shopId, @name, @phone, @gstin, @gender,
            @consentMarketing, @consentAbdm, @consentAt, @consentMethod)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, phone=excluded.phone, gstin=excluded.gstin, gender=excluded.gender,
      consent_marketing=excluded.consent_marketing, consent_abdm=excluded.consent_abdm,
      consent_captured_at=excluded.consent_captured_at, consent_method=excluded.consent_method
  `).run({
    id,
    shopId: input.shopId,
    name: input.name.trim(),
    phone: input.phone ?? null,
    gstin: input.gstin ?? null,
    gender: input.gender ?? null,
    consentMarketing: input.consentMarketing ? 1 : 0,
    consentAbdm: input.consentAbdm ? 1 : 0,
    consentAt,
    consentMethod: input.consentMethod ?? null,
  });
  return id;
}

// ---- Doctors ---------------------------------------------------------------

export function searchDoctors(db: Database.Database, q: string, limit = 20): readonly Doctor[] {
  const like = `%${q.toLowerCase()}%`;
  const rows = db.prepare(`
    SELECT id, reg_no, name, phone FROM doctors
    WHERE LOWER(name) LIKE ? OR LOWER(reg_no) LIKE ? OR phone LIKE ?
    ORDER BY name ASC
    LIMIT ?
  `).all(like, like, `%${q}%`, limit) as any[];
  return rows.map((r) => ({ id: r.id, regNo: r.reg_no, name: r.name, phone: r.phone }));
}

export interface UpsertDoctorInput {
  readonly id?: string;
  readonly regNo: string;
  readonly name: string;
  readonly phone?: string | null;
}

export function upsertDoctor(db: Database.Database, input: UpsertDoctorInput): string {
  const regErr = validateDoctorRegNo(input.regNo);
  if (regErr) throw new Error(regErr);
  if (!input.name.trim()) throw new Error("doctor name required");
  const id = input.id ?? genId("doc");
  db.prepare(`
    INSERT INTO doctors (id, reg_no, name, phone)
    VALUES (@id, @regNo, @name, @phone)
    ON CONFLICT(id) DO UPDATE SET
      reg_no=excluded.reg_no, name=excluded.name, phone=excluded.phone
  `).run({
    id, regNo: input.regNo.trim(), name: input.name.trim(), phone: input.phone ?? null,
  });
  return id;
}

// ---- Prescriptions ---------------------------------------------------------

export interface CreateRxInput {
  readonly shopId: string;
  readonly customerId: string;
  readonly doctorId?: string | null;
  readonly kind: "paper" | "digital" | "abdm";
  readonly imagePath?: string | null;
  readonly issuedDate: string;
  readonly notes?: string | null;
}

export function createPrescription(db: Database.Database, input: CreateRxInput): string {
  if (!input.customerId) throw new Error("customerId required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issuedDate)) throw new Error("issuedDate must be YYYY-MM-DD");
  const id = genId("rx");
  db.prepare(`
    INSERT INTO prescriptions (id, shop_id, customer_id, doctor_id, kind, image_path, issued_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.shopId, input.customerId, input.doctorId ?? null,
          input.kind, input.imagePath ?? null, input.issuedDate, input.notes ?? null);
  return id;
}

export function listPrescriptions(db: Database.Database, customerId: string): readonly Prescription[] {
  const rows = db.prepare(`
    SELECT id, customer_id, doctor_id, kind, image_path, issued_date, notes
    FROM prescriptions
    WHERE customer_id = ?
    ORDER BY issued_date DESC, created_at DESC
  `).all(customerId) as any[];
  return rows.map((r) => ({
    id: r.id, customerId: r.customer_id, doctorId: r.doctor_id,
    kind: r.kind, imagePath: r.image_path, issuedDate: r.issued_date, notes: r.notes,
  }));
}

// @pharmacare/directory-repo — customers, doctors, prescriptions.
import type Database from "better-sqlite3";

export interface Customer {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly gstin: string | null;
  readonly gender: "M" | "F" | "O" | null;
  readonly consentAbdm: number;
  readonly consentMarketing: number;
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

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// --- Customers --------------------------------------------------------------

export function searchCustomers(
  db: Database.Database, shopId: string, q: string, limit = 20,
): readonly Customer[] {
  const like = `%${q.toLowerCase()}%`;
  const rows = db.prepare(`
    SELECT id, name, phone, gstin, gender, consent_abdm, consent_marketing
    FROM customers
    WHERE shop_id = ?
      AND (LOWER(name) LIKE ? OR phone LIKE ? OR LOWER(COALESCE(gstin,'')) LIKE ?)
    ORDER BY name ASC
    LIMIT ?
  `).all(shopId, like, `%${q}%`, like, limit) as any[];
  return rows.map((r) => ({
    id: r.id, name: r.name, phone: r.phone, gstin: r.gstin, gender: r.gender,
    consentAbdm: r.consent_abdm, consentMarketing: r.consent_marketing,
  }));
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

// --- Doctors ----------------------------------------------------------------

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
  if (!input.regNo.trim()) throw new Error("doctor regNo required");
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

// --- Prescriptions ----------------------------------------------------------

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

// Shared validators used by the product master (A1) and anywhere that needs
// to pre-flight a write before hitting SQLite. Triggers in migration 0006 are
// the hard floor; these are the soft-layer (fast, in-form, user-friendly).

import type { HSN, DrugSchedule, GstRate } from "./compliance.js";
import type { Paise } from "./money.js";

export const PHARMA_HSN: readonly string[] = ["3003", "3004", "3005", "3006", "9018"] as const;

export function isPharmaHsn(hsn: string): hsn is HSN {
  return PHARMA_HSN.includes(hsn);
}

export function validateHsn(hsn: string): string | null {
  if (!hsn) return "HSN is required";
  if (!/^\d{4}$/.test(hsn)) return "HSN must be a 4-digit code";
  if (!isPharmaHsn(hsn))
    return `HSN must be one of ${PHARMA_HSN.join("/")} for pharma retail`;
  return null;
}

export function validateGstRate(rate: number): rate is GstRate {
  return rate === 0 || rate === 5 || rate === 12 || rate === 18 || rate === 28;
}

export function validateNppaCap(
  mrpPaise: Paise,
  nppaMaxMrpPaise: Paise | null,
): string | null {
  if (nppaMaxMrpPaise === null) return null;
  if (mrpPaise > nppaMaxMrpPaise) {
    return `MRP ₹${(mrpPaise / 100).toFixed(2)} exceeds NPPA ceiling ₹${(nppaMaxMrpPaise / 100).toFixed(2)} (DPCO 2013)`;
  }
  return null;
}

/**
 * X2 moat: Schedule H/H1/X requires an image hash. Matches trigger in
 * migration 0001 (`trg_products_schedule_img_ins/upd`).
 */
export function validateScheduleImage(
  schedule: DrugSchedule,
  imageSha256: string | null,
): string | null {
  if ((schedule === "H" || schedule === "H1" || schedule === "X") && !imageSha256) {
    return `Schedule ${schedule} product requires an image (X2 moat)`;
  }
  return null;
}

export interface ProductWriteInput {
  readonly name: string;
  readonly manufacturer: string;
  readonly hsn: string;
  readonly gstRate: number;
  readonly schedule: DrugSchedule;
  readonly packSize: number;
  readonly mrpPaise: Paise;
  readonly nppaMaxMrpPaise: Paise | null;
  readonly imageSha256: string | null;
}

export function validateProductWrite(p: ProductWriteInput): readonly string[] {
  const errs: string[] = [];
  if (!p.name.trim()) errs.push("name is required");
  if (!p.manufacturer.trim()) errs.push("manufacturer is required");
  const h = validateHsn(p.hsn);
  if (h) errs.push(h);
  if (!validateGstRate(p.gstRate)) errs.push("gst_rate must be 0/5/12/18/28");
  if (!Number.isInteger(p.packSize) || p.packSize <= 0) errs.push("pack_size must be a positive integer");
  if (!Number.isInteger(p.mrpPaise) || p.mrpPaise <= 0) errs.push("mrp must be positive paise");
  if (p.nppaMaxMrpPaise !== null && (!Number.isInteger(p.nppaMaxMrpPaise) || p.nppaMaxMrpPaise <= 0)) {
    errs.push("nppa_max_mrp must be positive paise or null");
  }
  const cap = validateNppaCap(p.mrpPaise, p.nppaMaxMrpPaise);
  if (cap) errs.push(cap);
  const img = validateScheduleImage(p.schedule, p.imageSha256);
  if (img) errs.push(img);
  return errs;
}

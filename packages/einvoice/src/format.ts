// Paise / date / state-code helpers — pure, zero deps.

/**
 * Half-away-from-zero rounding (matches A4 CGST-absorbs-odd-paisa policy).
 * Converts paise → rupees with 2 decimals.
 */
export function paiseToRupees(paise: number): number {
  const rupees = paise / 100;
  // toFixed uses banker's rounding in some engines; force half-away-from-zero.
  const sign = rupees < 0 ? -1 : 1;
  const abs = Math.abs(rupees);
  const rounded = Math.round(abs * 100) / 100;
  return sign * rounded;
}

/**
 * ISO-8601 UTC → DD/MM/YYYY in IST (UTC+05:30).
 * GSTN rule: date must be IST civil date.
 */
export function isoToIstDdMmYyyy(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`invalid iso: ${iso}`);
  }
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(ist.getUTCFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

/** Validates 15-char GSTIN shape (format + checksum is adapter-side). */
export function isValidGstinShape(g: string): boolean {
  if (typeof g !== "string") return false;
  const s = g.trim();
  if (s.length !== 15) return false;
  // [2 digits state][5 alpha PAN][4 digits][1 alpha][1 alpha/digit Z default][1 alpha/digit]
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$/.test(s);
}

/** 6-digit PIN */
export function isValidPin(p: number): boolean {
  return Number.isInteger(p) && p >= 100000 && p <= 999999;
}

/** 2-char state code "01".."38" */
export function isValidStateCode(s: string): boolean {
  if (typeof s !== "string" || s.length !== 2) return false;
  return /^[0-9]{2}$/.test(s);
}

/** 6 or 8 digit HSN for goods */
export function isValidHsn(hsn: string): boolean {
  if (typeof hsn !== "string") return false;
  return /^[0-9]{6}$|^[0-9]{8}$/.test(hsn);
}

/** GSTN invoice number: up to 16 alphanumeric/./-/./ */
export function isValidInvoiceNo(n: string): boolean {
  if (typeof n !== "string") return false;
  const t = n.trim();
  return t.length > 0 && t.length <= 16 && /^[A-Za-z0-9/\-]+$/.test(t);
}

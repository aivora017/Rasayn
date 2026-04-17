/** Paise → rupees with 2-decimal precision (fixed-point via integer arithmetic). */
export function paiseToRupees(paise: number): number {
  // Use Math.round on the paise to avoid float drift;
  // result is rupees as a number with max 2 decimal places.
  // JSON.stringify will preserve trailing zeros if we return a number with .00 — we need
  // to round to 2dp via arithmetic; downstream JSON.stringify renders integers w/o decimals.
  // GSTN accepts both '100' and '100.00' — we return the numeric value, the JSON writer
  // does the stringification. For exact 2dp representation in CSV, formatRupees2Dp is used.
  const r = Math.round(paise) / 100;
  // Guard: avoid -0.00 for zero.
  return r === 0 ? 0 : r;
}

/** Format rupees as a 2-decimal fixed string for CSV. */
export function formatRupees2Dp(paise: number): string {
  const r = Math.round(paise);
  const sign = r < 0 ? "-" : "";
  const abs = Math.abs(r);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${frac.toString().padStart(2, "0")}`;
}

/** 'YYYY-MM-DDTHH:mm:ss.sssZ' → 'DD-MM-YYYY' (GSTN invoice date format). */
export function formatDateDDMMYYYY(iso: string): string {
  // Accept both full ISO and YYYY-MM-DD.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`Invalid date: ${iso}`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** 'MMYYYY' (e.g. '032026') → fiscal-year label 'YYYY-YY' (e.g. '2025-26'). */
export function fiscalYearFromPeriod(period: string): string {
  if (!/^\d{6}$/.test(period)) throw new Error(`Invalid period: ${period}`);
  const mm = parseInt(period.substring(0, 2), 10);
  const yyyy = parseInt(period.substring(2, 6), 10);
  // Indian FY: April → March. Period Jan-Mar belongs to FY (yyyy-1)-(yyyy).
  if (mm >= 4) {
    const nextYY = ((yyyy + 1) % 100).toString().padStart(2, "0");
    return `${yyyy}-${nextYY}`;
  } else {
    const prev = yyyy - 1;
    const yy = (yyyy % 100).toString().padStart(2, "0");
    return `${prev}-${yy}`;
  }
}

/** 'MMYYYY' → { mm: '03', yyyy: '2026' }. */
export function parsePeriod(period: string): { mm: string; yyyy: string } {
  if (!/^\d{6}$/.test(period)) throw new Error(`Invalid period: ${period}`);
  const mm = period.substring(0, 2);
  const yyyy = period.substring(2, 6);
  const mmNum = parseInt(mm, 10);
  if (mmNum < 1 || mmNum > 12) throw new Error(`Invalid month: ${mm}`);
  return { mm, yyyy };
}

/** { mm, yyyy } → 'MMYYYY'. */
export function buildPeriod(mm: string, yyyy: string): string {
  if (!/^\d{2}$/.test(mm)) throw new Error(`mm must be 2 digits: ${mm}`);
  if (!/^\d{4}$/.test(yyyy)) throw new Error(`yyyy must be 4 digits: ${yyyy}`);
  const mmNum = parseInt(mm, 10);
  if (mmNum < 1 || mmNum > 12) throw new Error(`Invalid month: ${mm}`);
  return `${mm}${yyyy}`;
}

/** Test whether an ISO timestamp falls within a given (mm, yyyy) period in IST. */
export function isoInPeriod(iso: string, mm: string, yyyy: string): boolean {
  // Convert ISO (Z) → IST (UTC+5:30) by adding 330 minutes, then extract YYYY-MM.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  const y = ist.getUTCFullYear().toString();
  const m = (ist.getUTCMonth() + 1).toString().padStart(2, "0");
  return y === yyyy && m === mm;
}

/** RFC 4180-compatible CSV field escape. */
export function escapeCsv(v: string | number): string {
  const s = typeof v === "number" ? String(v) : v;
  if (s === "") return "";
  const needsQuote = /[",\r\n]/.test(s);
  if (!needsQuote) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Compute SHA-256 of a string, hex-encoded. Uses Node crypto in test; WebCrypto in browser. */
export async function sha256Hex(text: string): Promise<string> {
  // Prefer subtle crypto (available in Node 20+ globally and in browsers/Tauri webview).
  const enc = new TextEncoder().encode(text);
  // Use globalThis.crypto (works in Node >= 20 and browsers).
  const subtle = (globalThis as unknown as { crypto?: { subtle?: { digest: (alg: string, data: ArrayBuffer | ArrayBufferView) => Promise<ArrayBuffer> } } }).crypto?.subtle;
  if (!subtle) throw new Error("SubtleCrypto not available");
  const digest = await subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

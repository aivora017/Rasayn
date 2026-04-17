// Formatting helpers. Pure functions — no DOM, no runtime deps.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Paise → rupees with 2-decimal + Indian grouping (xx,xx,xxx.xx). */
export function formatRupees(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const rStr = indianGroup(rupees);
  const pStr = p.toString().padStart(2, "0");
  return (neg ? "-" : "") + rStr + "." + pStr;
}

function indianGroup(n: number): string {
  // Indian system: last 3, then groups of 2.
  const s = n.toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const restGrouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return restGrouped + "," + last3;
}

/** Qty: strip trailing zeros, but keep at least 1 decimal if fractional. */
export function formatQty(q: number): string {
  if (Number.isInteger(q)) return q.toString();
  return q.toFixed(3).replace(/\.?0+$/, "");
}

// ---- Amount in words (Indian numbering, whole rupees + paise) ---------------

const UNITS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
  "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return UNITS[n] ?? "";
  const t = Math.floor(n / 10);
  const u = n % 10;
  return (TENS[t] ?? "") + (u ? "-" + (UNITS[u] ?? "") : "");
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const hPart = h ? (UNITS[h] ?? "") + " Hundred" : "";
  if (r === 0) return hPart;
  return (hPart ? hPart + " " : "") + twoDigits(r);
}

/** Convert rupees (not paise) to Indian words. "Two Thousand Three Hundred". */
function rupeesToWords(rupees: number): string {
  if (rupees === 0) return "Zero";
  const crore = Math.floor(rupees / 10000000);
  const rem1 = rupees % 10000000;
  const lakh = Math.floor(rem1 / 100000);
  const rem2 = rem1 % 100000;
  const thousand = Math.floor(rem2 / 1000);
  const rem3 = rem2 % 1000;
  const parts: string[] = [];
  if (crore) parts.push(twoDigits(crore) + " Crore");
  if (lakh) parts.push(twoDigits(lakh) + " Lakh");
  if (thousand) parts.push(twoDigits(thousand) + " Thousand");
  if (rem3) parts.push(threeDigits(rem3));
  return parts.join(" ").trim();
}

export function amountInWords(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const rWords = rupeesToWords(rupees);
  const base = "Rupees " + rWords;
  const tail = p > 0 ? " and " + twoDigits(p) + " Paise" : "";
  return (neg ? "Minus " : "") + base + tail + " Only";
}

/** ISO → "17-Apr-2026 14:03". Fails open to the raw string. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()];
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${dd}-${mon}-${d.getUTCFullYear()} ${hh}:${mm}`;
}

export function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()];
  const dd = d.getUTCDate().toString().padStart(2, "0");
  return `${dd}-${mon}-${d.getUTCFullYear()}`;
}

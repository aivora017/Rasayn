/**
 * Indian-locale formatters. Currency MUST use Paise integers from
 * @pharmacare/shared-types, never floats. North Star §5.3 / §11.
 *
 * formatINR(12345678)            → "₹1,23,456.78"
 * formatINRCompact(12345678)     → "₹1.23 L"
 * formatNumber(123456)           → "1,23,456"
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const num = new Intl.NumberFormat("en-IN");

/** Paise (i64) → ₹X,XX,XXX.XX (en-IN grouping). */
export function formatINR(paise: number | bigint): string {
  const n = typeof paise === "bigint" ? Number(paise) : paise;
  return inr.format(n / 100);
}

/** Paise → "₹1.23 L" / "₹1.23 Cr" — for KPI cards. */
export function formatINRCompact(paise: number | bigint): string {
  const n = typeof paise === "bigint" ? Number(paise) : paise;
  const rupees = n / 100;
  if (Math.abs(rupees) >= 1_00_00_000) {
    return `₹${(rupees / 1_00_00_000).toFixed(2)} Cr`;
  }
  if (Math.abs(rupees) >= 1_00_000) {
    return `₹${(rupees / 1_00_000).toFixed(2)} L`;
  }
  if (Math.abs(rupees) >= 1_000) {
    return `₹${(rupees / 1_000).toFixed(1)}K`;
  }
  return `₹${Math.round(rupees)}`;
}

/** Plain integer → en-IN grouping (1,23,456). */
export function formatNumber(value: number | bigint): string {
  const n = typeof value === "bigint" ? Number(value) : value;
  return num.format(n);
}

/** Trend formatter: +12.4% / −2.1% with explicit sign. */
export function formatPct(pct: number, fractionDigits = 1): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(fractionDigits)}%`;
}

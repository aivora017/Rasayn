// Tier-A regex parser — extracts a ParsedBill from OCR text using a small
// set of robust regex patterns derived from typical Indian distributor
// invoices. Pure function, no I/O. Returns confidence based on how many
// fields it could fill.
//
// Patterns aim for medium-to-high precision over thousands of synthetic
// samples; the orchestrator uses Tier-A's confidence to decide whether to
// escalate to Tier-B (LayoutLMv3) or Tier-C (vision LLM).

import type { ParsedBill } from "@pharmacare/gmail-inbox";

export interface TierAOutput {
  readonly bill: ParsedBill;
  readonly tierConfidence: number; // 0..1
}

/** Regex helpers — public for inspection / unit testing. */
export const RE_INVOICE_NO = /\b(?:invoice|inv|bill)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9\/-]{4,20})\b/i;
export const RE_INVOICE_DATE = /\b(?:date|dt|inv\.?\s*date)?\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.](?:20)?\d{2})\b/i;
export const RE_GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/;
export const RE_SUPPLIER_HEADER = /^[A-Z][A-Z\s&\.\-]{4,40}(?:PHARMA|DISTRIBUTORS?|MEDICOS?|HEALTHCARE|MEDICAL|TRADERS?|AGENCIES?)\b/m;
export const RE_TOTAL = /\b(?:grand\s*total|total\s*amount|net\s*total|amount\s*payable|invoice\s*total)\s*[:\-]?\s*₹?\s*([0-9,]+\.?\d{0,2})\b/i;
/** Per-line extractor: name … qty … rate … amount.
 * Tolerant of varied spacing; demands at least 3 numeric tokens at the end. */
export const RE_LINE = /^([A-Za-z][A-Za-z0-9\s\-\/\.&,()%]{2,60}?)\s{2,}(\d+(?:\.\d+)?)\s+([0-9,]+(?:\.\d{1,2})?)\s+([0-9,]+(?:\.\d{1,2})?)\s*$/;

function num(s: string): number {
  return Number(s.replace(/,/g, ""));
}

function parseDateToIso(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.]((?:20)?\d{2})$/);
  if (!m) return null;
  const dd = m[1]!.padStart(2, "0");
  const mm = m[2]!.padStart(2, "0");
  let yyyy = m[3]!;
  if (yyyy.length === 2) yyyy = `20${yyyy}`;
  // Sanity check
  const monthN = Number(mm);
  const dayN = Number(dd);
  if (monthN < 1 || monthN > 12 || dayN < 1 || dayN > 31) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/** Run Tier-A regex parse over OCR text. */
export function tierA(rawText: string): TierAOutput {
  const text = (rawText ?? "").replace(/\r\n/g, "\n");
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  // Header fields
  const invoiceNoMatch = text.match(RE_INVOICE_NO);
  const invoiceDateMatch = text.match(RE_INVOICE_DATE);
  const supplierMatch = text.match(RE_SUPPLIER_HEADER);
  const totalMatch = text.match(RE_TOTAL);

  const invoiceNo = invoiceNoMatch?.[1] ?? null;
  const invoiceDateRaw = invoiceDateMatch?.[1] ?? null;
  const invoiceDate = invoiceDateRaw ? parseDateToIso(invoiceDateRaw) : null;
  const supplierHint = supplierMatch?.[0]?.trim() ?? null;
  const totalPaise = totalMatch?.[1] != null ? Math.round(num(totalMatch[1]) * 100) : null;

  // Per-line items
  const parsedLines: ParsedBill["lines"] = [];
  for (const ln of lines) {
    const m = ln.match(RE_LINE);
    if (!m) continue;
    const name = m[1]!.trim();
    const qty = num(m[2]!);
    const rate = num(m[3]!);
    const amount = num(m[4]!);
    if (qty <= 0 || rate <= 0 || amount <= 0) continue;
    // Sanity: |qty * rate - amount| / amount < 5%
    const expected = qty * rate;
    if (Math.abs(expected - amount) / Math.max(amount, 1) > 0.05) continue;
    parsedLines.push({
      productHint: name,
      hsn: null,
      batchNo: null,
      expiryDate: null,
      qty,
      ratePaise: Math.round(rate * 100),
      mrpPaise: null,
      gstRate: null,
      confidence: 0.85,
    });
  }

  // Confidence formula: weighted sum of header fields + line presence.
  let conf = 0;
  if (invoiceNo) conf += 0.2;
  if (invoiceDate) conf += 0.15;
  if (supplierHint) conf += 0.2;
  if (totalPaise !== null) conf += 0.15;
  if (parsedLines.length >= 1) conf += 0.15;
  if (parsedLines.length >= 5) conf += 0.15;
  conf = Math.min(1, conf);

  // Cross-check: sum of line amounts ≈ total
  if (totalPaise !== null && parsedLines.length > 0) {
    const sumPaise = parsedLines.reduce((acc, l) => acc + (l.qty * l.ratePaise), 0);
    const ratio = Math.abs(sumPaise - totalPaise) / Math.max(totalPaise, 1);
    if (ratio < 0.02) conf = Math.min(1, conf + 0.1);
  }

  const bill: ParsedBill = {
    tier: "A",
    header: {
      invoiceNo,
      invoiceDate,
      totalPaise,
      supplierHint,
      confidence: conf,
    },
    lines: parsedLines,
  };

  return { bill, tierConfidence: conf };
}

// @pharmacare/gmail-inbox — X1 moat scaffold.
// Pure types + deterministic parser utilities. No Gmail I/O yet (that lives
// in the Rust sidecar once OAuth is wired). Tier A "supplier templates"
// live here: known regex headers + column maps per known distributor.

export type ParseTier = "A" | "B" | "C";

export interface ParsedHeader {
  readonly supplierHint: string | null;
  readonly invoiceNo: string | null;
  readonly invoiceDate: string | null;
  readonly totalPaise: number | null;
  readonly confidence: number;
}

export interface ParsedLine {
  readonly productHint: string;
  readonly hsn: string | null;
  readonly batchNo: string | null;
  readonly mfgDate: string | null;
  readonly expiryDate: string | null;
  readonly qty: number;
  readonly ratePaise: number;
  readonly mrpPaise: number | null;
  readonly gstRate: number | null;
  readonly confidence: number;
}

export interface ParsedBill {
  readonly tier: ParseTier;
  readonly header: ParsedHeader;
  readonly lines: readonly ParsedLine[];
}

/** Very conservative header extractor. Returns nulls when unsure. */
export function parseHeaderHeuristic(text: string): ParsedHeader {
  const invNo = text.match(/invoice\s*(?:no|#)[.:\s]*([A-Z0-9\-/]+)/i)?.[1] ?? null;
  const dateIso = text.match(/\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/)?.[1]
    ?? text.match(/\b(\d{1,2}[-/]\d{1,2}[-/]20\d{2})\b/)?.[1] ?? null;
  const supplier = text.match(/^([A-Z][A-Za-z &.]+(?:Pharma|Distributors|Medical|Healthcare))/m)?.[1]?.trim() ?? null;
  const totalMatch = text.match(/grand\s*total[^₹\d]*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
  const totalPaise = totalMatch ? Math.round(parseFloat(totalMatch.replace(/,/g, "")) * 100) : null;

  let conf = 0;
  if (invNo) conf += 0.35;
  if (dateIso) conf += 0.25;
  if (supplier) conf += 0.2;
  if (totalPaise !== null) conf += 0.2;

  return {
    supplierHint: supplier,
    invoiceNo: invNo,
    invoiceDate: dateIso ? normaliseDate(dateIso) : null,
    totalPaise,
    confidence: Math.round(conf * 100) / 100,
  };
}

function normaliseDate(s: string): string {
  // returns YYYY-MM-DD
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split(/[-/]/).map(Number);
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const [d, m, y] = s.split(/[-/]/).map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}


// --- Supplier templates (Tier A configurable parser) ---------------------

export interface SupplierTemplate {
  readonly id: string;
  readonly supplierId: string;
  readonly name: string;
  readonly headerPatterns: {
    readonly invoiceNo: string;       // regex
    readonly invoiceDate: string;
    readonly total: string;
    readonly supplier?: string;
  };
  readonly linePatterns: {
    readonly row: string;             // regex that matches one line row; capture groups or named groups
  };
  readonly columnMap: Record<string, number | string>;
  readonly dateFormat: "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY" | "DD-MMM-YYYY";
}

export interface UpsertSupplierTemplateInput {
  readonly id?: string;
  readonly shopId: string;
  readonly supplierId: string;
  readonly name: string;
  readonly headerPatterns: SupplierTemplate["headerPatterns"];
  readonly linePatterns: SupplierTemplate["linePatterns"];
  readonly columnMap: Record<string, number | string>;
  readonly dateFormat?: SupplierTemplate["dateFormat"];
  readonly isActive?: boolean;
}

function firstCapture(re: string, text: string, flags = "im"): string | null {
  try {
    const m = text.match(new RegExp(re, flags));
    return m && m[1] ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function parseNumeric(s: string | null): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[^\d.\-]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDateFormatted(s: string | null, fmt: SupplierTemplate["dateFormat"]): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (fmt === "YYYY-MM-DD") {
    const m = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (!m) return null;
    return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  }
  if (fmt === "DD/MM/YYYY") {
    const m = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  if (fmt === "MM/DD/YYYY") {
    const m = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  }
  if (fmt === "DD-MMM-YYYY") {
    const m = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (!m) return null;
    const mon: Record<string, string> = {
      JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
      JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
    };
    const mm = mon[m[2]!.toUpperCase()];
    if (!mm) return null;
    return `${m[3]}-${mm}-${m[1]!.padStart(2, "0")}`;
  }
  return null;
}

function pickCol(cols: readonly string[], key: number | string | undefined, groups?: Record<string, string>): string | null {
  if (key === undefined) return null;
  if (typeof key === "number") return cols[key]?.trim() ?? null;
  if (groups && key in groups) return groups[key]!.trim();
  return null;
}

/** Apply a supplier template to raw invoice text. Tier A parser. */
export function applySupplierTemplate(template: SupplierTemplate, text: string): ParsedBill {
  const header: ParsedHeader = {
    supplierHint: template.headerPatterns.supplier ? firstCapture(template.headerPatterns.supplier, text) : null,
    invoiceNo: firstCapture(template.headerPatterns.invoiceNo, text),
    invoiceDate: parseDateFormatted(firstCapture(template.headerPatterns.invoiceDate, text), template.dateFormat),
    totalPaise: (() => {
      const v = parseNumeric(firstCapture(template.headerPatterns.total, text));
      return v === null ? null : Math.round(v * 100);
    })(),
    confidence: 0,
  };

  let rowRe: RegExp;
  try { rowRe = new RegExp(template.linePatterns.row, "gim"); }
  catch { return { tier: "A", header: { ...header, confidence: 0 }, lines: [] }; }

  const lines: ParsedLine[] = [];
  let m: RegExpExecArray | null;
  const iter = text.matchAll(rowRe);
  for (const match of iter) {
    m = match;
    const cols = m.slice(1).map((c) => (c ?? "").toString());
    const groups = (m as any).groups as Record<string, string> | undefined;
    const product = pickCol(cols, template.columnMap.product, groups) ?? "";
    if (!product.trim()) continue;
    const qty = parseNumeric(pickCol(cols, template.columnMap.qty, groups)) ?? 0;
    const rate = parseNumeric(pickCol(cols, template.columnMap.ratePaise, groups));
    const mrp = parseNumeric(pickCol(cols, template.columnMap.mrpPaise, groups));
    const gst = parseNumeric(pickCol(cols, template.columnMap.gstRate, groups));
    const mfg = parseDateFormatted(pickCol(cols, template.columnMap.mfgDate, groups), template.dateFormat);
    const exp = parseDateFormatted(pickCol(cols, template.columnMap.expiryDate, groups), template.dateFormat);
    const batchNo = pickCol(cols, template.columnMap.batchNo, groups);
    const hsn = pickCol(cols, template.columnMap.hsn, groups);

    const lineConf =
      (qty > 0 ? 0.2 : 0) +
      (rate !== null ? 0.2 : 0) +
      (mrp !== null ? 0.2 : 0) +
      (batchNo ? 0.2 : 0) +
      (exp ? 0.2 : 0);

    lines.push({
      productHint: product,
      hsn,
      batchNo,
      mfgDate: mfg,
      expiryDate: exp,
      qty,
      ratePaise: rate === null ? 0 : Math.round(rate * 100),
      mrpPaise: mrp === null ? null : Math.round(mrp * 100),
      gstRate: gst,
      confidence: Math.round(lineConf * 100) / 100,
    });
  }

  const headerConf =
    (header.invoiceNo ? 0.35 : 0) +
    (header.invoiceDate ? 0.25 : 0) +
    (header.supplierHint ? 0.2 : 0) +
    (header.totalPaise !== null ? 0.2 : 0);

  return {
    tier: "A",
    header: { ...header, confidence: Math.round(headerConf * 100) / 100 },
    lines,
  };
}

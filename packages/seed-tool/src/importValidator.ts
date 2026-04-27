// Pre-import validator for legacy CSV exports (Marg, Tally, generic).
// Pilot Day-1 SOP T-3 step: surface HSN gaps, missing batch/expiry, GST-rate
// mismatches BEFORE we ingest into PharmaCare's SKU master.
//
// Pure TS, zero deps. Reads a UTF-8 CSV string and a header-mapping config,
// returns a structured report with row-level findings classified by severity.

/** Recognized pharma HSN prefixes — anything starting with one of these is
 * acceptable. PHARMA_HSN in shared-types/validators.ts is the source of truth. */
const PHARMA_HSN_PREFIXES: readonly string[] = ["3003", "3004", "3005", "3006", "9018"];

/** Acceptable GST rates — must match @pharmacare/shared-types GstRate. */
const VALID_GST_RATES: readonly number[] = [0, 5, 12, 18, 28];

export type FindingSeverity = "error" | "warn" | "info";

export interface Finding {
  /** 1-based row number in the CSV (header row is row 1, first data row is 2). */
  readonly row: number;
  /** Header name of the offending column, or "*" if row-level. */
  readonly column: string;
  /** Severity classification. error = blocks import, warn = needs owner OK,
   *  info = auto-corrected. */
  readonly severity: FindingSeverity;
  /** Stable error code — matches the Rust side's import path. */
  readonly code:
    | "HSN_NOT_PHARMA"
    | "HSN_EMPTY"
    | "GST_RATE_INVALID"
    | "GST_RATE_EMPTY"
    | "BATCH_EMPTY"
    | "EXPIRY_EMPTY"
    | "EXPIRY_PAST"
    | "QTY_NON_POSITIVE"
    | "QTY_EMPTY"
    | "MRP_NON_POSITIVE"
    | "MRP_EMPTY"
    | "PRODUCT_NAME_EMPTY"
    | "MANUFACTURER_EMPTY"
    | "SCHEDULE_INVALID"
    | "DUPLICATE_BATCH"
    | "ROW_PARSE_FAILED";
  readonly message: string;
}

export interface ValidationSummary {
  readonly totalRows: number;
  readonly errorCount: number;
  readonly warnCount: number;
  readonly infoCount: number;
  readonly cleanRowCount: number;
}

export interface ValidationReport {
  readonly summary: ValidationSummary;
  readonly findings: readonly Finding[];
  /** Cleaned + validated rows that passed all error checks (still may have
   *  warnings flagged). Caller can pass these directly to the Rust importer. */
  readonly cleanRows: readonly Record<string, string>[];
}

/** Header-mapping for the validator. Owner picks one of the presets or
 *  provides a custom map. Each value is the header name in the source CSV. */
export interface ImportColumnMap {
  readonly productName: string;
  readonly manufacturer: string;
  readonly hsn: string;
  readonly gstRate: string;
  readonly schedule?: string;
  readonly batchNo: string;
  readonly expiry: string;
  readonly qty: string;
  readonly mrp: string;
}

/** Marg ERP default export column names. */
export const MARG_COLUMN_MAP: ImportColumnMap = {
  productName: "Item Name",
  manufacturer: "Mfg.",
  hsn: "HSN",
  gstRate: "GST %",
  schedule: "Schedule",
  batchNo: "Batch No.",
  expiry: "Expiry",
  qty: "Qty",
  mrp: "MRP",
};

/** Tally Prime default Stock Summary export column names. */
export const TALLY_COLUMN_MAP: ImportColumnMap = {
  productName: "Particulars",
  manufacturer: "Manufacturer",
  hsn: "HSN/SAC",
  gstRate: "Tax Rate",
  schedule: "Schedule",
  batchNo: "Batch",
  expiry: "Expiry Date",
  qty: "Closing Qty",
  mrp: "Rate",
};

/** Parse a CSV string into headers + rows. Handles RFC-4180 quoting. */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines: string[] = [];
  let cur = "";
  let inQuote = false;
  // Outer pass splits the input into lines, preserving quotes so splitRow
  // can do its own quoting-aware tokenization. Newlines INSIDE quotes are
  // kept (legitimate in RFC-4180); newlines outside quotes terminate a line.
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\r") continue;
    if (ch === '"') {
      cur += ch;
      if (inQuote && text[i + 1] === '"') {
        // Escaped quote — append the second quote and skip.
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
      continue;
    }
    if (ch === "\n" && !inQuote) {
      lines.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) lines.push(cur);
  if (lines.length === 0) return { headers: [], rows: [] };

  function splitRow(s: string): string[] {
    const out: string[] = [];
    let buf = "";
    let q = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        if (ch === '"') {
          if (s[i + 1] === '"') {
            buf += '"';
            i++;
          } else {
            q = false;
          }
        } else {
          buf += ch;
        }
      } else {
        if (ch === '"') q = true;
        else if (ch === ",") {
          out.push(buf);
          buf = "";
        } else buf += ch;
      }
    }
    out.push(buf);
    return out;
  }

  const headers = splitRow(lines[0]!).map((h) => h.trim());
  const rows = lines.slice(1).filter((l) => l.trim().length > 0).map(splitRow);
  return { headers, rows };
}

function trimOrNull(s: string | undefined): string {
  return (s ?? "").trim();
}

function looksLikePharmaHsn(hsn: string): boolean {
  if (!hsn) return false;
  return PHARMA_HSN_PREFIXES.some((p) => hsn.startsWith(p));
}

function parseGstRate(raw: string): number | null {
  if (!raw.trim()) return null;
  // Tolerate "12%", "12.0", "12 %"
  const cleaned = raw.replace(/%/g, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseDateLoose(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + "T00:00:00Z");
    return isNaN(d.getTime()) ? null : d;
  }
  // DD/MM/YYYY or DD-MM-YYYY
  const m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(s);
  if (m) {
    const d = new Date(`${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}T00:00:00Z`);
    return isNaN(d.getTime()) ? null : d;
  }
  // MM/YYYY (common batch expiry format) — interpret as last day of month
  const m2 = /^(\d{1,2})[\/-](\d{4})$/.exec(s);
  if (m2) {
    const month = parseInt(m2[1]!, 10);
    const year = parseInt(m2[2]!, 10);
    if (month < 1 || month > 12) return null;
    // Last day of the month
    const d = new Date(Date.UTC(year, month, 0));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function parseQty(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function parseMrp(raw: string): number | null {
  if (!raw.trim()) return null;
  // Accept ₹220.00, "Rs.220", "INR 220.50", "1,250.00".
  // Strip currency symbols + group commas + whitespace. Keep the decimal point.
  let cleaned = raw.replace(/[₹\s,]/g, "");
  cleaned = cleaned.replace(/Rs\.?/gi, "");
  cleaned = cleaned.replace(/INR/gi, "");
  cleaned = cleaned.trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Validate a parsed CSV against an ImportColumnMap. */
export function validateImportCsv(
  csv: string,
  cols: ImportColumnMap,
  options: {
    /** ISO date used for "expiry in the past" check. Defaults to today. */
    readonly today?: string;
    /** When true, missing schedule field is downgraded to a warn (default OTC). */
    readonly defaultScheduleToOtc?: boolean;
  } = {},
): ValidationReport {
  const { headers, rows } = parseCsv(csv);
  const findings: Finding[] = [];
  const cleanRows: Record<string, string>[] = [];

  const today = options.today ? new Date(options.today + "T00:00:00Z") : new Date();
  const indexOf = (col: string): number => headers.indexOf(col);

  // Header sanity — flag missing required columns up front, abort if any.
  const required: (keyof ImportColumnMap)[] = [
    "productName", "manufacturer", "hsn", "gstRate", "batchNo", "expiry", "qty", "mrp",
  ];
  for (const k of required) {
    const colName = cols[k] as string;
    if (indexOf(colName) === -1) {
      findings.push({
        row: 1,
        column: colName,
        severity: "error",
        code: "ROW_PARSE_FAILED",
        message: `required column "${colName}" missing from CSV header — cannot proceed`,
      });
    }
  }
  if (findings.some((f) => f.severity === "error")) {
    return {
      summary: { totalRows: 0, errorCount: findings.length, warnCount: 0, infoCount: 0, cleanRowCount: 0 },
      findings,
      cleanRows: [],
    };
  }

  const seenBatches = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const rowNum = i + 2; // header is row 1
    const out: Record<string, string> = {};
    let rowErrors = 0;

    const get = (col: string): string => trimOrNull(r[indexOf(col)]);

    const productName = get(cols.productName);
    if (!productName) {
      findings.push({
        row: rowNum, column: cols.productName, severity: "error",
        code: "PRODUCT_NAME_EMPTY",
        message: "product name is empty",
      });
      rowErrors++;
    }
    out.productName = productName;

    const manufacturer = get(cols.manufacturer);
    if (!manufacturer) {
      findings.push({
        row: rowNum, column: cols.manufacturer, severity: "error",
        code: "MANUFACTURER_EMPTY",
        message: "manufacturer is empty",
      });
      rowErrors++;
    }
    out.manufacturer = manufacturer;

    const hsn = get(cols.hsn);
    if (!hsn) {
      findings.push({
        row: rowNum, column: cols.hsn, severity: "error",
        code: "HSN_EMPTY",
        message: "HSN is empty",
      });
      rowErrors++;
    } else if (!looksLikePharmaHsn(hsn)) {
      findings.push({
        row: rowNum, column: cols.hsn, severity: "error",
        code: "HSN_NOT_PHARMA",
        message: `HSN "${hsn}" does not start with a pharma prefix (3003/3004/3005/3006/9018)`,
      });
      rowErrors++;
    }
    out.hsn = hsn;

    const gstRaw = get(cols.gstRate);
    if (!gstRaw) {
      findings.push({
        row: rowNum, column: cols.gstRate, severity: "error",
        code: "GST_RATE_EMPTY",
        message: "GST rate is empty",
      });
      rowErrors++;
    } else {
      const gst = parseGstRate(gstRaw);
      if (gst === null || !VALID_GST_RATES.includes(gst)) {
        findings.push({
          row: rowNum, column: cols.gstRate, severity: "error",
          code: "GST_RATE_INVALID",
          message: `GST rate "${gstRaw}" is not in {0,5,12,18,28}`,
        });
        rowErrors++;
      } else {
        out.gstRate = String(gst);
      }
    }

    if (cols.schedule) {
      const sched = get(cols.schedule);
      if (sched && !["OTC", "G", "H", "H1", "X", "NDPS"].includes(sched)) {
        if (options.defaultScheduleToOtc) {
          findings.push({
            row: rowNum, column: cols.schedule, severity: "warn",
            code: "SCHEDULE_INVALID",
            message: `unknown schedule "${sched}" — defaulting to OTC`,
          });
          out.schedule = "OTC";
        } else {
          findings.push({
            row: rowNum, column: cols.schedule, severity: "error",
            code: "SCHEDULE_INVALID",
            message: `schedule "${sched}" not in {OTC,G,H,H1,X,NDPS}`,
          });
          rowErrors++;
        }
      } else {
        out.schedule = sched || "OTC";
      }
    } else {
      out.schedule = "OTC";
    }

    const batch = get(cols.batchNo);
    if (!batch) {
      findings.push({
        row: rowNum, column: cols.batchNo, severity: "error",
        code: "BATCH_EMPTY",
        message: "batch number is empty",
      });
      rowErrors++;
    } else {
      const dupKey = `${productName}|${batch}`.toLowerCase();
      if (seenBatches.has(dupKey)) {
        findings.push({
          row: rowNum, column: cols.batchNo, severity: "warn",
          code: "DUPLICATE_BATCH",
          message: `batch "${batch}" already seen for product "${productName}" — second occurrence treated as separate batch`,
        });
      }
      seenBatches.add(dupKey);
    }
    out.batchNo = batch;

    const expRaw = get(cols.expiry);
    if (!expRaw) {
      findings.push({
        row: rowNum, column: cols.expiry, severity: "error",
        code: "EXPIRY_EMPTY",
        message: "expiry is empty",
      });
      rowErrors++;
    } else {
      const d = parseDateLoose(expRaw);
      if (d === null) {
        findings.push({
          row: rowNum, column: cols.expiry, severity: "error",
          code: "EXPIRY_EMPTY",
          message: `expiry "${expRaw}" not parseable as YYYY-MM-DD / DD/MM/YYYY / MM/YYYY`,
        });
        rowErrors++;
      } else if (d < today) {
        findings.push({
          row: rowNum, column: cols.expiry, severity: "warn",
          code: "EXPIRY_PAST",
          message: `expiry ${expRaw} is in the past — line will not be salable`,
        });
        out.expiry = d.toISOString().slice(0, 10);
      } else {
        out.expiry = d.toISOString().slice(0, 10);
      }
    }

    const qtyRaw = get(cols.qty);
    if (!qtyRaw) {
      findings.push({
        row: rowNum, column: cols.qty, severity: "error",
        code: "QTY_EMPTY",
        message: "qty is empty",
      });
      rowErrors++;
    } else {
      const q = parseQty(qtyRaw);
      if (q === null) {
        findings.push({
          row: rowNum, column: cols.qty, severity: "error",
          code: "QTY_NON_POSITIVE",
          message: `qty "${qtyRaw}" not parseable as a number`,
        });
        rowErrors++;
      } else if (q <= 0) {
        findings.push({
          row: rowNum, column: cols.qty, severity: "warn",
          code: "QTY_NON_POSITIVE",
          message: `qty ${q} is not positive — usually means stock-out at export time`,
        });
        out.qty = String(q);
      } else {
        out.qty = String(q);
      }
    }

    const mrpRaw = get(cols.mrp);
    if (!mrpRaw) {
      findings.push({
        row: rowNum, column: cols.mrp, severity: "error",
        code: "MRP_EMPTY",
        message: "MRP is empty",
      });
      rowErrors++;
    } else {
      const m = parseMrp(mrpRaw);
      if (m === null || m <= 0) {
        findings.push({
          row: rowNum, column: cols.mrp, severity: "error",
          code: "MRP_NON_POSITIVE",
          message: `MRP "${mrpRaw}" must be a positive number`,
        });
        rowErrors++;
      } else {
        out.mrpPaise = String(Math.round(m * 100));
      }
    }

    if (rowErrors === 0) cleanRows.push(out);
  }

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warnCount = findings.filter((f) => f.severity === "warn").length;
  const infoCount = findings.filter((f) => f.severity === "info").length;
  return {
    summary: {
      totalRows: rows.length,
      errorCount,
      warnCount,
      infoCount,
      cleanRowCount: cleanRows.length,
    },
    findings,
    cleanRows,
  };
}

/** Render a markdown report for the owner — the diff list referenced in the SOP. */
export function renderMarkdownReport(report: ValidationReport, sourceLabel: string): string {
  const { summary, findings } = report;
  const head = `# Import-validator report — ${sourceLabel}

Generated ${new Date().toISOString()}

## Summary

| Metric | Count |
|---|---:|
| Total rows | ${summary.totalRows} |
| Clean rows (no errors) | ${summary.cleanRowCount} |
| Rows with **errors** (will be skipped on import) | ${summary.errorCount} |
| Rows with warnings (imported, but flag for owner review) | ${summary.warnCount} |
| Info-level (auto-corrected) | ${summary.infoCount} |

`;

  if (findings.length === 0) {
    return head + "\n## Findings\n\nNo findings — clean import.\n";
  }

  const tableHead = `\n## Findings (${findings.length})\n\n| Row | Column | Severity | Code | Message |\n|---:|---|---|---|---|\n`;
  const rows = findings
    .map((f) => {
      const sevTag = f.severity === "error" ? "**error**" : f.severity === "warn" ? "warn" : "info";
      return `| ${f.row} | \`${f.column}\` | ${sevTag} | \`${f.code}\` | ${f.message.replace(/\|/g, "\\|")} |`;
    })
    .join("\n");
  return head + tableHead + rows + "\n";
}

/**
 * @pharmacare/gstr1 — Types
 *
 * Wire types for GSTR-1 monthly return generation. All currency values in
 * the *input* DTOs are paise (i64); the package converts to 2-decimal
 * rupees at the JSON boundary only.
 */

// ─── Inputs ─────────────────────────────────────────────────────────────

export interface ShopForGstr1 {
  readonly id: string;
  readonly gstin: string;       // 15 chars
  readonly stateCode: string;   // 2 chars
  readonly name: string;
}

export interface CustomerForGstr1 {
  readonly id: string;
  readonly gstin: string | null;
  readonly name: string;
  readonly stateCode: string | null; // derived from address / 'DL'/'MH' etc.
  readonly address: string | null;
}

export interface BillLineForGstr1 {
  readonly id: string;
  readonly productId: string;
  readonly hsn: string;            // joined from products
  readonly gstRate: 0 | 5 | 12 | 18 | 28;
  readonly qty: number;
  readonly taxableValuePaise: number;
  readonly cgstPaise: number;
  readonly sgstPaise: number;
  readonly igstPaise: number;
  readonly cessPaise: number;
  readonly lineTotalPaise: number;
}

export interface BillForGstr1 {
  readonly id: string;
  readonly billNo: string;            // unique in (shop_id, bill_no)
  readonly billedAt: string;          // ISO8601
  readonly docSeries: string;         // default 'INV'
  readonly gstTreatment: "intra_state" | "inter_state" | "exempt" | "nil_rated";
  readonly subtotalPaise: number;
  readonly totalDiscountPaise: number;
  readonly totalCgstPaise: number;
  readonly totalSgstPaise: number;
  readonly totalIgstPaise: number;
  readonly totalCessPaise: number;
  readonly roundOffPaise: number;
  readonly grandTotalPaise: number;
  readonly isVoided: 0 | 1;
  readonly customer: CustomerForGstr1 | null;
  readonly lines: readonly BillLineForGstr1[];
}

// ─── Credit-note inputs (A8 / ADR 0021 step 4) ──────────────────────────

export interface ReturnLineForGstr1 {
  readonly id: string;
  /** FK back to the original bill_line — used to look up HSN + rate. */
  readonly billLineId: string;
  readonly hsn: string;
  readonly gstRate: 0 | 5 | 12 | 18 | 28;
  readonly qtyReturned: number;
  readonly refundTaxablePaise: number;
  readonly refundCgstPaise: number;
  readonly refundSgstPaise: number;
  readonly refundIgstPaise: number;
  readonly refundCessPaise: number;
  readonly refundAmountPaise: number;
}

export interface ReturnForGstr1 {
  readonly id: string;
  /** Credit-note number 'CN/YYYY-YY/NNNN' (ADR 0021 Q3). */
  readonly returnNo: string;
  /** ISO8601 of when the return event was recorded — period filter target. */
  readonly createdAt: string;
  readonly originalBillId: string;
  readonly originalBillNo: string;
  /** ISO8601 of original bill so cdnr.idt can be filled deterministically. */
  readonly originalBilledAt: string;
  readonly gstTreatment: "intra_state" | "inter_state" | "exempt" | "nil_rated";
  readonly customer: CustomerForGstr1 | null;
  readonly refundCgstPaise: number;
  readonly refundSgstPaise: number;
  readonly refundIgstPaise: number;
  readonly refundCessPaise: number;
  readonly refundTotalPaise: number;
  readonly lines: readonly ReturnLineForGstr1[];
}

export interface GenerateGstr1Input {
  readonly period: { readonly mm: string; readonly yyyy: string }; // mm 01-12
  readonly shop: ShopForGstr1;
  readonly bills: readonly BillForGstr1[];
  /** A8 / ADR 0021 step 4 — credit notes issued in this period. Optional
   * (back-compat with callers that don't yet pass returns). */
  readonly returns?: readonly ReturnForGstr1[];
}

// ─── Output — JSON schema (rupees, 2dp) ─────────────────────────────────

/** A B2B invoice in JSON payload. */
export interface B2BInvoice {
  readonly inum: string;              // invoice number
  readonly idt: string;               // invoice date DD-MM-YYYY
  readonly val: number;               // invoice value (rupees, 2dp)
  readonly pos: string;               // place-of-supply state code 2-char
  readonly rchrg: "Y" | "N";          // reverse charge
  readonly inv_typ: "R";              // regular
  readonly itms: readonly B2BItem[];
}

export interface B2BItem {
  readonly num: number;               // serial (1-based)
  readonly itm_det: {
    readonly txval: number;
    readonly rt: number;              // rate 0/5/12/18/28
    readonly iamt: number;
    readonly camt: number;
    readonly samt: number;
    readonly csamt: number;
  };
}

/** A B2B row in the JSON is grouped by buyer GSTIN. */
export interface B2BBuyerBlock {
  readonly ctin: string;              // buyer GSTIN
  readonly inv: readonly B2BInvoice[];
}

/** B2CL — interstate, unregistered, invoice-value > ₹1L. */
export interface B2CLInvoice {
  readonly inum: string;
  readonly idt: string;
  readonly val: number;
  readonly itms: readonly B2BItem[];   // same shape as B2B items
}

export interface B2CLStateBlock {
  readonly pos: string;               // place-of-supply state code
  readonly inv: readonly B2CLInvoice[];
}

/** B2CS — aggregated by (pos, rate). */
export interface B2CSRow {
  readonly sply_ty: "INTRA" | "INTER";
  readonly pos: string;               // place-of-supply
  readonly typ: "OE";                 // ordinary earnings (non e-commerce)
  readonly rt: number;
  readonly txval: number;
  readonly iamt: number;
  readonly camt: number;
  readonly samt: number;
  readonly csamt: number;
}

// ─── CDNR / CDNUR / B2CSA — credit-note rows (A8 / ADR 0021 step 4) ─────

/** A line-level row inside a CDNR / CDNUR note, grouped per GST rate. */
export interface CdnrItem {
  readonly num: number;
  readonly itm_det: {
    readonly txval: number;
    readonly rt: number;
    readonly iamt: number;
    readonly camt: number;
    readonly samt: number;
    readonly csamt: number;
  };
}

/** A single CDNR (Credit/Debit Note for Registered) note. */
export interface CdnrNote {
  readonly nt_num: string;          // credit-note number
  readonly nt_dt: string;           // credit-note date DD-MM-YYYY
  readonly val: number;             // credit-note value (rupees, 2dp)
  readonly ntty: "C" | "D";         // 'C' = credit, 'D' = debit (always 'C' here)
  readonly inum: string;            // original invoice number
  readonly idt: string;             // original invoice date DD-MM-YYYY
  readonly itms: readonly CdnrItem[];
}

/** CDNR block — grouped per registered buyer GSTIN. */
export interface CdnrBuyerBlock {
  readonly ctin: string;
  readonly nt: readonly CdnrNote[];
}

/** A single CDNUR (Credit/Debit Note for Unregistered) note. */
export interface CdnurNote {
  readonly nt_num: string;
  readonly nt_dt: string;
  readonly val: number;
  readonly ntty: "C" | "D";
  /** Original supply type. For our pharmacy POS only 'B2CL' applies today. */
  readonly typ: "B2CL" | "EXPWP" | "EXPWOP";
  readonly inum: string;
  readonly idt: string;
  readonly pos: string;             // place-of-supply state code
  readonly itms: readonly CdnrItem[];
}

/** HSN rows — separate B2B and B2C blocks (2025 split). */
export interface HsnRow {
  readonly num: number;
  readonly hsn_sc: string;
  readonly desc: string | null;
  readonly uqc: string;               // 'NOS' default
  readonly qty: number;
  readonly rt: number;
  readonly txval: number;
  readonly iamt: number;
  readonly camt: number;
  readonly samt: number;
  readonly csamt: number;
}

export interface HsnBlock {
  readonly data: readonly HsnRow[];
}

/** EXEMP — nil / exempt / non-GST aggregate (tiny for pharmacy). */
export interface ExempRow {
  readonly sply_ty: "INTRB2B" | "INTRB2C" | "INTRAB2B" | "INTRAB2C";
  readonly nil_amt: number;
  readonly expt_amt: number;
  readonly ngsup_amt: number;
}

/** DOC — documents issued summary per series. */
export interface DocRow {
  readonly num: number;               // 1-based
  readonly from: string;
  readonly to: string;
  readonly totnum: number;
  readonly cancel: number;
  readonly net_issue: number;
}

export interface DocBlock {
  readonly doc_num: number;           // nature-of-document code 1=outward invoices
  readonly doc_typ: string;           // "Invoices for outward supply"
  readonly docs: readonly DocRow[];
}

/** Top-level JSON payload. */
export interface Gstr1Payload {
  readonly gstin: string;
  readonly fp: string;                // 'MMYYYY'
  readonly version: string;           // e.g. 'GST3.1.3'
  readonly hash: string;              // 'hash' placeholder; real hash set outside
  readonly b2b: readonly B2BBuyerBlock[];
  readonly b2cl: readonly B2CLStateBlock[];
  readonly b2cs: readonly B2CSRow[];
  readonly hsn: {
    readonly hsn_b2b: HsnBlock;
    readonly hsn_b2c: HsnBlock;
  };
  readonly nil: { readonly inv: readonly ExempRow[] };
  readonly doc_issue: { readonly doc_det: readonly DocBlock[] };
  // A8 (ADR 0021 step 4) — credit notes
  readonly cdnr: readonly CdnrBuyerBlock[];
  readonly cdnur: readonly CdnurNote[];
  // Stubs (empty for v1)
  readonly b2ba: readonly unknown[];
  readonly b2cla: readonly unknown[];
  readonly b2csa: readonly unknown[];
  readonly cdnra: readonly unknown[];
  readonly cdnura: readonly unknown[];
  readonly exp: readonly unknown[];
}

// ─── Output — CSV bundle + summary ──────────────────────────────────────

export interface Gstr1CsvBundle {
  readonly b2b: string;
  readonly b2cl: string;
  readonly b2cs: string;
  readonly cdnr: string;
  readonly cdnur: string;
  readonly hsn: string;
  readonly exemp: string;
  readonly doc: string;
}

export interface Gstr1Summary {
  readonly billCount: number;
  readonly b2bCount: number;
  readonly b2clCount: number;
  readonly b2csRowCount: number;
  readonly hsnB2bRowCount: number;
  readonly hsnB2cRowCount: number;
  readonly exempRowCount: number;
  readonly docRowCount: number;
  /** Count of CDNR notes (credit notes to registered buyers). */
  readonly cdnrNoteCount: number;
  /** Count of CDNUR notes (credit notes to unregistered, interstate large). */
  readonly cdnurNoteCount: number;
  /** Aggregate credit-note refund value across cdnr + cdnur + b2cs net. */
  readonly creditNoteRefundTotalPaise: number;
  readonly grandTotalPaise: number;
  readonly gaps: readonly { readonly series: string; readonly gapNums: readonly string[] }[];
  readonly invalid: readonly { readonly billId: string; readonly reason: string }[];
}

export interface Gstr1Result {
  readonly json: Gstr1Payload;
  readonly csv: Gstr1CsvBundle;
  readonly summary: Gstr1Summary;
}

// ─── Constants (exported so callers share source of truth) ──────────────

export const B2CL_THRESHOLD_PAISE = 1_00_00_000; // ₹1 L = 1,00,00,000 paise
export const DEFAULT_DOC_NATURE_CODE = 1;
export const DEFAULT_DOC_NATURE_LABEL = "Invoices for outward supply";
export const DEFAULT_UQC = "NOS";
export const GSTR1_SCHEMA_VERSION = "GST3.1.3";

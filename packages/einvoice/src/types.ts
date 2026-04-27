// GSTN NIC e-invoice schema v1.1 types — subset we emit.
// All rupee values are strings with 2 decimals at the IRN boundary.

export type VendorName = "cygnet" | "cleartax" | "mock";

export type IrnStatus =
  | "pending"
  | "submitted"
  | "acked"
  | "cancelled"
  | "failed";

export type GstTreatment = "intra_state" | "inter_state" | "exempt" | "nil_rated";

// GSTN e-invoice transaction types
export type TaxScheme = "GST";
export type SupplyType = "B2B"; // A12 covers B2B only; B2CL/B2CS not mandatory

export interface IrnTranDtls {
  TaxSch: TaxScheme;
  SupTyp: SupplyType;
  RegRev?: "Y" | "N";
  IgstOnIntra?: "Y" | "N";
}

export interface IrnDocDtls {
  Typ: "INV" | "CRN" | "DBN";
  No: string;      // invoice number
  Dt: string;      // DD/MM/YYYY IST
}

export interface IrnPartyDtls {
  Gstin: string;   // 15-char
  LglNm: string;
  Addr1: string;
  Loc: string;
  Pin: number;     // 6-digit
  Stcd: string;    // 2-char state code
}

export interface IrnItem {
  SlNo: string;    // "1", "2", ...
  PrdDesc: string;
  IsServc: "Y" | "N";
  HsnCd: string;   // 6 or 8 digits
  Qty: number;
  Unit: string;    // UQC — "NOS" default
  UnitPrice: number;
  TotAmt: number;
  Discount: number;
  AssAmt: number;
  GstRt: number;
  IgstAmt: number;
  CgstAmt: number;
  SgstAmt: number;
  TotItemVal: number;
}

export interface IrnValDtls {
  AssVal: number;
  CgstVal: number;
  SgstVal: number;
  IgstVal: number;
  TotInvVal: number;
  RndOffAmt: number;
}

export interface IrnPrecDocDtls {
  InvNo: string;     // original invoice number
  InvDt: string;     // original invoice date DD/MM/YYYY IST
  OthRefNo?: string; // optional carrier ref
}

export interface IrnRefDtls {
  PrecDocDtls?: IrnPrecDocDtls[];
}

export interface IrnPayload {
  Version: "1.1";
  TranDtls: IrnTranDtls;
  DocDtls: IrnDocDtls;
  /** Required when DocDtls.Typ === 'CRN' or 'DBN'. Lists the
   *  preceding invoice this credit/debit note adjusts. */
  RefDtls?: IrnRefDtls;
  SellerDtls: IrnPartyDtls;
  BuyerDtls: IrnPartyDtls;
  ItemList: IrnItem[];
  ValDtls: IrnValDtls;
}

// Input shape (from Rust `get_bill_full` / TS readBillFull)
export interface BillLineForIrn {
  slNo: number;
  productName: string;
  hsn: string;
  qty: number;
  unit?: string;        // defaults to "NOS"
  mrpPaise: number;
  discountPaise: number;
  taxableValuePaise: number;
  gstRate: 0 | 5 | 12 | 18 | 28;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  lineTotalPaise: number;
}

export interface PartyForIrn {
  gstin: string;
  legalName: string;
  address1: string;
  location: string;
  pincode: number;
  stateCode: string;
}

export interface BillForIrn {
  billId: string;
  billNo: string;
  billedAtIso: string;    // ISO-8601 UTC; convert to DD/MM/YYYY IST
  gstTreatment: GstTreatment;
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  roundOffPaise: number;
  grandTotalPaise: number;
  lines: BillLineForIrn[];
  seller: PartyForIrn;
  buyer: PartyForIrn;
}

export interface ShopForIrn {
  annualTurnoverPaise: number;
  einvoiceEnabled: boolean;
  einvoiceVendor: VendorName;
}

// Validation
export type IrnValidationErrorCode =
  | "EINVOICE_DISABLED"
  | "TURNOVER_BELOW_THRESHOLD"
  | "NOT_B2B"
  | "SELLER_GSTIN_INVALID"
  | "BUYER_GSTIN_INVALID"
  | "INVOICE_NO_EMPTY"
  | "INVOICE_NO_TOO_LONG"
  | "EMPTY_LINES"
  | "HSN_INVALID"
  | "QTY_NON_POSITIVE"
  | "TOTALS_MISMATCH"
  | "INTRA_HAS_IGST"
  | "INTER_HAS_CGST"
  | "PIN_INVALID"
  | "STATECODE_INVALID";

export interface IrnValidationError {
  code: IrnValidationErrorCode;
  message: string;
  field?: string;
  lineSlNo?: number;
}

export interface IrnValidationResult {
  ok: boolean;
  errors: IrnValidationError[];
}

// Adapter responses (mirrors Rust adapter trait)
export interface IrnAckResponse {
  irn: string;
  ackNo: string;
  ackDate: string;        // ISO-8601 UTC
  signedInvoice: string;
  qrCode: string;
}

export interface IrnErrorResponse {
  errorCode: string;
  errorMsg: string;
}

// 5Cr turnover threshold in paise.
export const TURNOVER_THRESHOLD_PAISE = 5_00_00_000_00; // ₹5,00,00,000 * 100


// ─── A8 / ADR 0021 step 6 — credit-note (CRN) inputs ────────────────────

/** A line on a credit note, projected for IRN payload emission.
 * Mirrors BillLineForIrn but every monetary field carries the *refund*
 * pro-rata amount (already computed by bill-repo/partialRefund.ts on the
 * client and validated in Rust by triggers in migration 0020). */
export interface CreditNoteLineForIrn {
  slNo: number;
  productName: string;
  hsn: string;
  qtyReturned: number;
  unit?: string;        // defaults to "NOS"
  mrpPaise: number;
  refundDiscountPaise: number;
  refundTaxablePaise: number;
  gstRate: 0 | 5 | 12 | 18 | 28;
  refundCgstPaise: number;
  refundSgstPaise: number;
  refundIgstPaise: number;
  /** refundTaxable - refundDiscount + refund{Cgst,Sgst,Igst} */
  refundLineTotalPaise: number;
}

export interface CreditNoteForIrn {
  /** UUID of the return_header row. */
  returnId: string;
  /** 'CN/YYYY-YY/NNNN'. Used as DocDtls.No on the CRN payload. */
  returnNo: string;
  /** ISO-8601 UTC of when the credit note was recorded. */
  createdAtIso: string;
  /** Forward / reverse path classification — must match the original bill. */
  gstTreatment: GstTreatment;
  /** Original invoice number (mandatory for PrecDocDtls). */
  originalBillNo: string;
  /** Original invoice ISO-8601 UTC datetime. */
  originalBilledAtIso: string;
  /** Refund subtotals — these aggregate ItemList. */
  refundSubtotalPaise: number;
  refundCgstPaise: number;
  refundSgstPaise: number;
  refundIgstPaise: number;
  refundRoundOffPaise: number;
  refundTotalPaise: number;
  lines: CreditNoteLineForIrn[];
  seller: PartyForIrn;
  buyer: PartyForIrn;
}

export type CrnValidationErrorCode =
  | IrnValidationErrorCode
  | "ORIG_INVOICE_NO_EMPTY"
  | "ORIG_INVOICE_DATE_EMPTY"
  | "REFUND_AMOUNT_NON_POSITIVE";

export interface CrnValidationError {
  code: CrnValidationErrorCode;
  message: string;
  field?: string;
  lineSlNo?: number;
}

export interface CrnValidationResult {
  ok: boolean;
  errors: CrnValidationError[];
}

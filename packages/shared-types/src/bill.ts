import type { BillId, BillLineId, ProductId, BatchId, CustomerId, DoctorId, RxId, ShopId, UserId } from "./ids.js";
import type { Paise } from "./money.js";
import type { GstRate, GstTreatment } from "./compliance.js";

export type PaymentMode = "cash" | "upi" | "card" | "credit" | "wallet" | "split";

export interface BillLine {
  readonly id: BillLineId;
  readonly billId: BillId;
  readonly productId: ProductId;
  readonly batchId: BatchId;
  readonly qty: number;                   // units
  readonly mrpPaise: Paise;               // MRP per unit (inclusive)
  readonly discountPct: number;           // 0..100
  readonly discountPaise: Paise;          // absolute discount on line
  readonly taxableValuePaise: Paise;      // (MRP \u00f7 (1+gst/100)) * qty \u2013 discount
  readonly gstRate: GstRate;
  readonly cgstPaise: Paise;
  readonly sgstPaise: Paise;
  readonly igstPaise: Paise;
  readonly cessPaise: Paise;
  readonly lineTotalPaise: Paise;         // taxable + tax
}

export interface Bill {
  readonly id: BillId;
  readonly shopId: ShopId;
  readonly billNo: string;                // per-shop invoice series, GST-compliant
  readonly billedAt: string;              // ISO 8601
  readonly customerId: CustomerId | null;
  readonly doctorId: DoctorId | null;
  readonly rxId: RxId | null;
  readonly cashierId: UserId;
  readonly gstTreatment: GstTreatment;
  readonly subtotalPaise: Paise;          // sum of taxable values
  readonly totalDiscountPaise: Paise;
  readonly totalCgstPaise: Paise;
  readonly totalSgstPaise: Paise;
  readonly totalIgstPaise: Paise;
  readonly totalCessPaise: Paise;
  readonly roundOffPaise: Paise;          // \u00b150 paise max
  readonly grandTotalPaise: Paise;
  readonly paymentMode: PaymentMode;
  readonly eInvoiceIRN: string | null;    // set after Cygnet IRN issuance
  readonly isVoided: boolean;
  readonly lines: readonly BillLine[];
}

// A8 · Payment tenders (ADR 0012).
// A single bill may have 1..N payment rows ("tenders"). When tenders are
// provided to save_bill, their amount_paise sum MUST equal the computed
// grand_total_paise within ±50 paise tolerance (the same window as the
// round-off line). Violation surfaces `TenderMismatch` to the UI.

export type TenderMode = "cash" | "upi" | "card" | "credit" | "wallet";

export interface Tender {
  readonly mode: TenderMode;
  readonly amountPaise: Paise;
  /** card-last-4, UPI-RRN, credit-slip-no, etc. Optional. */
  readonly refNo?: string | null;
}

export interface PaymentRow {
  readonly id: string;
  readonly billId: BillId;
  readonly mode: TenderMode;
  readonly amountPaise: Paise;
  readonly refNo: string | null;
  readonly createdAt: string;               // ISO 8601
}

/** Max allowed drift between sum(tenders) and grand_total_paise. */
export const TENDER_TOLERANCE_PAISE = 50 as const;

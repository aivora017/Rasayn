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

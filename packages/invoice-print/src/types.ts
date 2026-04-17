// Types mirror apps/desktop/src/lib/ipc.ts BillFullDTO so the package is
// consumable by both desktop (Tauri IPC result) and tests (hand-built fixtures).
// Keep this file dep-free — no runtime imports.

export type InvoiceLayout = "thermal_80mm" | "a5_gst";
export type Schedule = "OTC" | "G" | "H" | "H1" | "X" | "NDPS";

export interface ShopFull {
  readonly id: string;
  readonly name: string;
  readonly gstin: string;
  readonly stateCode: string;
  readonly retailLicense: string;
  readonly address: string;
  readonly pharmacistName: string | null;
  readonly pharmacistRegNo: string | null;
  readonly fssaiNo: string | null;
  readonly defaultInvoiceLayout: InvoiceLayout;
}

export interface BillHeader {
  readonly id: string;
  readonly billNo: string;
  readonly billedAt: string;
  readonly customerId: string | null;
  readonly rxId: string | null;
  readonly cashierId: string;
  readonly gstTreatment: string;
  readonly subtotalPaise: number;
  readonly totalDiscountPaise: number;
  readonly totalCgstPaise: number;
  readonly totalSgstPaise: number;
  readonly totalIgstPaise: number;
  readonly totalCessPaise: number;
  readonly roundOffPaise: number;
  readonly grandTotalPaise: number;
  readonly paymentMode: string;
  readonly isVoided: number;
}

export interface CustomerFull {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly gstin: string | null;
  readonly address: string | null;
}

export interface PrescriptionFull {
  readonly id: string;
  readonly doctorName: string | null;
  readonly doctorRegNo: string | null;
  readonly kind: string;
  readonly issuedDate: string;
  readonly notes: string | null;
}

export interface BillLineFull {
  readonly id: string;
  readonly productId: string;
  readonly productName: string;
  readonly hsn: string;
  readonly batchId: string;
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
  readonly qty: number;
  readonly mrpPaise: number;
  readonly discountPct: number;
  readonly discountPaise: number;
  readonly taxableValuePaise: number;
  readonly gstRate: number;
  readonly cgstPaise: number;
  readonly sgstPaise: number;
  readonly igstPaise: number;
  readonly cessPaise: number;
  readonly lineTotalPaise: number;
  readonly schedule: Schedule;
}

export interface PaymentRow {
  readonly id: string;
  readonly billId: string;
  readonly mode: "cash" | "upi" | "card" | "credit" | "wallet";
  readonly amountPaise: number;
  readonly refNo: string | null;
  readonly createdAt: string;
}

export interface HsnSummary {
  readonly hsn: string;
  readonly gstRate: number;
  readonly taxableValuePaise: number;
  readonly cgstPaise: number;
  readonly sgstPaise: number;
  readonly igstPaise: number;
  readonly cessPaise: number;
}

export interface BillFull {
  readonly shop: ShopFull;
  readonly bill: BillHeader;
  readonly customer: CustomerFull | null;
  readonly prescription: PrescriptionFull | null;
  readonly lines: readonly BillLineFull[];
  readonly payments: readonly PaymentRow[];
  readonly hsnTaxSummary: readonly HsnSummary[];
}

export interface PrintReceipt {
  readonly id: string;
  readonly billId: string;
  readonly layout: InvoiceLayout;
  readonly isDuplicate: number;
  readonly printCount: number;
  readonly stampedAt: string;
}

export interface RenderInvoiceInput {
  readonly bill: BillFull;
  /** layout override; defaults to auto-select (B2B → a5_gst, else thermal_80mm). */
  readonly layout?: InvoiceLayout;
  /** set when reprinting — stamps "DUPLICATE — REPRINT" banner. */
  readonly printReceipt?: PrintReceipt;
}

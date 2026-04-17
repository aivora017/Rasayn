// Test-only fixtures (not exported from package — used by tests and the
// manual renderer-sanity script under scripts/).
import type { BillFull, BillLineFull } from "./types.js";

export function makeBill(overrides: Partial<BillFull> = {}): BillFull {
  const lines: BillLineFull[] = [
    {
      id: "bl_1", productId: "p_paracip", productName: "Paracip 500 Tab",
      hsn: "3004", batchId: "b_1", batchNo: "PCP241", expiryDate: "2027-03-31",
      qty: 20, mrpPaise: 220, discountPct: 0, discountPaise: 0,
      taxableValuePaise: 3929, gstRate: 12,
      cgstPaise: 236, sgstPaise: 236, igstPaise: 0, cessPaise: 0,
      lineTotalPaise: 4401, schedule: "OTC",
    },
    {
      id: "bl_2", productId: "p_azee", productName: "Azee 500 Tab",
      hsn: "3004", batchId: "b_2", batchNo: "AZ2611", expiryDate: "2028-01-31",
      qty: 3, mrpPaise: 12500, discountPct: 5, discountPaise: 1875,
      taxableValuePaise: 31808, gstRate: 12,
      cgstPaise: 1908, sgstPaise: 1908, igstPaise: 0, cessPaise: 0,
      lineTotalPaise: 35624, schedule: "H",
    },
  ];
  return {
    shop: {
      id: "s_1", name: "Vaidyanath Pharmacy",
      gstin: "27ABCDE1234F1Z5", stateCode: "27",
      retailLicense: "20B-123456", address: "1st Floor, Main Rd, Kalyan 421301, MH",
      pharmacistName: "Sourav Shaw", pharmacistRegNo: "MH-87654",
      fssaiNo: "11521000001234", defaultInvoiceLayout: "thermal_80mm",
    },
    bill: {
      id: "bill_1", billNo: "B-00021",
      billedAt: "2026-04-17T14:03:00.000Z",
      customerId: null, rxId: null, cashierId: "u_cashier1",
      gstTreatment: "registered",
      subtotalPaise: 37500, totalDiscountPaise: 1875,
      totalCgstPaise: 2144, totalSgstPaise: 2144,
      totalIgstPaise: 0, totalCessPaise: 0,
      roundOffPaise: -12, grandTotalPaise: 40025,
      paymentMode: "cash", isVoided: 0,
    },
    customer: null,
    prescription: null,
    lines,
    payments: [
      { id: "pay_1", billId: "bill_1", mode: "cash", amountPaise: 40025, refNo: null, createdAt: "2026-04-17T14:03:00.000Z" },
    ],
    hsnTaxSummary: [
      { hsn: "3004", gstRate: 12, taxableValuePaise: 35737, cgstPaise: 2144, sgstPaise: 2144, igstPaise: 0, cessPaise: 0 },
    ],
    ...overrides,
  };
}

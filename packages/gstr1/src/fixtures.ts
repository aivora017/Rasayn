/** Test-only fixtures. Keep co-located for discoverability; excluded from build via tsconfig. */
import type {
  BillForGstr1,
  BillLineForGstr1,
  CustomerForGstr1,
  ShopForGstr1,
} from "./types.js";

export function makeShop(overrides: Partial<ShopForGstr1> = {}): ShopForGstr1 {
  return {
    id: "shop-kalyan-1",
    gstin: "27ABCDE1234F1Z5",
    stateCode: "27",                 // Maharashtra
    name: "Vaidyanath Pharmacy",
    ...overrides,
  };
}

export function makeCustomer(
  overrides: Partial<CustomerForGstr1> = {},
): CustomerForGstr1 {
  return {
    id: "cust-1",
    gstin: null,
    name: "Walk-in",
    stateCode: "27",
    address: null,
    ...overrides,
  };
}

export function makeLine(
  overrides: Partial<BillLineForGstr1> = {},
): BillLineForGstr1 {
  return {
    id: "bl-1",
    productId: "prod-paracip",
    hsn: "30049099",
    gstRate: 12,
    qty: 1,
    taxableValuePaise: 10000,  // ₹100
    cgstPaise: 600,
    sgstPaise: 600,
    igstPaise: 0,
    cessPaise: 0,
    lineTotalPaise: 11200,
    ...overrides,
  };
}

export function makeBill(overrides: Partial<BillForGstr1> = {}): BillForGstr1 {
  const lines = overrides.lines ?? [makeLine()];
  const computed: BillForGstr1 = {
    id: "bill-1",
    billNo: "INV-0001",
    billedAt: "2026-03-15T10:30:00.000Z",
    docSeries: "INV",
    gstTreatment: "intra_state",
    subtotalPaise: 10000,
    totalDiscountPaise: 0,
    totalCgstPaise: 600,
    totalSgstPaise: 600,
    totalIgstPaise: 0,
    totalCessPaise: 0,
    roundOffPaise: 0,
    grandTotalPaise: 11200,
    isVoided: 0,
    customer: makeCustomer(),
    lines,
    ...overrides,
  };
  return computed;
}

/** A small multi-bill fixture covering B2B + B2CS + exempt. */
export function makeSampleMarch2026(): BillForGstr1[] {
  return [
    makeBill({
      id: "b-1", billNo: "INV-0001",
      billedAt: "2026-03-02T10:00:00.000Z",
      customer: makeCustomer(),
      lines: [makeLine()],
    }),
    makeBill({
      id: "b-2", billNo: "INV-0002",
      billedAt: "2026-03-05T11:20:00.000Z",
      customer: makeCustomer({
        gstin: "27XYZAB1234G1Z1",
        name: "Metro Clinic Pvt Ltd",
      }),
      gstTreatment: "intra_state",
      subtotalPaise: 50000, totalCgstPaise: 3000, totalSgstPaise: 3000,
      grandTotalPaise: 56000,
      lines: [
        makeLine({
          id: "b-2-l1", hsn: "30049099", gstRate: 12,
          taxableValuePaise: 50000, cgstPaise: 3000, sgstPaise: 3000,
          lineTotalPaise: 56000, qty: 5,
        }),
      ],
    }),
    makeBill({
      id: "b-3", billNo: "INV-0003",
      billedAt: "2026-03-08T14:10:00.000Z",
      customer: makeCustomer({ stateCode: "07" }),  // Delhi — interstate
      gstTreatment: "inter_state",
      // ₹2,50,000 taxable + 12% IGST = ₹2,80,000 → well above ₹1L B2CL threshold
      subtotalPaise: 2_50_00_000, totalIgstPaise: 30_00_000,
      totalCgstPaise: 0, totalSgstPaise: 0,
      grandTotalPaise: 2_80_00_000,
      lines: [
        makeLine({
          id: "b-3-l1", hsn: "30049099", gstRate: 12,
          taxableValuePaise: 2_50_00_000, igstPaise: 30_00_000, cgstPaise: 0, sgstPaise: 0,
          lineTotalPaise: 2_80_00_000, qty: 20,
        }),
      ],
    }),
    // voided bill — must appear in doc count but not json sections
    makeBill({
      id: "b-4", billNo: "INV-0004",
      billedAt: "2026-03-10T09:00:00.000Z",
      customer: makeCustomer(),
      isVoided: 1,
    }),
    // bill from February — must be filtered out by period
    makeBill({
      id: "b-feb", billNo: "INV-0005",
      billedAt: "2026-02-28T18:00:00.000Z",
      customer: makeCustomer(),
    }),
    // exempt bill
    makeBill({
      id: "b-exempt", billNo: "INV-0006",
      billedAt: "2026-03-12T12:00:00.000Z",
      customer: makeCustomer(),
      gstTreatment: "exempt",
      subtotalPaise: 5000,
      totalCgstPaise: 0, totalSgstPaise: 0,
      grandTotalPaise: 5000,
      lines: [
        makeLine({
          id: "b-exempt-l1", hsn: "30049099", gstRate: 0,
          taxableValuePaise: 5000, cgstPaise: 0, sgstPaise: 0,
          lineTotalPaise: 5000, qty: 1,
        }),
      ],
    }),
  ];
}

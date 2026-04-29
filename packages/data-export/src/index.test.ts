import { describe, it, expect } from "vitest";
import {
  customersCsv, productsCsv, batchesCsv, billsCsv, billLinesCsv,
  paymentsCsv, grnsCsv, stockMovementsCsv,
  productsToMargCsv, customersToVyaparCsv,
  buildDataExport, buildSchemaMarkdown,
  type ExportableCustomer, type ExportableProduct, type ExportableBatch,
  type ExportableBill, type ExportableBillLine, type ExportablePayment,
  type ExportableGrn, type ExportableStockMovement, type FullDataExport,
} from "./index.js";
import { paise } from "@pharmacare/shared-types";

const cust: ExportableCustomer = {
  id: "c1", name: "Asha Iyer", phone: "9876543210", gstin: "",
  address: "1 Main St", currentDuePaise: paise(50000), createdAt: "2026-01-15",
};
const prod: ExportableProduct = {
  id: "p1", name: "Crocin 500mg", genericName: "Paracetamol",
  manufacturer: "GSK", schedule: "H", hsn: "30049099", gstRatePct: 5,
  mrpPaise: paise(4500), isActive: true,
};
const batch: ExportableBatch = {
  id: "b1", productId: "p1", batchNo: "BN1",
  expiryDate: "2027-04-30", mrpPaise: paise(4500), purchasePricePaise: paise(3500),
  qtyOnHand: 150,
};
const bill: ExportableBill = {
  id: "bill1", billNo: "B-001", billedAt: "2026-04-15T11:00:00Z",
  customerId: "c1", subtotalPaise: paise(10000),
  cgstPaise: paise(250), sgstPaise: paise(250), igstPaise: paise(0), cessPaise: paise(0),
  grandTotalPaise: paise(10500), paymentMode: "cash", cashierId: "u1", isVoided: false,
};
const billLine: ExportableBillLine = {
  id: "bl1", billId: "bill1", productId: "p1", batchId: "b1",
  qty: 2, mrpPaise: paise(4500), discountPct: 0,
  taxablePaise: paise(9000), taxPaise: paise(450), totalPaise: paise(9450),
};
const payment: ExportablePayment = {
  id: "pay1", billId: "bill1", mode: "cash", amountPaise: paise(10500),
};
const grn: ExportableGrn = {
  id: "g1", invoiceNo: "INV-101", invoiceDate: "2026-04-10",
  supplierId: "s1", supplierName: "Pharmarack",
  totalCostPaise: paise(50000), status: "received",
};
const movement: ExportableStockMovement = {
  id: "sm1", batchId: "b1", productId: "p1", qtyDelta: 150,
  movementType: "grn", refTable: "grns", refId: "g1",
  actorId: "u1", createdAt: "2026-04-10T09:00:00Z",
};

describe("CSV builders", () => {
  it("customersCsv: header + one row per customer", () => {
    const csv = customersCsv([cust]);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("id,name,phone");
    expect(lines[1]).toContain("Asha Iyer");
    expect(lines[1]).toContain("50000");
  });
  it("productsCsv shows schedule + hsn", () => {
    const csv = productsCsv([prod]);
    expect(csv).toContain("H,30049099,5,4500");
  });
  it("batchesCsv shows expiry + qty", () => {
    const csv = batchesCsv([batch]);
    expect(csv).toContain("2027-04-30");
    expect(csv).toContain("150");
  });
  it("billsCsv shows GST split as paise", () => {
    const csv = billsCsv([bill]);
    expect(csv).toContain("250");          // cgst
    expect(csv).toContain("10500");        // grand total
  });
  it("billLinesCsv preserves all financial fields", () => {
    const csv = billLinesCsv([billLine]);
    expect(csv).toContain("9000");         // taxable
    expect(csv).toContain("9450");         // total
  });
  it("paymentsCsv supports split-tender (multiple rows for same bill)", () => {
    const split = [payment, { ...payment, id: "pay2", mode: "upi", amountPaise: paise(5000) }];
    const csv = paymentsCsv(split);
    expect(csv.split("\n").length).toBe(3);     // header + 2 rows
  });
  it("grnsCsv preserves supplier name", () => {
    const csv = grnsCsv([grn]);
    expect(csv).toContain("Pharmarack");
  });
  it("stockMovementsCsv preserves the audit ledger", () => {
    const csv = stockMovementsCsv([movement]);
    expect(csv).toContain("grn,grns,g1");
  });
});

describe("Re-import adapters", () => {
  it("productsToMargCsv emits Marg-friendly column order", () => {
    const csv = productsToMargCsv([prod]);
    const header = csv.split("\n")[0]!;
    expect(header).toBe("Item Code,Item Name,Manufacturer,MRP,Sale Rate,Pack,HSN Code,Generic Name,Schedule,Stock");
    const dataRow = csv.split("\n")[1]!;
    expect(dataRow).toContain("p1,Crocin 500mg,GSK,45,45");
  });
  it("customersToVyaparCsv emits Vyapar-friendly columns", () => {
    const csv = customersToVyaparCsv([cust]);
    expect(csv.split("\n")[0]).toBe("Party Name,Phone,GSTIN,Address,Opening Balance");
    expect(csv).toContain("500");           // 50000 paise → ₹500 opening balance
  });
});

describe("buildSchemaMarkdown", () => {
  it("documents the schema + invariants", () => {
    const md = buildSchemaMarkdown();
    expect(md).toContain("integer paise");
    expect(md).toContain("double-entry invariant");
    expect(md).toContain("Marg ERP");
    expect(md).toContain("Tally");
    expect(md).toContain("Vyapar");
  });
});

describe("buildDataExport — orchestration", () => {
  const data: FullDataExport = {
    shopName: "Test Pharmacy",
    shopGstin: "27AAAAA0000A1Z5",
    exportedAt: "2026-04-28T12:00:00Z",
    customers: [cust], products: [prod], batches: [batch],
    bills: [bill], billLines: [billLine], payments: [payment],
    grns: [grn], stockMovements: [movement],
  };

  it("default bundle includes 11 files (8 CSV + JSON + 2 MD)", () => {
    const b = buildDataExport({ shopName: data.shopName, shopGstin: data.shopGstin, data });
    const names = b.files.map((f) => f.name);
    expect(names).toContain("customers.csv");
    expect(names).toContain("products.csv");
    expect(names).toContain("everything.json");
    expect(names).toContain("schema.md");
    expect(names).toContain("README.md");
    expect(names).toContain("reimport_marg/products.csv");
    expect(names).toContain("reimport_vyapar/parties.csv");
  });

  it("can opt out of re-import adapters", () => {
    const b = buildDataExport({
      shopName: data.shopName, shopGstin: data.shopGstin, data,
      includeReimportAdapters: false,
    });
    const names = b.files.map((f) => f.name);
    expect(names).not.toContain("reimport_marg/products.csv");
    expect(names).not.toContain("reimport_vyapar/parties.csv");
  });

  it("everything.json is valid JSON with all 8 collections", () => {
    const b = buildDataExport({ shopName: data.shopName, shopGstin: data.shopGstin, data });
    const json = b.files.find((f) => f.name === "everything.json")!;
    const parsed = JSON.parse(json.content);
    expect(parsed.customers).toHaveLength(1);
    expect(parsed.products).toHaveLength(1);
    expect(parsed.bills).toHaveLength(1);
    expect(parsed.stockMovements).toHaveLength(1);
  });

  it("README mentions YOUR data + take it with you", () => {
    const b = buildDataExport({ shopName: "JaganLLP", shopGstin: data.shopGstin, data });
    const readme = b.files.find((f) => f.name === "README.md")!;
    expect(readme.content).toContain("JaganLLP");
    expect(readme.content).toContain("YOUR data");
    expect(readme.content).toContain("Take it with you");
  });
});

describe("CSV escaping edge cases", () => {
  it("escapes commas in customer names", () => {
    const csv = customersCsv([{ ...cust, name: "Smith, John" }]);
    expect(csv).toContain('"Smith, John"');
  });
  it("escapes quotes in addresses", () => {
    const csv = customersCsv([{ ...cust, address: 'He said "hi"' }]);
    expect(csv).toContain('"He said ""hi"""');
  });
  it("preserves empty optional fields", () => {
    const csv = customersCsv([{ ...cust, phone: undefined, gstin: undefined, address: undefined }]);
    const dataRow = csv.split("\n")[1]!;
    expect(dataRow).toMatch(/c1,Asha Iyer,,,,/);
  });
});

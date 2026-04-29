import { describe, it, expect } from "vitest";
import {
  parseCsv, adaptMargItemMasterCsv, adaptMargCustomerCsv,
  adaptTallyXml, adaptVyaparItemCsv, adaptMedeilDrugCsv,
  adaptGenericCsv, planImport,
  parseRupeeToPaise, normalizeSchedule,
  type ExistingRowProbe,
} from "./index.js";

describe("parseCsv", () => {
  it("handles simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([["a","b","c"],["1","2","3"]]);
  });
  it("handles quoted commas", () => {
    expect(parseCsv('name,addr\n"Smith, John","1 Main St, B"')).toEqual([
      ["name","addr"],
      ["Smith, John","1 Main St, B"],
    ]);
  });
  it("handles escaped quotes", () => {
    expect(parseCsv('a\n"He said ""hi"""')).toEqual([["a"], ['He said "hi"']]);
  });
  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a","b"],["1","2"]]);
  });
  it("skips fully empty rows", () => {
    expect(parseCsv("a\n1\n\n2\n")).toEqual([["a"],["1"],["2"]]);
  });
});

describe("parseRupeeToPaise", () => {
  it("plain number", () => { expect(parseRupeeToPaise("123.45")).toBe(12345); });
  it("with rupee symbol + commas", () => { expect(parseRupeeToPaise("₹1,234.50")).toBe(123450); });
  it("empty → 0", () => { expect(parseRupeeToPaise("")).toBe(0); });
  it("garbage → 0", () => { expect(parseRupeeToPaise("not money")).toBe(0); });
});

describe("normalizeSchedule", () => {
  it("X", () => { expect(normalizeSchedule("Schedule X")).toBe("X"); });
  it("H1", () => { expect(normalizeSchedule("Schedule H1")).toBe("H1"); });
  it("H1 short", () => { expect(normalizeSchedule("h1")).toBe("H1"); });
  it("H plain", () => { expect(normalizeSchedule("h")).toBe("H"); });
  it("unknown → OTC", () => { expect(normalizeSchedule("none")).toBe("OTC"); });
});

describe("adaptMargItemMasterCsv", () => {
  it("parses standard Marg item export", () => {
    const csv = `Item Code,Item Name,Manufacturer,MRP,Sale Rate,Pack,HSN Code,Generic Name,Schedule,Stock
M001,Crocin 500mg,GSK,45.00,42.00,15 tab,30049099,Paracetamol,H,150
M002,Amoxicillin 500mg,Cipla,120.00,115.00,10 cap,30049099,Amoxicillin,H,80`;
    const r = adaptMargItemMasterCsv(csv);
    expect(r.vendor).toBe("marg");
    expect(r.rows).toHaveLength(2);
    const first = r.rows[0]!;
    expect(first.kind).toBe("product");
    expect(first.externalId).toBe("M001");
    expect(first.fields["name"]).toBe("Crocin 500mg");
    expect(first.fields["mrpPaise"]).toBe(4500);
    expect(first.fields["schedule"]).toBe("H");
    expect(first.fields["currentStock"]).toBe(150);
  });

  it("warns on missing required column", () => {
    const csv = `Item Name,Stock\nCrocin,10`;
    const r = adaptMargItemMasterCsv(csv);
    expect(r.warnings.some((w) => /Item Code/.test(w))).toBe(true);
  });

  it("skips rows without code or name + records warning", () => {
    const csv = `Item Code,Item Name\n,No Code\nM001,Has Code`;
    const r = adaptMargItemMasterCsv(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.warnings.some((w) => /Row 2/.test(w))).toBe(true);
  });

  it("empty CSV → empty rows + warning", () => {
    const r = adaptMargItemMasterCsv("");
    expect(r.rows).toHaveLength(0);
    expect(r.warnings).toContain("empty CSV");
  });
});

describe("adaptMargCustomerCsv", () => {
  it("parses customer master", () => {
    const csv = `Customer Code,Customer Name,Phone,GSTIN,Address,Balance
C001,Asha Iyer,9876543210,,123 Main St,500
C002,Rajesh,9999988888,27ABCDE1234F1Z5,Park Ave,0`;
    const r = adaptMargCustomerCsv(csv);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]?.fields["name"]).toBe("Asha Iyer");
    expect(r.rows[0]?.fields["balanceDuePaise"]).toBe(50000);
    expect(r.rows[1]?.fields["gstin"]).toBe("27ABCDE1234F1Z5");
  });
});

describe("adaptTallyXml", () => {
  const sample = `<?xml version="1.0"?>
<TALLYDATA>
  <LEDGER NAME="Walk-in Customer">
    <PARENT>Sundry Debtors</PARENT>
    <LEDGERPHONE>9876543210</LEDGERPHONE>
    <PARTYGSTIN></PARTYGSTIN>
  </LEDGER>
  <LEDGER NAME="Pharmarack Mumbai">
    <PARENT>Sundry Creditors</PARENT>
    <PARTYGSTIN>27ABCDE1234F1Z5</PARTYGSTIN>
  </LEDGER>
  <VOUCHER VCHTYPE="Sales">
    <DATE>20260415</DATE>
    <VOUCHERNUMBER>B-001</VOUCHERNUMBER>
    <PARTYLEDGERNAME>Walk-in Customer</PARTYLEDGERNAME>
    <AMOUNT>1234.50</AMOUNT>
  </VOUCHER>
  <VOUCHER VCHTYPE="Purchase">
    <DATE>20260410</DATE>
    <VOUCHERNUMBER>INV-101</VOUCHERNUMBER>
    <PARTYLEDGERNAME>Pharmarack Mumbai</PARTYLEDGERNAME>
    <AMOUNT>-5500.00</AMOUNT>
  </VOUCHER>
</TALLYDATA>`;

  it("extracts ledgers as customers + suppliers", () => {
    const r = adaptTallyXml(sample);
    expect(r.vendor).toBe("tally");
    const cust = r.rows.find((x) => x.kind === "customer" && x.fields["name"] === "Walk-in Customer");
    const supp = r.rows.find((x) => x.kind === "supplier" && x.fields["name"] === "Pharmarack Mumbai");
    expect(cust).toBeDefined();
    expect(supp).toBeDefined();
    expect(cust?.fields["phone"]).toBe("9876543210");
    expect(supp?.fields["gstin"]).toBe("27ABCDE1234F1Z5");
  });

  it("extracts vouchers as bills + purchases", () => {
    const r = adaptTallyXml(sample);
    const sale = r.rows.find((x) => x.kind === "bill" && x.fields["billNo"] === "B-001");
    const purch = r.rows.find((x) => x.kind === "purchase" && x.fields["billNo"] === "INV-101");
    expect(sale?.fields["totalPaise"]).toBe(123450);
    expect(purch?.fields["totalPaise"]).toBe(550000);          // abs value
    expect(sale?.fields["billedAt"]).toBe("2026-04-15");
  });
});

describe("adaptVyaparItemCsv", () => {
  it("parses Vyapar item export with HSN + tax", () => {
    const csv = `Item Name,Item Code,Sale Price,MRP,Purchase Price,HSN,Tax %,Stock
Crocin 500mg,V001,42,45,38,30049099,5,150`;
    const r = adaptVyaparItemCsv(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.fields["salePricePaise"]).toBe(4200);
    expect(r.rows[0]?.fields["mrpPaise"]).toBe(4500);
    expect(r.rows[0]?.fields["gstRate"]).toBe(5);
  });
});

describe("adaptMedeilDrugCsv", () => {
  it("parses Medeil drug master", () => {
    const csv = `Drug ID,Drug Name,Generic Name,Manufacturer,Schedule,HSN,MRP,Stock,Pack
D001,Crocin 500mg,Paracetamol,GSK,H,30049099,45,150,15 tab
D002,Tramadol 50mg,Tramadol,Cipla,H1,30049099,180,50,10 tab`;
    const r = adaptMedeilDrugCsv(csv);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]?.fields["genericName"]).toBe("Paracetamol");
    expect(r.rows[1]?.fields["schedule"]).toBe("H1");
  });
});

describe("adaptGenericCsv", () => {
  it("user maps columns to canonical fields", () => {
    const csv = `MyID,MyName,MyPrice
X1,Widget A,100
X2,Widget B,250`;
    const r = adaptGenericCsv(csv, {
      externalIdColumn: "MyID",
      kind: "product",
      fields: { name: "MyName", mrpPaise: "MyPrice" },
    });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]?.externalId).toBe("X1");
    expect(r.rows[0]?.fields["name"]).toBe("Widget A");
    expect(r.rows[0]?.fields["mrpPaise"]).toBe(10000);
  });
});

describe("planImport", () => {
  it("counts inserts when no probe given", async () => {
    const src = adaptMargItemMasterCsv(`Item Code,Item Name\nM1,X\nM2,Y`);
    const plan = await planImport(src);
    expect(plan.insertCount).toBe(2);
    expect(plan.skipCount).toBe(0);
    expect(plan.summary["product"]).toBe(2);
  });

  it("differentiates inserts vs updates with probe", async () => {
    const src = adaptMargItemMasterCsv(`Item Code,Item Name\nM1,X\nM2,Y`);
    const probe: ExistingRowProbe = {
      async exists(_kind, externalId) { return externalId === "M1"; },
    };
    const plan = await planImport(src, probe);
    expect(plan.insertCount).toBe(1);          // M2 is new
    expect(plan.updateCount).toBe(1);          // M1 exists
  });

  it("skips invalid rows (e.g. customer without name)", async () => {
    const csv = `Customer Code,Customer Name\nC1,\nC2,Real Person`;
    const src = adaptMargCustomerCsv(csv);
    const plan = await planImport(src);
    expect(plan.insertCount).toBe(1);             // C2 only
    expect(plan.skipCount).toBe(0);               // C1 was filtered at parse stage already
  });
});

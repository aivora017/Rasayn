import { describe, it, expect } from "vitest";
import {
  buildVoucherXml, buildTallyXml, buildZohoBooksCsv, buildQuickBooksIIF,
  billToSalesVoucher, escapeXml, tallyDate, paiseToTallyAmount, assertBalanced,
  UnbalancedVoucherError,
  type TallyVoucher,
} from "./index.js";
import { paise } from "@pharmacare/shared-types";

describe("escapeXml", () => {
  it("escapes 5 special chars", () => {
    expect(escapeXml(`<a> & "b" 'c'`)).toBe("&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos;");
  });
  it("leaves regular text alone", () => {
    expect(escapeXml("Crocin 500 mg")).toBe("Crocin 500 mg");
  });
});

describe("tallyDate", () => {
  it("converts YYYY-MM-DD → YYYYMMDD", () => {
    expect(tallyDate("2026-04-28")).toBe("20260428");
  });
  it("preserves YYYYMMDD", () => {
    expect(tallyDate("20260428")).toBe("20260428");
  });
  it("converts Date instance", () => {
    expect(tallyDate(new Date(2026, 3, 28))).toBe("20260428");
  });
  it("rejects garbage", () => {
    expect(() => tallyDate("not a date")).toThrow();
  });
});

describe("paiseToTallyAmount", () => {
  it("formats positive paise to rupees.paise", () => {
    expect(paiseToTallyAmount(12345)).toBe("123.45");
  });
  it("formats negative paise with sign", () => {
    expect(paiseToTallyAmount(-5000)).toBe("-50.00");
  });
  it("zero → 0.00", () => {
    expect(paiseToTallyAmount(0)).toBe("0.00");
  });
});

describe("assertBalanced", () => {
  it("balanced voucher passes", () => {
    const v: TallyVoucher = {
      date: "20260428", voucherType: "Sales", voucherNumber: "B1", party: "Cust",
      entries: [
        { ledgerName: "Cust", amountPaise: paise(11000), isDebit: true },
        { ledgerName: "Sales", amountPaise: paise(10000), isDebit: false },
        { ledgerName: "Output CGST", amountPaise: paise(500), isDebit: false },
        { ledgerName: "Output SGST", amountPaise: paise(500), isDebit: false },
      ],
    };
    expect(() => assertBalanced(v)).not.toThrow();
  });
  it("unbalanced voucher throws UnbalancedVoucherError", () => {
    const v: TallyVoucher = {
      date: "20260428", voucherType: "Sales", voucherNumber: "BX", party: "Cust",
      entries: [
        { ledgerName: "Cust", amountPaise: paise(10000), isDebit: true },
        { ledgerName: "Sales", amountPaise: paise(9000), isDebit: false },
      ],
    };
    expect(() => assertBalanced(v)).toThrow(UnbalancedVoucherError);
  });
});

describe("buildVoucherXml", () => {
  const v: TallyVoucher = {
    date: "2026-04-28", voucherType: "Sales", voucherNumber: "BILL-001",
    party: "Walk-in Customer", narration: "OTC sale",
    entries: [
      { ledgerName: "Walk-in Customer", amountPaise: paise(11000), isDebit: true,
        billAllocation: { billName: "BILL-001", amountPaise: paise(11000) } },
      { ledgerName: "Sales — Pharmacy 5%", amountPaise: paise(10000), isDebit: false },
      { ledgerName: "Output CGST", amountPaise: paise(500), isDebit: false },
      { ledgerName: "Output SGST", amountPaise: paise(500), isDebit: false },
    ],
  };

  it("contains DATE in YYYYMMDD", () => {
    expect(buildVoucherXml(v)).toContain("<DATE>20260428</DATE>");
  });
  it("contains escaped voucher number", () => {
    const v2 = { ...v, voucherNumber: "B&L<01>" };
    expect(buildVoucherXml(v2)).toContain("B&amp;L&lt;01&gt;");
  });
  it("emits ALLLEDGERENTRIES.LIST per entry", () => {
    const xml = buildVoucherXml(v);
    expect((xml.match(/<ALLLEDGERENTRIES\.LIST>/g) ?? []).length).toBe(4);
  });
  it("debit entry has ISDEEMEDPOSITIVE Yes", () => {
    const xml = buildVoucherXml(v);
    expect(xml).toContain("<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>");
    expect(xml).toContain("<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>");
  });
  it("credit entry has negative AMOUNT", () => {
    const xml = buildVoucherXml(v);
    // SGST credit ₹5 → -5.00
    expect(xml).toContain("<AMOUNT>-5.00</AMOUNT>");
  });
  it("includes BILLALLOCATIONS.LIST when set", () => {
    expect(buildVoucherXml(v)).toContain("<BILLALLOCATIONS.LIST>");
  });
});

describe("buildTallyXml — full envelope", () => {
  it("wraps with ENVELOPE/HEADER/BODY/IMPORTDATA", () => {
    const xml = buildTallyXml([], "TestCo");
    expect(xml).toContain("<ENVELOPE>");
    expect(xml).toContain("<TALLYREQUEST>Import Data</TALLYREQUEST>");
    expect(xml).toContain("<SVCURRENTCOMPANY>TestCo</SVCURRENTCOMPANY>");
    expect(xml).toContain("</ENVELOPE>");
  });
  it("starts with XML declaration", () => {
    expect(buildTallyXml([])).toMatch(/^<\?xml version="1\.0"/);
  });
});

describe("buildZohoBooksCsv", () => {
  it("emits header row + one data row per voucher", () => {
    const csv = buildZohoBooksCsv([{
      date: "20260428", voucherType: "Sales", voucherNumber: "B1", party: "Acme",
      entries: [
        { ledgerName: "Acme", amountPaise: paise(15000), isDebit: true },
        { ledgerName: "Sales", amountPaise: paise(15000), isDebit: false },
      ],
    }]);
    const rows = csv.split("\n");
    expect(rows[0]).toBe("Invoice Date,Invoice Number,Customer Name,Voucher Type,Total,Notes");
    expect(rows[1]).toContain("2026-04-28");
    expect(rows[1]).toContain("B1");
    expect(rows[1]).toContain("Acme");
    expect(rows[1]).toContain("150.00");
  });
  it("escapes commas + quotes in customer names", () => {
    const csv = buildZohoBooksCsv([{
      date: "20260428", voucherType: "Sales", voucherNumber: "B1",
      party: 'Sharma, "Mr." & Co',
      entries: [
        { ledgerName: "Sharma", amountPaise: paise(100), isDebit: true },
        { ledgerName: "Sales", amountPaise: paise(100), isDebit: false },
      ],
    }]);
    expect(csv).toContain('"Sharma, ""Mr."" & Co"');
  });
});

describe("buildQuickBooksIIF", () => {
  it("emits headers + TRNS/SPL/ENDTRNS pattern", () => {
    const iif = buildQuickBooksIIF([{
      date: "20260428", voucherType: "Sales", voucherNumber: "B1", party: "Cust",
      entries: [
        { ledgerName: "Cust", amountPaise: paise(10000), isDebit: true },
        { ledgerName: "Sales", amountPaise: paise(10000), isDebit: false },
      ],
    }]);
    expect(iif).toContain("!TRNS");
    expect(iif).toContain("!SPL");
    expect(iif).toMatch(/TRNS\t2026-04-28/);
    expect(iif).toContain("ENDTRNS");
  });
});

describe("billToSalesVoucher — convenience", () => {
  it("emits a balanced sales voucher with GST split", () => {
    const v = billToSalesVoucher({
      billNo: "B1", billedAt: "2026-04-28T11:00:00Z",
      customerLedgerName: "Walk-in Customer",
      grandTotalPaise: paise(11000),
      cgstPaise: paise(500), sgstPaise: paise(500),
      igstPaise: paise(0), cessPaise: paise(0),
      salesLedgerName: "Sales — Pharmacy 5%",
    });
    expect(() => assertBalanced(v)).not.toThrow();
    expect(v.entries[0]?.isDebit).toBe(true);
    expect(v.entries.some((e) => e.ledgerName === "Output CGST")).toBe(true);
    expect(v.entries.some((e) => e.ledgerName === "Output SGST")).toBe(true);
  });
  it("inter-state — uses IGST only, no CGST/SGST entries", () => {
    const v = billToSalesVoucher({
      billNo: "B2", billedAt: "2026-04-28",
      customerLedgerName: "Cust",
      grandTotalPaise: paise(11000),
      cgstPaise: paise(0), sgstPaise: paise(0),
      igstPaise: paise(1000), cessPaise: paise(0),
      salesLedgerName: "Sales IGST 12%",
    });
    expect(() => assertBalanced(v)).not.toThrow();
    expect(v.entries.some((e) => e.ledgerName === "Output IGST")).toBe(true);
    expect(v.entries.every((e) => e.ledgerName !== "Output CGST")).toBe(true);
  });
  it("zero-tax (exempt drug) — only customer + sales entries", () => {
    const v = billToSalesVoucher({
      billNo: "B3", billedAt: "2026-04-28",
      customerLedgerName: "Cust",
      grandTotalPaise: paise(10000),
      cgstPaise: paise(0), sgstPaise: paise(0),
      igstPaise: paise(0), cessPaise: paise(0),
      salesLedgerName: "Sales — Exempt",
    });
    expect(v.entries).toHaveLength(2);
    expect(() => assertBalanced(v)).not.toThrow();
  });
});

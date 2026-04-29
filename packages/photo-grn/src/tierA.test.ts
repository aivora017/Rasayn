import { describe, expect, it } from "vitest";
import { tierA } from "./tierA.js";
import { photoToGrnFromText } from "./index.js";

const SAMPLE_BHARAT = `BHARAT PHARMA DISTRIBUTORS
Pune · GSTIN 27AAAAA0000A1Z5
Invoice No: BPD/26-27/00482
Date: 15-04-2026

Item                              Qty   Rate     Amount
Paracetamol 500mg Tab             100   1.20     120.00
Amoxicillin 250mg Cap              50   2.50     125.00
Crocin Cold & Flu Tab              30   3.50     105.00

Grand Total: 350.00`;

const SAMPLE_CIPLA = `CIPLA HEALTHCARE
Mumbai
Bill #: CIP-2026-0991
Inv Date: 02/05/2026

Insulin NovoMix 30 Pen            10   450.00   4500.00
Atorvastatin 10mg                  60    8.00    480.00

Total Amount: 4980.00`;

const SAMPLE_GARBAGE = `RANDOM NOISE TEXT
no fields here
just blah blah blah`;

const SAMPLE_PARTIAL = `MEDICOS DISTRIBUTORS
Some random preamble.
Bill # ABC-99/Q3-7
Paracetamol 500mg                100  1.20   120.00`;

describe("photo-grn Tier-A regex", () => {
  it("extracts header + 3 lines from BHARAT sample", () => {
    const { bill, tierConfidence } = tierA(SAMPLE_BHARAT);
    expect(bill.header.invoiceNo).toMatch(/BPD/);
    expect(bill.header.invoiceDate).toBe("2026-04-15");
    expect(bill.header.supplierHint).toMatch(/BHARAT PHARMA/);
    expect(bill.header.totalPaise).toBe(35000);
    expect(bill.lines.length).toBeGreaterThanOrEqual(3);
    expect(bill.lines[0]?.productHint).toMatch(/Paracetamol/i);
    expect(bill.lines[0]?.qty).toBe(100);
    expect(bill.lines[0]?.ratePaise).toBe(120);
    expect(tierConfidence).toBeGreaterThan(0.8);
  });

  it("extracts header + 2 lines from CIPLA sample", () => {
    const { bill, tierConfidence } = tierA(SAMPLE_CIPLA);
    expect(bill.header.invoiceNo).toMatch(/CIP/);
    expect(bill.header.invoiceDate).toBe("2026-05-02");
    expect(bill.header.totalPaise).toBe(498000);
    expect(bill.lines.length).toBeGreaterThanOrEqual(2);
    expect(tierConfidence).toBeGreaterThan(0.6);
  });

  it("returns low confidence for random garbage", () => {
    const { tierConfidence, bill } = tierA(SAMPLE_GARBAGE);
    expect(tierConfidence).toBeLessThan(0.5);
    expect(bill.lines.length).toBe(0);
  });

  it("tolerates partial header but still extracts 1 line", () => {
    const { bill, tierConfidence } = tierA(SAMPLE_PARTIAL);
    expect(bill.lines.length).toBeGreaterThanOrEqual(1);
    expect(tierConfidence).toBeLessThan(0.9);
    expect(tierConfidence).toBeGreaterThan(0.2);
  });

  it("photoToGrnFromText flags requiresOperatorReview below threshold", () => {
    const garbage = photoToGrnFromText(SAMPLE_GARBAGE);
    expect(garbage.requiresOperatorReview).toBe(true);

    const good = photoToGrnFromText(SAMPLE_BHARAT);
    expect(good.bill.lines.length).toBeGreaterThanOrEqual(3);
    expect(good.requiresOperatorReview).toBe(false);
  });

  it("rejects line where qty*rate doesn't match amount within 5%", () => {
    const bad = `BAD VENDOR
Invoice No: X1
Date: 01/01/2026
Item                            Qty   Rate    Amount
Aspirin 75mg                    10    1.00    99.00

Grand Total: 99.00`;
    const { bill } = tierA(bad);
    // 10 * 1 = 10, vs 99 -> 89% diff, should reject the line
    expect(bill.lines.length).toBe(0);
  });
});

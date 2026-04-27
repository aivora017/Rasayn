/**
 * A8 / ADR 0021 step 5 — Credit-note layout tests.
 *
 * Asserts both thermal 80mm and A5 GST renders produce a self-contained,
 * signed-off HTML document with all the legally-required content
 * (CGST §34 + Rule 53 reference, original invoice ref, refund pro-rata
 * tax breakdown, amount-in-words, IRN block when present).
 */

import { describe, expect, it } from "vitest";
import {
  renderCreditNoteHtml,
  resolveCreditNoteLayout,
  type CreditNoteFull,
} from "./index.js";
import { makeCreditNote, makeCreditNoteLine, makeCustomerFull } from "./fixtures.js";

function html(cn: CreditNoteFull, layout?: "thermal_80mm" | "a5_gst"): string {
  return renderCreditNoteHtml({ creditNote: cn, ...(layout ? { layout } : {}) });
}

describe("renderCreditNoteHtml", () => {
  it("auto-selects thermal_80mm when customer has no GSTIN", () => {
    const cn = makeCreditNote();
    expect(resolveCreditNoteLayout(cn)).toBe("thermal_80mm");
    const out = html(cn);
    expect(out).toMatch(/size: 80mm auto/);
    expect(out).toMatch(/CREDIT NOTE/);
  });

  it("auto-selects a5_gst when customer has a GSTIN", () => {
    const cn = makeCreditNote({
      customer: makeCustomerFull({ name: "Apollo Pharmacy", gstin: "27AAAAA0000A1Z5" }),
    });
    expect(resolveCreditNoteLayout(cn)).toBe("a5_gst");
    const out = html(cn);
    expect(out).toMatch(/size: A5 portrait/);
    expect(out).toMatch(/Tax Invoice|Credit Note CN/);
    expect(out).toMatch(/27AAAAA0000A1Z5/);
  });

  it("layout override forces the requested layout regardless of buyer", () => {
    const cn = makeCreditNote({
      customer: makeCustomerFull({ gstin: "27AAAAA0000A1Z5" }),
    });
    expect(html(cn, "thermal_80mm")).toMatch(/size: 80mm auto/);
    expect(html(cn, "a5_gst")).toMatch(/size: A5 portrait/);
  });

  it("thermal: shows return number, original invoice ref, reason, refund total, words", () => {
    const cn = makeCreditNote();
    const out = html(cn);
    expect(out).toMatch(/CN\/2025-26\/0001/);
    expect(out).toMatch(/B-00021/);
    expect(out).toMatch(/Customer changed mind/);
    // Refund total ₹2.20 from the default fixture (220 paise)
    expect(out).toMatch(/REFUND/);
    expect(out).toMatch(/2\.20/);
    // amount-in-words inserted on the grand total
    expect(out).toMatch(/Two/i);
  });

  it("a5: tax breakdown table includes Refund column, HSN summary, signatory", () => {
    const cn = makeCreditNote({
      customer: makeCustomerFull({ gstin: "27AAAAA0000A1Z5" }),
    });
    const out = html(cn, "a5_gst");
    expect(out).toMatch(/<th[^>]*>Refund<\/th>/);
    expect(out).toMatch(/<th[^>]*>HSN<\/th>/);
    expect(out).toMatch(/Authorised signatory/);
    // Section 34 + Rule 53 footer reference (legal requirement)
    expect(out).toMatch(/section 34/i);
    expect(out).toMatch(/Rule 53/i);
  });

  it("renders Schedule H tag inline when a returned line is Schedule H", () => {
    const cn = makeCreditNote({
      lines: [
        makeCreditNoteLine({
          productName: "Azee 500 Tab",
          schedule: "H",
          reasonCode: "doctor_changed_rx",
        }),
      ],
    });
    const out = html(cn);
    expect(out).toMatch(/Azee 500 Tab \[H\]/);
    // Reason code surfaced inline
    expect(out).toMatch(/doctor_changed_rx/);
  });

  it("IRN block is present when creditNoteIrn is set, absent otherwise", () => {
    const withoutIrn = html(makeCreditNote());
    expect(withoutIrn).not.toMatch(/IRN: /);

    const withIrn = html(
      makeCreditNote({
        creditNote: {
          ...makeCreditNote().creditNote,
          creditNoteIrn: "irn1234567890abcdef".repeat(3),
          creditNoteAckNo: "112400123456789",
          creditNoteAckDate: "2026-04-17",
        },
      }),
    );
    expect(withIrn).toMatch(/IRN/);
    expect(withIrn).toMatch(/112400123456789/);
  });

  it("multi-line credit note renders one row per line with running serial", () => {
    const cn = makeCreditNote({
      customer: makeCustomerFull({ gstin: "27AAAAA0000A1Z5" }),
      lines: [
        makeCreditNoteLine({ id: "l1", productName: "Crocin 500 Tab", refundAmountPaise: 1200 }),
        makeCreditNoteLine({ id: "l2", productName: "Dolo 650 Tab", refundAmountPaise: 800 }),
        makeCreditNoteLine({ id: "l3", productName: "Combiflam Tab", refundAmountPaise: 600 }),
      ],
    });
    const out = html(cn, "a5_gst");
    expect(out).toMatch(/Crocin 500/);
    expect(out).toMatch(/Dolo 650/);
    expect(out).toMatch(/Combiflam/);
    // Three serial cells (1, 2, 3) inside <td class="c">
    const serials = out.match(/<td class="c">[1-3]<\/td>/g) ?? [];
    expect(serials.length).toBeGreaterThanOrEqual(3);
  });

  it("reprint banner shows when printReceipt.isDuplicate === 1", () => {
    const cn = makeCreditNote();
    const out = renderCreditNoteHtml({
      creditNote: cn,
      printReceipt: {
        id: "pr_1",
        billId: "bill_1",
        layout: "thermal_80mm",
        isDuplicate: 1,
        printCount: 2,
        stampedAt: "2026-04-17T15:00:00.000Z",
      },
    });
    expect(out).toMatch(/DUPLICATE — REPRINT/);
  });

  it("escapes HTML metacharacters in operator-entered fields (XSS guard)", () => {
    const cn = makeCreditNote({
      creditNote: {
        ...makeCreditNote().creditNote,
        reason: "<script>alert(1)</script>",
      },
    });
    const out = html(cn);
    expect(out).not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(out).toMatch(/&lt;script&gt;/);
  });
});

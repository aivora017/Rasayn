import { describe, it, expect } from "vitest";
import {
  normalizeIndianPhone, buildWhatsAppLink, buildInvoiceText,
  buildUpiPayLink, isValidVpa, buildUpiQrData, PHARMACY_MCC,
  buildTelLink, buildMailtoLink,
  buildInvoiceShareLinks,
  InvalidPhoneError, InvalidVpaError,
} from "./index.js";
import { paise } from "@pharmacare/shared-types";

describe("normalizeIndianPhone", () => {
  it("10-digit → 91 prefix", () => { expect(normalizeIndianPhone("9876543210")).toBe("919876543210"); });
  it("strips spaces + hyphens", () => { expect(normalizeIndianPhone("+91 98765-43210")).toBe("919876543210"); });
  it("already +91 form", () => { expect(normalizeIndianPhone("+919876543210")).toBe("919876543210"); });
  it("rejects non-Indian", () => {
    expect(() => normalizeIndianPhone("12345")).toThrow(InvalidPhoneError);
    expect(() => normalizeIndianPhone("not a phone")).toThrow(InvalidPhoneError);
  });
});

describe("buildWhatsAppLink", () => {
  it("generates wa.me deep link with encoded text", () => {
    const link = buildWhatsAppLink({ toPhone: "9876543210", text: "Hello & welcome!" });
    expect(link).toBe("https://wa.me/919876543210?text=Hello%20%26%20welcome!");
  });
  it("handles emoji in text", () => {
    const link = buildWhatsAppLink({ toPhone: "9876543210", text: "₹100 ✓" });
    expect(link).toContain("%E2%82%B9100");          // ₹ encoded
  });
});

describe("buildInvoiceText", () => {
  it("includes shop, bill no, and rupee total", () => {
    const t = buildInvoiceText({
      shopName: "Jagannath Pharmacy",
      billNo: "B-001",
      billedAt: "2026-04-28T11:00:00Z",
      grandTotalPaise: paise(12345),
    });
    expect(t).toContain("Jagannath Pharmacy");
    expect(t).toContain("B-001");
    expect(t).toContain("₹123.45");
  });
  it("embeds UPI link when supplied", () => {
    const t = buildInvoiceText({
      shopName: "JP", billNo: "B1", billedAt: "2026-04-28T11:00:00Z",
      grandTotalPaise: paise(10000),
      upiPayLink: "upi://pay?pa=jp@hdfc",
    });
    expect(t).toContain("upi://pay?pa=jp@hdfc");
  });
});

describe("UPI VPA validation", () => {
  it("accepts valid VPAs", () => {
    expect(isValidVpa("jagannath@hdfc")).toBe(true);
    expect(isValidVpa("test.user@okaxis")).toBe(true);
    expect(isValidVpa("merchant_01@ybl")).toBe(true);
  });
  it("rejects invalid VPAs", () => {
    expect(isValidVpa("nope")).toBe(false);
    expect(isValidVpa("a@1")).toBe(false);                // bank code must be letters ≥2
    expect(isValidVpa("@hdfc")).toBe(false);
  });
});

describe("buildUpiPayLink", () => {
  it("emits canonical upi:// URI with all fields", () => {
    const link = buildUpiPayLink({
      payeeVpa: "jagannath@hdfc",
      payeeName: "Jagannath Pharmacy LLP",
      amountPaise: paise(12345),
      transactionRef: "B-001",
      transactionNote: "Bill B-001",
      merchantCode: PHARMACY_MCC,
    });
    expect(link).toMatch(/^upi:\/\/pay\?/);
    expect(link).toContain("pa=jagannath%40hdfc");      // @ encoded
    expect(link).toContain("am=123.45");
    expect(link).toContain("cu=INR");
    expect(link).toContain("tr=B-001");
    expect(link).toContain("mc=5912");
  });
  it("'any amount' QR — omits am param when amount is undefined", () => {
    const link = buildUpiPayLink({
      payeeVpa: "jagannath@hdfc",
      payeeName: "Jagannath",
    });
    expect(link).not.toContain("am=");
  });
  it("rejects invalid VPA", () => {
    expect(() => buildUpiPayLink({ payeeVpa: "bad", payeeName: "JP" })).toThrow(InvalidVpaError);
  });
  it("rejects transactionRef > 35 chars", () => {
    expect(() => buildUpiPayLink({
      payeeVpa: "jp@hdfc", payeeName: "JP",
      transactionRef: "A".repeat(40),
    })).toThrow(/transactionRef too long/);
  });
  it("truncates note > 50 chars (silent)", () => {
    const link = buildUpiPayLink({
      payeeVpa: "jp@hdfc", payeeName: "JP",
      transactionNote: "A".repeat(80),
    });
    const tn = new URL(link.replace("upi://", "http://x/")).searchParams.get("tn");
    expect(tn?.length).toBe(50);
  });
});

describe("buildUpiQrData", () => {
  it("returns payload + cache key + ECC level", () => {
    const q = buildUpiQrData({ payeeVpa: "jp@hdfc", payeeName: "JP", amountPaise: paise(100) });
    expect(q.payload).toMatch(/^upi:\/\//);
    expect(q.key).toMatch(/^[0-9a-f]{8}$/);
    expect(q.errorCorrection).toBe("Q");
  });
  it("identical args → identical key (deterministic)", () => {
    const a = buildUpiQrData({ payeeVpa: "jp@hdfc", payeeName: "JP", amountPaise: paise(100) });
    const b = buildUpiQrData({ payeeVpa: "jp@hdfc", payeeName: "JP", amountPaise: paise(100) });
    expect(a.key).toBe(b.key);
  });
  it("different args → different keys", () => {
    const a = buildUpiQrData({ payeeVpa: "jp@hdfc", payeeName: "JP", amountPaise: paise(100) });
    const b = buildUpiQrData({ payeeVpa: "jp@hdfc", payeeName: "JP", amountPaise: paise(200) });
    expect(a.key).not.toBe(b.key);
  });
});

describe("buildTelLink", () => {
  it("generates tel:+91… link", () => {
    expect(buildTelLink("9876543210")).toBe("tel:+919876543210");
  });
});

describe("buildMailtoLink", () => {
  it("with subject + body", () => {
    expect(buildMailtoLink({ to: "x@y.com", subject: "Hi", body: "Body" }))
      .toBe("mailto:x@y.com?subject=Hi&body=Body");
  });
  it("plain mailto when no params", () => {
    expect(buildMailtoLink({ to: "x@y.com" })).toBe("mailto:x@y.com");
  });
});

describe("buildInvoiceShareLinks — orchestrator", () => {
  it("generates all artefacts when full input provided", () => {
    const r = buildInvoiceShareLinks({
      shopName: "Jagannath Pharmacy",
      billNo: "B-001",
      billedAt: "2026-04-28T11:00:00Z",
      grandTotalPaise: paise(12345),
      customerPhone: "9876543210",
      customerEmail: "customer@example.com",
      upi: { vpa: "jagannath@hdfc", payeeName: "Jagannath Pharmacy LLP" },
    });
    expect(r.whatsAppLink).toBeTruthy();
    expect(r.upiPayLink).toBeTruthy();
    expect(r.upiQr).toBeTruthy();
    expect(r.telLink).toBeTruthy();
    expect(r.mailtoLink).toBeTruthy();
    expect(r.invoiceText).toContain("upi://");
  });
  it("only invoiceText when no contact info given", () => {
    const r = buildInvoiceShareLinks({
      shopName: "Jagannath", billNo: "B1",
      billedAt: "2026-04-28T11:00:00Z",
      grandTotalPaise: paise(100),
    });
    expect(r.whatsAppLink).toBeUndefined();
    expect(r.upiPayLink).toBeUndefined();
    expect(r.invoiceText).toBeTruthy();
  });
});

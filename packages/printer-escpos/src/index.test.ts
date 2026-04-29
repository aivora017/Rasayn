import { describe, it, expect, beforeEach } from "vitest";
import {
  ESCPOS_INIT,
  ESCPOS_BOLD_ON,
  ESCPOS_CUT,
  escposJustify,
  escposTextSize,
  escposFeed,
  escposText,
  escposQrCode,
  escposBarcode128,
  concatBytes,
  buildReceipt,
  buildLabelZpl,
  parseGs1Ais,
  setPrinterTransport,
  printRaw,
  pulseCashDrawer,
  type ReceiptInput,
  type PrinterTransport,
} from "./index.js";

describe("ESC/POS opcodes", () => {
  it("INIT is ESC @ (1B 40)", () => {
    expect(Array.from(ESCPOS_INIT)).toEqual([0x1b, 0x40]);
  });
  it("BOLD_ON is ESC E 1 (1B 45 01)", () => {
    expect(Array.from(ESCPOS_BOLD_ON)).toEqual([0x1b, 0x45, 0x01]);
  });
  it("CUT is GS V 0 (1D 56 00)", () => {
    expect(Array.from(ESCPOS_CUT)).toEqual([0x1d, 0x56, 0x00]);
  });
  it("justify(2) right-aligns", () => {
    expect(Array.from(escposJustify(2))).toEqual([0x1b, 0x61, 0x02]);
  });
  it("textSize(17) sets 2x both", () => {
    expect(Array.from(escposTextSize(17))).toEqual([0x1d, 0x21, 0x11]);
  });
  it("feed clamps to 255", () => {
    expect(Array.from(escposFeed(99999))).toEqual([0x1b, 0x64, 255]);
  });
  it("feed clamps negative to 0", () => {
    expect(Array.from(escposFeed(-5))).toEqual([0x1b, 0x64, 0]);
  });
});

describe("escposText", () => {
  it("encodes ASCII", () => {
    expect(Array.from(escposText("ABC"))).toEqual([0x41, 0x42, 0x43]);
  });
  it("encodes UTF-8 (Hindi)", () => {
    const bytes = escposText("नमस्ते");
    // Devanagari "ना" starts with 0xE0 0xA4 (UTF-8 prefix)
    expect(bytes[0]).toBe(0xe0);
  });
});

describe("escposQrCode", () => {
  it("emits the model + size + EC + store + print sequence", () => {
    const bytes = escposQrCode("https://rasayn.in", { size: 4, errorCorrection: "H" });
    // Should contain GS ( k header (1D 28 6B) at least 5 times
    let count = 0;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x1d && bytes[i + 1] === 0x28 && bytes[i + 2] === 0x6b) count++;
    }
    expect(count).toBeGreaterThanOrEqual(5);
  });
});

describe("escposBarcode128", () => {
  it("emits height + width + HRI + barcode header", () => {
    const bytes = escposBarcode128("8901234567890", 60);
    // bytes[0..3] = GS h 60
    expect(Array.from(bytes.slice(0, 3))).toEqual([0x1d, 0x68, 60]);
    // The barcode body should contain the data bytes verbatim somewhere
    const txt = new TextDecoder().decode(bytes);
    expect(txt).toContain("8901234567890");
  });
});

describe("concatBytes", () => {
  it("concatenates Uint8Arrays preserving order", () => {
    const out = concatBytes([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("buildReceipt", () => {
  const minimal: ReceiptInput = {
    header: {
      shopName: "Jagannath Pharmacy",
      addressLines: ["Kalyan, Maharashtra"],
      gstin: "27AAAAA0000A1Z5",
    },
    invoiceNo: "JP/2026-27/0001",
    billedAtIso: "2026-04-29T10:30:00.000Z",
    cashier: "Sourav",
    lines: [
      { name: "Paracetamol 500mg", qty: 10, mrp: 1.5, lineTotal: 15.0 },
      { name: "Crocin Advance", qty: 1, mrp: 28.0, lineTotal: 28.0 },
    ],
    totals: {
      subtotal: 43,
      discount: 0,
      taxableValue: 41,
      cgst: 1,
      sgst: 1,
      igst: 0,
      grandTotal: 43,
      roundOff: 0,
    },
  };

  it("starts with INIT and ends with CUT", () => {
    const bytes = buildReceipt(minimal);
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
    // last 3 bytes should be GS V 0
    const tail = bytes.slice(bytes.length - 3);
    expect(Array.from(tail)).toEqual([0x1d, 0x56, 0x00]);
  });

  it("includes shop name + GSTIN + invoice no + cashier", () => {
    const txt = new TextDecoder().decode(buildReceipt(minimal));
    expect(txt).toContain("JAGANNATH PHARMACY");
    expect(txt).toContain("27AAAAA0000A1Z5");
    expect(txt).toContain("JP/2026-27/0001");
    expect(txt).toContain("Sourav");
  });

  it("renders all line items", () => {
    const txt = new TextDecoder().decode(buildReceipt(minimal));
    expect(txt).toContain("Paracetamol 500mg");
    expect(txt).toContain("Crocin Advance");
  });

  it("renders TOTAL line", () => {
    const txt = new TextDecoder().decode(buildReceipt(minimal));
    expect(txt).toContain("TOTAL");
    expect(txt).toContain("43.00");
  });

  it("appends UPI QR when payload provided", () => {
    const bytes = buildReceipt({
      ...minimal,
      upiQrPayload: "upi://pay?pa=jagannath@hdfc&pn=Jagannath%20Pharmacy&am=43.00",
    });
    const txt = new TextDecoder().decode(bytes);
    expect(txt).toContain("Scan to pay");
  });

  it("respects width=32 (58mm paper)", () => {
    const bytes = buildReceipt({ ...minimal, width: 32 });
    const txt = new TextDecoder().decode(bytes);
    // separator line should be 32 dashes
    expect(txt).toMatch(/-{32}/);
    expect(txt).not.toMatch(/-{48}/);
  });
});

describe("buildLabelZpl", () => {
  it("emits ZPL ^XA / ^XZ envelope", () => {
    const bytes = buildLabelZpl({
      sku: "PCM500",
      barcode: "8901234567890",
      productName: "Paracetamol 500mg",
      priceRupees: 1.5,
    });
    const txt = new TextDecoder().decode(bytes);
    expect(txt.startsWith("^XA")).toBe(true);
    expect(txt.endsWith("^XZ")).toBe(true);
  });

  it("includes SKU + barcode + price", () => {
    const txt = new TextDecoder().decode(
      buildLabelZpl({
        sku: "PCM500",
        barcode: "8901234567890",
        productName: "Paracetamol 500mg",
        priceRupees: 1.5,
        batchNo: "B12345",
        expiry: "2027-04",
      }),
    );
    expect(txt).toContain("PCM500");
    expect(txt).toContain("8901234567890");
    expect(txt).toContain("1.50 INR");
    expect(txt).toContain("B12345");
    expect(txt).toContain("2027-04");
  });

  it("strips ^ and ~ from data fields to avoid breaking ZPL", () => {
    const txt = new TextDecoder().decode(
      buildLabelZpl({
        sku: "EVIL^^",
        barcode: "8901234~567890",
        productName: "Test^Drug",
        priceRupees: 1,
      }),
    );
    expect(txt).not.toContain("EVIL^^");
    expect(txt).not.toContain("Test^Drug");
  });
});

describe("parseGs1Ais (DataMatrix)", () => {
  const GS = "\x1d";

  it("parses GTIN + batch + expiry + serial (GS-separated)", () => {
    const raw = `0108901234567890` + `10B12345${GS}` + `17260415` + `21SN-001`;
    const decoded = parseGs1Ais(raw);
    expect(decoded?.gtin).toBe("08901234567890");
    expect(decoded?.batchNo).toBe("B12345");
    expect(decoded?.expiry).toBe("260415");
    expect(decoded?.serial).toBe("SN-001");
  });

  it("returns null when GTIN missing", () => {
    expect(parseGs1Ais("10B12345172604")).toBeNull();
  });

  it("treats serial as optional", () => {
    const decoded = parseGs1Ais(`0108901234567890` + `10B12345${GS}` + `17260415`);
    expect(decoded?.serial).toBe("");
  });

  it("parses continuous stream when batch terminates at a fixed-length AI", () => {
    const decoded = parseGs1Ais("0108901234567890" + "10B12345" + "17260415");
    expect(decoded?.gtin).toBe("08901234567890");
    expect(decoded?.batchNo).toBe("B12345");
    expect(decoded?.expiry).toBe("260415");
  });
});

describe("PrinterTransport injection", () => {
  beforeEach(() => {
    setPrinterTransport({
      discover: async () => [],
      write: async () => {},
    });
  });

  it("printRaw delegates to transport", async () => {
    let captured: Uint8Array | null = null;
    let capturedId = "";
    setPrinterTransport({
      discover: async () => [],
      write: async (id, bytes) => {
        capturedId = id;
        captured = bytes;
      },
    });
    await printRaw("printer_thermal_1", new Uint8Array([1, 2, 3]));
    expect(capturedId).toBe("printer_thermal_1");
    expect(captured).not.toBeNull();
    expect(Array.from(captured as unknown as Uint8Array)).toEqual([1, 2, 3]);
  });

  it("pulseCashDrawer pin 2 sends ESC p 0 50 250", async () => {
    let captured: Uint8Array | null = null;
    setPrinterTransport({
      discover: async () => [],
      write: async (_, b) => { captured = b; },
    });
    await pulseCashDrawer("printer_thermal_1", 2);
    expect(captured).not.toBeNull();
    expect(Array.from(captured as unknown as Uint8Array)).toEqual([0x1b, 0x70, 0x00, 0x32, 0xfa]);
  });

  it("pulseCashDrawer pin 5 sends ESC p 1 50 250", async () => {
    let captured: Uint8Array | null = null;
    setPrinterTransport({
      discover: async () => [],
      write: async (_, b) => { captured = b; },
    });
    await pulseCashDrawer("printer_thermal_1", 5);
    expect(captured).not.toBeNull();
    expect(Array.from(captured as unknown as Uint8Array)).toEqual([0x1b, 0x70, 0x01, 0x32, 0xfa]);
  });
});

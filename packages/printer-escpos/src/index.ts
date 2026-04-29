// @pharmacare/printer-escpos
// Pure ESC/POS command builder for thermal receipt printers (58mm + 80mm)
// and label-printer commands for barcode printers. Emits Uint8Array bytes;
// caller (Tauri sidecar / Web Serial / WebUSB) handles the actual write.
//
// Protocol references:
//   - Epson ESC/POS reference (covers TM-T81, TM-T82, RP-3230, Black Copper)
//   - ZPL II (Zebra GX420t / TSC TTP-244 / Argox barcode printers)
//   - GS1 DataMatrix (decoded by Tauri sidecar — interface here is decode-only)
//
// All exports are pure (no I/O) except the explicit *I/O ports* which
// throw if the caller hasn't injected a transport. Tests run end-to-end
// against the byte-stream; a real Tauri command writes the same bytes.

export type PrinterKind = "thermal-80mm" | "thermal-58mm" | "label-zpl" | "a4-laser" | "dot-matrix-schedX";
export type Connection = "usb" | "serial" | "ethernet" | "bluetooth";

export interface DiscoveredPrinter {
  readonly id: string;
  readonly kind: PrinterKind;
  readonly model: string;
  readonly connection: Connection;
  readonly cashDrawerCapable: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// ESC/POS opcodes — bytes only, no allocation cost beyond the Uint8Array.
// ────────────────────────────────────────────────────────────────────────

const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;

/** Initialize printer (clears formatting, motion). */
export const ESCPOS_INIT = new Uint8Array([ESC, 0x40]);

/** Bold on / off (ESC E n). */
export const ESCPOS_BOLD_ON  = new Uint8Array([ESC, 0x45, 0x01]);
export const ESCPOS_BOLD_OFF = new Uint8Array([ESC, 0x45, 0x00]);

/** Justify: 0=left, 1=center, 2=right. */
export function escposJustify(j: 0 | 1 | 2): Uint8Array {
  return new Uint8Array([ESC, 0x61, j]);
}

/** Text size: 0=normal, 1=2x width, 16=2x height, 17=2x both. */
export function escposTextSize(n: 0 | 1 | 16 | 17): Uint8Array {
  return new Uint8Array([GS, 0x21, n]);
}

/** Feed N lines (max 255). */
export function escposFeed(lines: number): Uint8Array {
  const n = Math.max(0, Math.min(255, Math.floor(lines)));
  return new Uint8Array([ESC, 0x64, n]);
}

/** Full cut (GS V 0). */
export const ESCPOS_CUT = new Uint8Array([GS, 0x56, 0x00]);

/** Partial cut (GS V 1). */
export const ESCPOS_CUT_PARTIAL = new Uint8Array([GS, 0x56, 0x01]);

/** Pulse cash drawer pin 2 (most common Indian setup). */
export const ESCPOS_DRAWER_PIN_2 = new Uint8Array([ESC, 0x70, 0x00, 0x32, 0xfa]);

/** Pulse cash drawer pin 5 (some Epson + Posiflex). */
export const ESCPOS_DRAWER_PIN_5 = new Uint8Array([ESC, 0x70, 0x01, 0x32, 0xfa]);

/** Encode UTF-8 text → bytes. */
export function escposText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Concat helper. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// QR code (GS ( k commands per Epson spec)
// ────────────────────────────────────────────────────────────────────────

export interface QrOptions {
  readonly model?: 1 | 2;          // QR model; 2 is the modern default
  readonly size?: number;          // module size 1..16
  readonly errorCorrection?: "L" | "M" | "Q" | "H";
}

export function escposQrCode(data: string, opts: QrOptions = {}): Uint8Array {
  const model = opts.model ?? 2;
  const size = Math.max(1, Math.min(16, opts.size ?? 6));
  const ecMap: Record<NonNullable<QrOptions["errorCorrection"]>, number> = {
    L: 48, M: 49, Q: 50, H: 51,
  };
  const ec = ecMap[opts.errorCorrection ?? "M"];
  const dataBytes = new TextEncoder().encode(data);
  const dataLen = dataBytes.length + 3;
  const pL = dataLen & 0xff;
  const pH = (dataLen >> 8) & 0xff;

  return concatBytes([
    new Uint8Array([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x30 + model, 0x00]),  // model
    new Uint8Array([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size]),                 // size
    new Uint8Array([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, ec]),                   // EC level
    new Uint8Array([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]),                     // store
    dataBytes,
    new Uint8Array([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),                 // print
  ]);
}

// ────────────────────────────────────────────────────────────────────────
// Code 128 barcode (GS k)
// ────────────────────────────────────────────────────────────────────────

export function escposBarcode128(data: string, height = 80): Uint8Array {
  const h = Math.max(1, Math.min(255, Math.floor(height)));
  const dataBytes = new TextEncoder().encode(data);
  return concatBytes([
    new Uint8Array([GS, 0x68, h]),                    // height
    new Uint8Array([GS, 0x77, 0x02]),                 // module width
    new Uint8Array([GS, 0x48, 0x02]),                 // HRI below barcode
    new Uint8Array([GS, 0x6b, 73, dataBytes.length]), // barcode 73 = CODE128 (variable length)
    dataBytes,
  ]);
}

// ────────────────────────────────────────────────────────────────────────
// High-level receipt builder — composes the above into a tax-invoice receipt
// in the Indian format: shop header + GSTIN + invoice no + date + lines +
// totals + tax breakdown + footer.
// ────────────────────────────────────────────────────────────────────────

export interface ReceiptHeader {
  readonly shopName: string;
  readonly addressLines: readonly string[];
  readonly gstin?: string;
  readonly drugLicense?: string;
  readonly phone?: string;
}

export interface ReceiptLine {
  readonly name: string;
  readonly qty: number;
  readonly mrp: number;            // rupees (display value)
  readonly discount?: number;      // rupees
  readonly lineTotal: number;      // rupees
}

export interface ReceiptTotals {
  readonly subtotal: number;
  readonly discount: number;
  readonly taxableValue: number;
  readonly cgst: number;
  readonly sgst: number;
  readonly igst: number;
  readonly grandTotal: number;
  readonly roundOff: number;
}

export interface ReceiptInput {
  readonly header: ReceiptHeader;
  readonly invoiceNo: string;
  readonly billedAtIso: string;
  readonly customerName?: string;
  readonly cashier: string;
  readonly lines: readonly ReceiptLine[];
  readonly totals: ReceiptTotals;
  readonly upiQrPayload?: string;   // if set, QR is appended for "scan to pay"
  readonly footer?: string;
  readonly width?: 32 | 48;          // 32 = 58mm paper, 48 = 80mm paper
}

/** Pad/truncate to a fixed printable width (monospace fonts on thermal). */
function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

function padLeft(s: string, w: number): string {
  return s.length >= w ? s.slice(s.length - w) : " ".repeat(w - s.length) + s;
}

function rupees(n: number): string {
  return n.toFixed(2);
}

/** Pure receipt → bytes. */
export function buildReceipt(r: ReceiptInput): Uint8Array {
  const W = r.width ?? 48;
  const sep = "-".repeat(W);

  const parts: Uint8Array[] = [];
  const push = (b: Uint8Array) => parts.push(b);
  const line = (s: string) => push(escposText(s + "\n"));

  push(ESCPOS_INIT);

  // Header (centered, bold for shop name).
  push(escposJustify(1));
  push(ESCPOS_BOLD_ON);
  push(escposTextSize(17));        // 2x both for shop name
  line(r.header.shopName.toUpperCase());
  push(escposTextSize(0));
  push(ESCPOS_BOLD_OFF);
  for (const a of r.header.addressLines) line(a);
  if (r.header.phone) line(`Phone: ${r.header.phone}`);
  if (r.header.gstin) line(`GSTIN: ${r.header.gstin}`);
  if (r.header.drugLicense) line(`DL: ${r.header.drugLicense}`);

  push(escposJustify(0));
  line(sep);
  line(`INV: ${r.invoiceNo}`);
  line(`Date: ${r.billedAtIso.replace("T", " ").slice(0, 19)}`);
  if (r.customerName) line(`Customer: ${r.customerName}`);
  line(`Cashier: ${r.cashier}`);
  line(sep);

  // Lines.
  const nameW = W - 24;            // remaining cols after qty(4) + mrp(8) + total(10) + spaces(2)
  line(`${padRight("Item", nameW)}${padLeft("Qty", 4)}${padLeft("MRP", 8)}${padLeft("Total", 10)}`);
  for (const ln of r.lines) {
    const name = ln.name.length > nameW ? ln.name.slice(0, nameW - 1) + "…" : ln.name;
    line(
      padRight(name, nameW) +
      padLeft(ln.qty.toString(), 4) +
      padLeft(rupees(ln.mrp), 8) +
      padLeft(rupees(ln.lineTotal), 10),
    );
    if (ln.discount && ln.discount > 0) {
      line(padRight(`  disc -${rupees(ln.discount)}`, W));
    }
  }
  line(sep);

  // Totals.
  const right = (label: string, val: number) =>
    line(padRight(label, W - 12) + padLeft(rupees(val), 12));
  right("Subtotal", r.totals.subtotal);
  if (r.totals.discount > 0) right("Discount", -r.totals.discount);
  right("Taxable", r.totals.taxableValue);
  if (r.totals.cgst > 0) right("CGST", r.totals.cgst);
  if (r.totals.sgst > 0) right("SGST", r.totals.sgst);
  if (r.totals.igst > 0) right("IGST", r.totals.igst);
  if (r.totals.roundOff !== 0) right("Round Off", r.totals.roundOff);
  push(ESCPOS_BOLD_ON);
  push(escposTextSize(1));
  right("TOTAL", r.totals.grandTotal);
  push(escposTextSize(0));
  push(ESCPOS_BOLD_OFF);
  line(sep);

  // UPI QR (optional).
  if (r.upiQrPayload) {
    push(escposJustify(1));
    line("Scan to pay (UPI)");
    push(escposQrCode(r.upiQrPayload, { size: 6 }));
    push(escposJustify(0));
    line(sep);
  }

  // Footer.
  push(escposJustify(1));
  line(r.footer ?? "Thank you · Visit again");
  line("Powered by Rasayn");
  push(escposJustify(0));

  push(escposFeed(3));
  push(ESCPOS_CUT);

  return concatBytes(parts);
}

// ────────────────────────────────────────────────────────────────────────
// Label printer (ZPL II for Zebra/Argox + TSPL for TSC). For barcode/SKU
// labels we emit ZPL by default — Argox/Zebra support it natively.
// ────────────────────────────────────────────────────────────────────────

export interface LabelInput {
  readonly sku: string;             // human-readable SKU code
  readonly barcode: string;         // barcode value (Code 128)
  readonly productName: string;
  readonly priceRupees: number;
  readonly batchNo?: string;
  readonly expiry?: string;         // YYYY-MM-DD
  readonly widthDots?: number;      // 50mm @ 8dpmm = 400
  readonly heightDots?: number;     // 30mm @ 8dpmm = 240
}

/** Produce ZPL II for a single label. */
export function buildLabelZpl(l: LabelInput): Uint8Array {
  const w = l.widthDots ?? 400;
  const h = l.heightDots ?? 240;
  const lines = [
    `^XA`,
    `^PW${w}`,
    `^LL${h}`,
    `^CI28`,                                            // UTF-8
    `^FO20,10^A0N,22,22^FD${escapeZpl(l.productName.slice(0, 32))}^FS`,
    `^FO20,40^A0N,18,18^FDSKU: ${escapeZpl(l.sku)}^FS`,
    l.batchNo ? `^FO20,62^A0N,18,18^FDBatch: ${escapeZpl(l.batchNo)}^FS` : "",
    l.expiry ? `^FO20,84^A0N,18,18^FDExp: ${escapeZpl(l.expiry)}^FS` : "",
    `^FO20,108^BY2,2,60^BCN,60,Y,N,N^FD${escapeZpl(l.barcode)}^FS`,
    `^FO20,200^A0N,28,28^FD${rupees(l.priceRupees)} INR^FS`,
    `^XZ`,
  ].filter(Boolean);
  return new TextEncoder().encode(lines.join("\n"));
}

function escapeZpl(s: string): string {
  // ZPL ^FD ends at next ^ or ~; we strip both to be safe.
  return s.replace(/[\^~]/g, " ");
}

// ────────────────────────────────────────────────────────────────────────
// GS1 DataMatrix decoded shape — the actual decode is done by the Tauri
// sidecar (rust zxing-like crate or @zxing/library in WebAssembly).
// ────────────────────────────────────────────────────────────────────────

export interface DataMatrixDecode {
  readonly gtin: string;            // AI 01
  readonly batchNo: string;         // AI 10
  readonly expiry: string;          // AI 17 — YYMMDD per GS1
  readonly serial: string;          // AI 21
}

/** Parse a raw GS1 AI string (separator = group-separator 0x1d) into fields. */
export function parseGs1Ais(raw: string): DataMatrixDecode | null {
  // Sequential parser. Recognized AIs: 01 (GTIN, fixed 14), 10 (batch, var≤20),
  // 17 (expiry, fixed 6), 21 (serial, var≤20). For variable AIs we scan until
  // GS (0x1d) or the next known-AI prefix.
  const known = new Set(["01", "10", "17", "21"]);
  const fixedLen: Record<string, number> = { "01": 14, "17": 6 };
  const fields: Record<string, string> = {};
  // Replace GS (\x1d) with a NUL sentinel so we can iterate by index safely.
  const s = raw.replace(/\x1d/g, "\x00");
  let i = 0;
  while (i < s.length) {
    const ai = s.slice(i, i + 2);
    // Don't re-recognize an AI we've already consumed (avoids treating a
    // "01" or "10" embedded in a serial as a new field).
    if (!known.has(ai) || fields[ai] !== undefined) {
      i += 1;
      continue;
    }
    i += 2;
    const fl = fixedLen[ai];
    if (fl !== undefined) {
      const v = s.slice(i, i + fl);
      if (v.length < fl) return null;
      fields[ai] = v;
      i += fl;
    } else {
      let end = i;
      while (end < s.length) {
        if (s.charCodeAt(end) === 0) break;
        if (end - i >= 20) break;
        const peek = s.slice(end, end + 2);
        // Stop only at a known AI we haven't already consumed; otherwise
        // an "01" or "10" embedded in a serial would prematurely terminate.
        if (end > i && known.has(peek) && fields[peek] === undefined) break;
        end += 1;
      }
      fields[ai] = s.slice(i, end);
      i = end;
      if (s.charCodeAt(i) === 0) i += 1;
    }
  }
  const gtin = fields["01"];
  const batch = fields["10"];
  const expiry = fields["17"];
  if (!gtin || !batch || !expiry) return null;
  return {
    gtin,
    batchNo: batch,
    expiry,
    serial: fields["21"] ?? "",
  };
}


// ────────────────────────────────────────────────────────────────────────
// I/O ports — caller injects a transport (Tauri sidecar / Web Serial)
// ────────────────────────────────────────────────────────────────────────

export interface PrinterTransport {
  discover(): Promise<readonly DiscoveredPrinter[]>;
  write(printerId: string, bytes: Uint8Array): Promise<void>;
}

let transport: PrinterTransport | null = null;

export function setPrinterTransport(t: PrinterTransport): void {
  transport = t;
}

export async function discoverPrinters(): Promise<readonly DiscoveredPrinter[]> {
  if (!transport) throw new Error("PRINTER_TRANSPORT_NOT_SET");
  return transport.discover();
}

export async function printRaw(printerId: string, bytes: Uint8Array): Promise<void> {
  if (!transport) throw new Error("PRINTER_TRANSPORT_NOT_SET");
  return transport.write(printerId, bytes);
}

export async function pulseCashDrawer(printerId: string, pin: 2 | 5 = 2): Promise<void> {
  return printRaw(printerId, pin === 2 ? ESCPOS_DRAWER_PIN_2 : ESCPOS_DRAWER_PIN_5);
}

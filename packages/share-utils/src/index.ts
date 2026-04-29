// @pharmacare/share-utils
// Standalone (zero-API) customer-facing helpers:
//   1. WhatsApp share-link generator — opens WhatsApp web/app with prefilled
//      invoice text. No Gupshup / Meta Cloud API needed.
//   2. UPI deep-link + QR-data generator — per the BHIM UPI URI spec
//      (NPCI-published). Customer scans with any UPI app (PhonePe, GPay,
//      Paytm, BHIM). No Razorpay POS terminal needed.
//   3. tel: deep-link helper (call customer)
//   4. mailto: deep-link helper (send invoice via email)
//
// Replaces 4 previously-deferred dependencies (Gupshup BSP, Meta WhatsApp,
// MSG91 SMS, Razorpay POS terminal). Pure functions. 100% offline.

import type { Paise } from "@pharmacare/shared-types";

// ────────────────────────────────────────────────────────────────────────
// WhatsApp share-link
// ────────────────────────────────────────────────────────────────────────

/** Normalise an Indian phone to E.164 (+91…). Accepts: 10-digit / +91… / 91… / with spaces / hyphens. */
export function normalizeIndianPhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 13 && digits.startsWith("091")) return digits.slice(1);
  throw new InvalidPhoneError(raw);
}

export class InvalidPhoneError extends Error {
  public readonly code = "INVALID_PHONE" as const;
  constructor(raw: string) { super(`INVALID_PHONE: "${raw}" — must be a 10-digit Indian mobile or +91…`); }
}

export interface WhatsAppMessageArgs {
  readonly toPhone: string;
  readonly text: string;
}

/** Build a wa.me deep link. Opens WhatsApp web on desktop, native app on mobile. */
export function buildWhatsAppLink(args: WhatsAppMessageArgs): string {
  const phone = normalizeIndianPhone(args.toPhone);
  return `https://wa.me/${phone}?text=${encodeURIComponent(args.text)}`;
}

export interface InvoiceTextArgs {
  readonly shopName: string;
  readonly billNo: string;
  readonly billedAt: string;     // ISO
  readonly grandTotalPaise: Paise;
  readonly upiPayLink?: string;  // optional — embed UPI link
  readonly receiptUrl?: string;
}

/** Default invoice text — used by BillingScreen "Share via WhatsApp" button. */
export function buildInvoiceText(a: InvoiceTextArgs): string {
  const lines: string[] = [];
  const date = new Date(a.billedAt).toLocaleDateString("en-IN");
  const total = `₹${((a.grandTotalPaise as number) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  lines.push(`*${a.shopName}* — Receipt ${a.billNo}`);
  lines.push(`Date: ${date}`);
  lines.push(`Amount: *${total}*`);
  if (a.upiPayLink) {
    lines.push("");
    lines.push(`Pay via UPI: ${a.upiPayLink}`);
  }
  if (a.receiptUrl) {
    lines.push("");
    lines.push(`Receipt PDF: ${a.receiptUrl}`);
  }
  lines.push("");
  lines.push("Thank you for your visit. — sent from PharmaCare");
  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────
// UPI deep-link + QR data
// ────────────────────────────────────────────────────────────────────────

export interface UpiPayLinkArgs {
  readonly payeeVpa: string;          // e.g. "jagannath@hdfc"
  readonly payeeName: string;         // e.g. "Jagannath Pharmacy LLP"
  readonly amountPaise?: Paise;       // omit for "any amount" QR
  readonly transactionRef?: string;   // bill no, max 35 chars
  readonly transactionNote?: string;  // human-readable, max 50 chars
  readonly merchantCode?: string;     // 4-digit MCC; pharmacies = "5912"
  readonly currency?: "INR";
}

const VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z]+$/;

export function isValidVpa(vpa: string): boolean {
  return VPA_RE.test(vpa);
}

export class InvalidVpaError extends Error {
  public readonly code = "INVALID_VPA" as const;
  constructor(vpa: string) { super(`INVALID_VPA: "${vpa}" — must be like name@bankcode`); }
}

/** Build a BHIM UPI deep link per NPCI URI spec.
 *  Example output: upi://pay?pa=jagannath@hdfc&pn=Jagannath%20Pharmacy&am=120.00&cu=INR&tn=Bill%20B-001&tr=B-001&mc=5912 */
export function buildUpiPayLink(a: UpiPayLinkArgs): string {
  if (!isValidVpa(a.payeeVpa)) throw new InvalidVpaError(a.payeeVpa);

  const params = new URLSearchParams();
  params.set("pa", a.payeeVpa);
  params.set("pn", a.payeeName);
  if (a.amountPaise !== undefined && (a.amountPaise as number) > 0) {
    params.set("am", ((a.amountPaise as number) / 100).toFixed(2));
  }
  params.set("cu", a.currency ?? "INR");
  if (a.transactionRef) {
    if (a.transactionRef.length > 35) throw new Error(`UPI transactionRef too long (max 35): ${a.transactionRef}`);
    params.set("tr", a.transactionRef);
  }
  if (a.transactionNote) {
    const note = a.transactionNote.length > 50 ? a.transactionNote.slice(0, 50) : a.transactionNote;
    params.set("tn", note);
  }
  if (a.merchantCode) params.set("mc", a.merchantCode);

  return `upi://pay?${params.toString()}`;
}

/** Pharmacy default merchant category code (MCC 5912 — Drug Stores & Pharmacies). */
export const PHARMACY_MCC = "5912" as const;

// ────────────────────────────────────────────────────────────────────────
// Tiny QR-data encoder — prepares the string a QR canvas/SVG renderer
// will turn into a square image. We don't render the QR itself here
// (renderer needs DOM); we just return the canonical data payload.
//
// For the actual visual QR, the caller uses a tiny client-side library or
// the design-system's QrCanvas (TODO).
// ────────────────────────────────────────────────────────────────────────

export interface UpiQrData {
  /** The raw UPI URI to encode in the QR. */
  readonly payload: string;
  /** SHA-1 of payload — used as cache key for bitmap generation. */
  readonly key: string;
  /** Suggested QR ECC level — Q (25%) gives best size/error trade for short URIs. */
  readonly errorCorrection: "L" | "M" | "Q" | "H";
}

export function buildUpiQrData(args: UpiPayLinkArgs): UpiQrData {
  const payload = buildUpiPayLink(args);
  return {
    payload,
    key: simpleHash(payload),
    errorCorrection: "Q",
  };
}

function simpleHash(s: string): string {
  // FNV-1a 32-bit — sufficient for cache keys, not crypto
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ────────────────────────────────────────────────────────────────────────
// tel: + mailto: helpers
// ────────────────────────────────────────────────────────────────────────

export function buildTelLink(phone: string): string {
  return `tel:+${normalizeIndianPhone(phone)}`;
}

export interface MailtoArgs {
  readonly to: string;
  readonly subject?: string;
  readonly body?: string;
}

export function buildMailtoLink(a: MailtoArgs): string {
  const params = new URLSearchParams();
  if (a.subject) params.set("subject", a.subject);
  if (a.body) params.set("body", a.body);
  const qs = params.toString();
  return `mailto:${a.to}${qs ? `?${qs}` : ""}`;
}

// ────────────────────────────────────────────────────────────────────────
// One-shot: invoice → all share artefacts in one go
// ────────────────────────────────────────────────────────────────────────

export interface InvoiceShareArgs extends InvoiceTextArgs {
  readonly customerPhone?: string;
  readonly customerEmail?: string;
  readonly upi?: { vpa: string; payeeName: string };
}

export interface InvoiceShareLinks {
  readonly whatsAppLink?: string;
  readonly upiPayLink?: string;
  readonly upiQr?: UpiQrData;
  readonly telLink?: string;
  readonly mailtoLink?: string;
  readonly invoiceText: string;
}

/** Build every share link from a single invoice payload. Caller picks which to surface in the UI. */
export function buildInvoiceShareLinks(a: InvoiceShareArgs): InvoiceShareLinks {
  let upiPayLink: string | undefined;
  let upiQr: UpiQrData | undefined;
  if (a.upi) {
    upiPayLink = buildUpiPayLink({
      payeeVpa: a.upi.vpa,
      payeeName: a.upi.payeeName,
      amountPaise: a.grandTotalPaise,
      transactionRef: a.billNo,
      transactionNote: `Bill ${a.billNo}`,
      merchantCode: PHARMACY_MCC,
    });
    upiQr = buildUpiQrData({
      payeeVpa: a.upi.vpa,
      payeeName: a.upi.payeeName,
      amountPaise: a.grandTotalPaise,
      transactionRef: a.billNo,
      transactionNote: `Bill ${a.billNo}`,
      merchantCode: PHARMACY_MCC,
    });
  }
  const invoiceText = buildInvoiceText({
    ...a,
    ...(upiPayLink !== undefined ? { upiPayLink } : {}),
  });

  const out: { -readonly [K in keyof InvoiceShareLinks]?: InvoiceShareLinks[K] } = { invoiceText };
  if (a.customerPhone) {
    out.whatsAppLink = buildWhatsAppLink({ toPhone: a.customerPhone, text: invoiceText });
    out.telLink      = buildTelLink(a.customerPhone);
  }
  if (a.customerEmail) {
    out.mailtoLink = buildMailtoLink({
      to: a.customerEmail,
      subject: `Receipt ${a.billNo} from ${a.shopName}`,
      body: invoiceText,
    });
  }
  if (upiPayLink) out.upiPayLink = upiPayLink;
  if (upiQr)      out.upiQr = upiQr;
  return out as InvoiceShareLinks;
}

// @pharmacare/whatsapp-bsp
// WhatsApp Business Service Provider integration as PURE CORE — template
// rendering, payload validation, and an outbound queue with retry/backoff.
// No live HTTP. The caller injects a `WhatsAppTransport` (Cloud API direct,
// Gupshup, MSG91, AiSensy, Twilio — all interchangeable) so we never lock
// the customer into one BSP.
//
// Templates ship with the package; tone matches Indian Hindi-English code-
// switching ("Aapka bill ready hai — ₹{{amount}}.").
//
// Reference: Meta Cloud API spec (template object + components array).

export type Locale = "en_IN" | "hi_IN" | "mr_IN" | "gu_IN";

export type TemplateKey =
  | "bill_share"
  | "refill_reminder"
  | "payment_receipt"
  | "khata_payment_due"
  | "family_vault_invite"
  | "stockout_alert"           // for B2B / supplier
  | "appointment_reminder";

export interface TemplateBody {
  readonly key: TemplateKey;
  readonly name: string;        // Meta-approved template name
  readonly languages: Readonly<Record<Locale, string>>;
  readonly placeholders: readonly string[];   // {{1}}, {{2}}, ... in order
}

// ────────────────────────────────────────────────────────────────────────
// Template library
// ────────────────────────────────────────────────────────────────────────

export const TEMPLATES: Readonly<Record<TemplateKey, TemplateBody>> = {
  bill_share: {
    key: "bill_share",
    name: "rasayn_bill_share_v1",
    languages: {
      en_IN: "Hi {{1}}, your Jagannath Pharmacy bill #{{2}} for ₹{{3}} is ready. View: {{4}}",
      hi_IN: "नमस्ते {{1}}, आपका जगन्नाथ फार्मेसी बिल #{{2}} ₹{{3}} का तैयार है। देखें: {{4}}",
      mr_IN: "नमस्कार {{1}}, तुमचे जगन्नाथ फार्मसी बिल #{{2}} ₹{{3}} चे तयार आहे. पहा: {{4}}",
      gu_IN: "નમસ્તે {{1}}, આપનું જગન્નાથ ફાર્મસી બિલ #{{2}} ₹{{3}} તૈયાર છે। જુઓ: {{4}}",
    },
    placeholders: ["customer_name", "bill_no", "amount", "url"],
  },
  refill_reminder: {
    key: "refill_reminder",
    name: "rasayn_refill_reminder_v1",
    languages: {
      en_IN: "Hi {{1}}, refill reminder for {{2}} ({{3}}). Reply YES to confirm we keep stock.",
      hi_IN: "नमस्ते {{1}}, {{2}} ({{3}}) के लिए रिफिल याद। YES से पुष्टि करें।",
      mr_IN: "नमस्कार {{1}}, {{2}} ({{3}}) रिफिल आठवण. YES पाठवा.",
      gu_IN: "નમસ્તે {{1}}, {{2}} ({{3}}) રિફિલ યાદ. YES મોકલો.",
    },
    placeholders: ["customer_name", "drug_name", "next_refill_date"],
  },
  payment_receipt: {
    key: "payment_receipt",
    name: "rasayn_payment_receipt_v1",
    languages: {
      en_IN: "Payment of ₹{{1}} received against bill #{{2}}. Thank you, {{3}}.",
      hi_IN: "बिल #{{2}} के विरुद्ध ₹{{1}} का भुगतान प्राप्त। धन्यवाद, {{3}}।",
      mr_IN: "बिल #{{2}} साठी ₹{{1}} ची पावती मिळाली. धन्यवाद, {{3}}.",
      gu_IN: "બિલ #{{2}} માટે ₹{{1}} ની રસીદ મળી. આભાર, {{3}}.",
    },
    placeholders: ["amount", "bill_no", "customer_name"],
  },
  khata_payment_due: {
    key: "khata_payment_due",
    name: "rasayn_khata_due_v1",
    languages: {
      en_IN: "Hi {{1}}, friendly reminder — ₹{{2}} pending on your khata since {{3}}. Pay via UPI: {{4}}",
      hi_IN: "नमस्ते {{1}}, ₹{{2}} खाते पर बकाया है ({{3}} से)। UPI: {{4}}",
      mr_IN: "नमस्कार {{1}}, ₹{{2}} खात्यावर बाकी आहे ({{3}} पासून). UPI: {{4}}",
      gu_IN: "નમસ્તે {{1}}, ₹{{2}} ખાતા પર બાકી છે ({{3}} થી). UPI: {{4}}",
    },
    placeholders: ["customer_name", "amount", "since_date", "upi_link"],
  },
  family_vault_invite: {
    key: "family_vault_invite",
    name: "rasayn_family_vault_invite_v1",
    languages: {
      en_IN: "{{1}} has invited you to their family medication vault. Tap to accept: {{2}}",
      hi_IN: "{{1}} ने आपको परिवार-वॉल्ट में जोड़ा है। स्वीकार: {{2}}",
      mr_IN: "{{1}} ने तुम्हाला कुटुंब-वॉल्ट मध्ये जोडले आहे. स्वीकार: {{2}}",
      gu_IN: "{{1}} એ તમને ફેમિલી-વોલ્ટ માં જોડ્યા છે. સ્વીકાર: {{2}}",
    },
    placeholders: ["sender_name", "accept_url"],
  },
  stockout_alert: {
    key: "stockout_alert",
    name: "rasayn_stockout_b2b_v1",
    languages: {
      en_IN: "Stock alert: {{1}} ({{2}}). Current = {{3}}, reorder level = {{4}}.",
      hi_IN: "स्टॉक चेतावनी: {{1}} ({{2}}). वर्तमान = {{3}}, रीऑर्डर = {{4}}।",
      mr_IN: "स्टॉक सूचना: {{1}} ({{2}}). सध्या = {{3}}, रीऑर्डर = {{4}}.",
      gu_IN: "સ્ટોક અલર્ટ: {{1}} ({{2}}). હાલ = {{3}}, રીઓર્ડર = {{4}}.",
    },
    placeholders: ["drug_name", "manufacturer", "current_qty", "reorder_level"],
  },
  appointment_reminder: {
    key: "appointment_reminder",
    name: "rasayn_appointment_v1",
    languages: {
      en_IN: "Reminder: {{1}} appointment on {{2}} at {{3}}. Address: {{4}}",
      hi_IN: "याद: {{1}} अपॉइंटमेंट {{2}} को {{3}} पर। पता: {{4}}",
      mr_IN: "आठवण: {{1}} अपॉइंटमेंट {{2}} रोजी {{3}} वाजता. पत्ता: {{4}}",
      gu_IN: "યાદ: {{1}} એપોઇન્ટમેન્ટ {{2}} ના {{3}} વાગ્યે. સરનામું: {{4}}",
    },
    placeholders: ["doctor_name", "date", "time", "address"],
  },
};

// ────────────────────────────────────────────────────────────────────────
// Template render + validation
// ────────────────────────────────────────────────────────────────────────

export class TemplateRenderError extends Error {
  public readonly code = "TEMPLATE_RENDER_ERROR" as const;
  constructor(reason: string) {
    super(`TEMPLATE_RENDER_ERROR: ${reason}`);
  }
}

/** Replace {{1}}..{{N}} in the locale's body with the supplied values.
 *  Throws if any placeholder is missing or extra values are passed.
 *  Strips embedded URL/whitespace exploits from values. */
export function renderTemplate(
  key: TemplateKey,
  locale: Locale,
  values: readonly string[],
): string {
  const tpl = TEMPLATES[key];
  if (!tpl) throw new TemplateRenderError(`unknown template key: ${key}`);
  const body = tpl.languages[locale];
  if (!body) throw new TemplateRenderError(`locale ${locale} not available for ${key}`);
  if (values.length !== tpl.placeholders.length) {
    throw new TemplateRenderError(
      `expected ${tpl.placeholders.length} values for ${key}, got ${values.length}`,
    );
  }
  let out = body;
  for (let i = 0; i < values.length; i++) {
    const safe = sanitize(values[i]!);
    // Replace {{i+1}} (Meta is 1-indexed)
    out = out.replaceAll(`{{${i + 1}}}`, safe);
  }
  return out;
}

function sanitize(v: string): string {
  // WhatsApp templates reject \n, \t, multiple spaces, leading/trailing space.
  return v
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ────────────────────────────────────────────────────────────────────────
// Outbound message + queue
// ────────────────────────────────────────────────────────────────────────

export type OutboundStatus = "queued" | "sending" | "sent" | "failed" | "delivered" | "read";

export interface OutboundMessage {
  readonly id: string;
  readonly toPhone: string;            // E.164 format, e.g., +918698012345
  readonly templateKey: TemplateKey;
  readonly locale: Locale;
  readonly values: readonly string[];
  readonly renderedBody: string;
  readonly status: OutboundStatus;
  readonly createdAtIso: string;
  readonly attempts: number;
  readonly lastAttemptIso?: string;
  readonly providerMessageId?: string; // BSP's internal ID
  readonly errorReason?: string;
}

export interface QueueArgs {
  readonly id: string;
  readonly toPhone: string;
  readonly templateKey: TemplateKey;
  readonly locale: Locale;
  readonly values: readonly string[];
  readonly nowIso?: string;
}

export function queueMessage(args: QueueArgs): OutboundMessage {
  if (!isE164(args.toPhone)) {
    throw new TemplateRenderError(`phone must be E.164 format: ${args.toPhone}`);
  }
  const rendered = renderTemplate(args.templateKey, args.locale, args.values);
  return {
    id: args.id,
    toPhone: args.toPhone,
    templateKey: args.templateKey,
    locale: args.locale,
    values: args.values,
    renderedBody: rendered,
    status: "queued",
    createdAtIso: args.nowIso ?? new Date().toISOString(),
    attempts: 0,
  };
}

export function isE164(phone: string): boolean {
  return /^\+\d{10,15}$/.test(phone);
}

// ────────────────────────────────────────────────────────────────────────
// Retry/backoff policy (exponential, capped)
// ────────────────────────────────────────────────────────────────────────

export const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_SEC = 30;

export function nextAttemptAfterSeconds(attempt: number): number {
  if (attempt >= MAX_ATTEMPTS) return Infinity;
  // 30s, 60s, 2m, 4m, 8m
  return BASE_BACKOFF_SEC * Math.pow(2, attempt);
}

export function shouldRetry(msg: OutboundMessage): boolean {
  return msg.status === "failed" && msg.attempts < MAX_ATTEMPTS;
}

// ────────────────────────────────────────────────────────────────────────
// I/O port — caller injects a transport
// ────────────────────────────────────────────────────────────────────────

export interface SendResult {
  readonly providerMessageId: string;
}

export interface WhatsAppTransport {
  /** Send a rendered template + variables to the BSP. */
  send(msg: OutboundMessage): Promise<SendResult>;
}

export async function sendOnce(
  transport: WhatsAppTransport,
  msg: OutboundMessage,
  nowIso: string = new Date().toISOString(),
): Promise<OutboundMessage> {
  if (msg.status === "sent" || msg.status === "delivered" || msg.status === "read") {
    return msg;  // already done
  }
  try {
    const result = await transport.send({ ...msg, status: "sending" });
    return {
      ...msg,
      status: "sent",
      attempts: msg.attempts + 1,
      lastAttemptIso: nowIso,
      providerMessageId: result.providerMessageId,
    };
  } catch (e) {
    return {
      ...msg,
      status: "failed",
      attempts: msg.attempts + 1,
      lastAttemptIso: nowIso,
      errorReason: e instanceof Error ? e.message : String(e),
    };
  }
}

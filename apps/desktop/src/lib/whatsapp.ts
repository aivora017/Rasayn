// whatsapp.ts — thin glue between @pharmacare/whatsapp-bsp (pure template
// renderer + queue policy) and the Tauri whatsapp_outbox commands.
//
// Each enqueue:
//   1. validates phone is E.164 via queueMessage
//   2. renders the template body in the chosen locale
//   3. persists to whatsapp_outbox via Tauri whatsapp_enqueue
//   4. opens wa.me with the rendered body (zero-cost share fallback)

import { queueMessage, type Locale, type TemplateKey, type OutboundMessage } from "@pharmacare/whatsapp-bsp";
import { whatsappEnqueueRpc, type WhatsAppEnqueueInputDTO, type WhatsAppOutboxRowDTO } from "./ipc.js";

export interface QueueAndShareArgs {
  readonly templateKey: TemplateKey;
  readonly toPhone: string;            // E.164, e.g. +918698012345
  readonly locale: Locale;             // en_IN | hi_IN | mr_IN | gu_IN
  readonly values: readonly string[];  // ordered placeholder values
  /** Override message id (else uuid-ish). */
  readonly id?: string;
}

export interface QueueAndShareResult {
  readonly outbox: WhatsAppOutboxRowDTO;
  readonly waMeUrl: string;
  readonly local: OutboundMessage;
}

function uuid(): string {
  // Best-effort uuid. Avoid crypto.randomUUID() in jsdom 25 polyfill quirks.
  const r = () => Math.random().toString(16).slice(2, 10);
  return `wa_${Date.now().toString(16)}_${r()}${r()}`;
}

/** Queue a message via Tauri AND return a wa.me deep link the caller can open. */
export async function queueAndShare(args: QueueAndShareArgs): Promise<QueueAndShareResult> {
  const id = args.id ?? uuid();
  // validate + render via the pure package (throws if phone not E.164 / values too few)
  const local = queueMessage({
    id, toPhone: args.toPhone,
    templateKey: args.templateKey, locale: args.locale,
    values: args.values,
  });
  const enqueueInput: WhatsAppEnqueueInputDTO = {
    id: local.id,
    toPhone: local.toPhone,
    templateKey: local.templateKey,
    locale: local.locale,
    valuesJson: JSON.stringify(local.values),
    renderedBody: local.renderedBody,
  };
  const outbox = await whatsappEnqueueRpc(enqueueInput);
  const phoneDigits = args.toPhone.replace(/[^0-9]/g, "");
  const waMeUrl = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(local.renderedBody)}`;
  return { outbox, waMeUrl, local };
}

/** Open the wa.me link in a new window/tab. */
export function openWaMe(url: string): void {
  try {
    globalThis.open?.(url, "_blank", "noopener,noreferrer");
  } catch {
    // jsdom / non-browser context
  }
}

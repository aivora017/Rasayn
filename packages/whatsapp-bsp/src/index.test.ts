import { describe, it, expect } from "vitest";
import {
  TEMPLATES,
  renderTemplate,
  TemplateRenderError,
  queueMessage,
  isE164,
  nextAttemptAfterSeconds,
  shouldRetry,
  MAX_ATTEMPTS,
  sendOnce,
  type WhatsAppTransport,
  type OutboundMessage,
} from "./index.js";

describe("template library", () => {
  it("ships 7 templates", () => {
    expect(Object.keys(TEMPLATES).length).toBe(7);
  });
  it("each template has all 4 locales (en/hi/mr/gu)", () => {
    for (const tpl of Object.values(TEMPLATES)) {
      expect(tpl.languages.en_IN).toBeDefined();
      expect(tpl.languages.hi_IN).toBeDefined();
      expect(tpl.languages.mr_IN).toBeDefined();
      expect(tpl.languages.gu_IN).toBeDefined();
    }
  });
  it("placeholder counts match the {{N}} markers in en_IN", () => {
    for (const tpl of Object.values(TEMPLATES)) {
      const matches = (tpl.languages.en_IN.match(/\{\{\d+\}\}/g) ?? []);
      expect(matches.length).toBe(tpl.placeholders.length);
    }
  });
});

describe("renderTemplate", () => {
  it("substitutes 1-indexed placeholders", () => {
    const out = renderTemplate("bill_share", "en_IN", ["Sourav", "JP-001", "150.00", "https://r.in/b/1"]);
    expect(out).toContain("Hi Sourav");
    expect(out).toContain("#JP-001");
    expect(out).toContain("₹150.00");
    expect(out).toContain("https://r.in/b/1");
  });

  it("supports Hindi locale", () => {
    const out = renderTemplate("bill_share", "hi_IN", ["सौरव", "JP-001", "150", "url"]);
    expect(out).toContain("सौरव");
    expect(out).toContain("नमस्ते");
  });

  it("strips newlines and tabs from values", () => {
    const out = renderTemplate("bill_share", "en_IN", [
      "Sou\nrav",
      "JP\t001",
      "150",
      "url",
    ]);
    expect(out).not.toMatch(/\n|\t/);
    expect(out).toContain("Sou rav");
  });

  it("collapses runs of spaces", () => {
    const out = renderTemplate("bill_share", "en_IN", ["Sourav   Shaw", "X", "1", "u"]);
    expect(out).toContain("Sourav Shaw");
  });

  it("throws on placeholder count mismatch", () => {
    expect(() => renderTemplate("bill_share", "en_IN", ["a", "b"])).toThrow(TemplateRenderError);
  });

  it("throws on unknown template key", () => {
    // @ts-expect-error — testing runtime guard
    expect(() => renderTemplate("not_a_template", "en_IN", [])).toThrow(TemplateRenderError);
  });
});

describe("isE164", () => {
  it("accepts Indian +91 numbers", () => {
    expect(isE164("+918698012345")).toBe(true);
  });
  it("rejects missing +", () => {
    expect(isE164("918698012345")).toBe(false);
  });
  it("rejects too-short", () => {
    expect(isE164("+91123")).toBe(false);
  });
  it("rejects non-digits", () => {
    expect(isE164("+91-86980-12345")).toBe(false);
  });
});

describe("queueMessage", () => {
  it("creates a queued message with rendered body", () => {
    const msg = queueMessage({
      id: "msg_1",
      toPhone: "+918698012345",
      templateKey: "payment_receipt",
      locale: "en_IN",
      values: ["100", "JP-1", "Sourav"],
    });
    expect(msg.status).toBe("queued");
    expect(msg.attempts).toBe(0);
    expect(msg.renderedBody).toContain("₹100");
    expect(msg.renderedBody).toContain("Sourav");
  });
  it("rejects non-E164 phone", () => {
    expect(() => queueMessage({
      id: "x",
      toPhone: "918698012345",
      templateKey: "payment_receipt",
      locale: "en_IN",
      values: ["100", "JP-1", "Sourav"],
    })).toThrow();
  });
});

describe("retry policy", () => {
  it("exponential backoff: 30s, 60s, 2m, 4m, 8m", () => {
    expect(nextAttemptAfterSeconds(0)).toBe(30);
    expect(nextAttemptAfterSeconds(1)).toBe(60);
    expect(nextAttemptAfterSeconds(2)).toBe(120);
    expect(nextAttemptAfterSeconds(3)).toBe(240);
    expect(nextAttemptAfterSeconds(4)).toBe(480);
  });
  it("returns Infinity past MAX_ATTEMPTS", () => {
    expect(nextAttemptAfterSeconds(MAX_ATTEMPTS)).toBe(Infinity);
  });
  it("shouldRetry only when failed and attempts<max", () => {
    const base: OutboundMessage = {
      id: "x", toPhone: "+91" + "0".repeat(10), templateKey: "bill_share", locale: "en_IN",
      values: [], renderedBody: "", status: "failed", createdAtIso: "", attempts: 2,
    };
    expect(shouldRetry(base)).toBe(true);
    expect(shouldRetry({ ...base, attempts: MAX_ATTEMPTS })).toBe(false);
    expect(shouldRetry({ ...base, status: "sent" })).toBe(false);
  });
});

describe("sendOnce", () => {
  const okTransport: WhatsAppTransport = {
    send: async () => ({ providerMessageId: "wa_provider_123" }),
  };
  const failTransport: WhatsAppTransport = {
    send: async () => { throw new Error("BSP timeout"); },
  };

  it("marks sent on success and increments attempts", async () => {
    const msg = queueMessage({
      id: "x", toPhone: "+918698012345", templateKey: "bill_share", locale: "en_IN",
      values: ["a", "b", "1", "u"],
    });
    const out = await sendOnce(okTransport, msg, "2026-04-29T11:00:00Z");
    expect(out.status).toBe("sent");
    expect(out.attempts).toBe(1);
    expect(out.providerMessageId).toBe("wa_provider_123");
    expect(out.lastAttemptIso).toBe("2026-04-29T11:00:00Z");
  });

  it("marks failed with reason on error", async () => {
    const msg = queueMessage({
      id: "x", toPhone: "+918698012345", templateKey: "bill_share", locale: "en_IN",
      values: ["a", "b", "1", "u"],
    });
    const out = await sendOnce(failTransport, msg, "2026-04-29T11:00:00Z");
    expect(out.status).toBe("failed");
    expect(out.attempts).toBe(1);
    expect(out.errorReason).toBe("BSP timeout");
  });

  it("no-op for already-sent messages", async () => {
    let calls = 0;
    const transport: WhatsAppTransport = {
      send: async () => { calls++; return { providerMessageId: "x" }; },
    };
    const msg = queueMessage({
      id: "x", toPhone: "+918698012345", templateKey: "bill_share", locale: "en_IN",
      values: ["a", "b", "1", "u"],
    });
    const sent = { ...msg, status: "sent" as const };
    const out = await sendOnce(transport, sent);
    expect(out).toBe(sent);
    expect(calls).toBe(0);
  });
});

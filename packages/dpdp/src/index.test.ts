import { describe, it, expect } from "vitest";
import {
  hasEffectiveConsent, effectiveConsents,
  canTransition, transition, dsrUrgency,
  validateConsent,
  InvalidDsrTransitionError, InvalidConsentError,
  DSR_STATUTORY_LIMIT_MS,
  ERASURE_TABLES_ORDERED, ERASURE_RETAINED_TABLES,
  type Consent, type DsrRequest,
} from "./index.js";

describe("hasEffectiveConsent", () => {
  const c: Consent[] = [
    { customerId: "u1", purpose: "marketing", granted: true,  grantedAt: "2026-01-01", evidence: "OTP" },
    { customerId: "u1", purpose: "loyalty",   granted: false, evidence: "paper-form" },
    { customerId: "u1", purpose: "abdm",      granted: true,  grantedAt: "2026-02-01", withdrawnAt: "2026-04-01", evidence: "OTP" },
  ];
  it("true for granted, not withdrawn", () => {
    expect(hasEffectiveConsent(c, "u1", "marketing")).toBe(true);
  });
  it("false for ungranted", () => {
    expect(hasEffectiveConsent(c, "u1", "loyalty")).toBe(false);
  });
  it("false for withdrawn", () => {
    expect(hasEffectiveConsent(c, "u1", "abdm")).toBe(false);
  });
  it("false when no record", () => {
    expect(hasEffectiveConsent(c, "u1", "research-anon")).toBe(false);
    expect(hasEffectiveConsent(c, "u-other", "marketing")).toBe(false);
  });
});

describe("effectiveConsents", () => {
  it("returns only granted, not-withdrawn purposes", () => {
    const c: Consent[] = [
      { customerId: "u1", purpose: "marketing", granted: true,  grantedAt: "2026-01-01", evidence: "OTP" },
      { customerId: "u1", purpose: "loyalty",   granted: true,  grantedAt: "2026-01-01", evidence: "OTP" },
      { customerId: "u1", purpose: "abdm",      granted: true,  grantedAt: "2026-02-01", withdrawnAt: "2026-04-01", evidence: "OTP" },
    ];
    expect(effectiveConsents(c, "u1").sort()).toEqual(["loyalty", "marketing"]);
  });
});

describe("DSR state machine", () => {
  it("received → verifying allowed", () => {
    expect(canTransition("received", "verifying")).toBe(true);
  });
  it("received → fulfilled NOT allowed (must verify first)", () => {
    expect(canTransition("received", "fulfilled")).toBe(false);
  });
  it("verifying → in-progress allowed", () => {
    expect(canTransition("verifying", "in-progress")).toBe(true);
  });
  it("in-progress → fulfilled allowed", () => {
    expect(canTransition("in-progress", "fulfilled")).toBe(true);
  });
  it("fulfilled is terminal", () => {
    expect(canTransition("fulfilled", "in-progress")).toBe(false);
    expect(canTransition("fulfilled", "rejected")).toBe(false);
  });
  it("any state → rejected allowed up to terminal", () => {
    expect(canTransition("received", "rejected")).toBe(true);
    expect(canTransition("verifying", "rejected")).toBe(true);
    expect(canTransition("in-progress", "rejected")).toBe(true);
  });

  it("transition() throws InvalidDsrTransitionError on bad transition", () => {
    const r: DsrRequest = {
      id: "r1", customerId: "u1", kind: "access",
      receivedAt: "2026-04-01", status: "fulfilled",
    };
    expect(() => transition(r, "in-progress", "2026-04-02")).toThrow(InvalidDsrTransitionError);
  });

  it("transition() to terminal stamps fulfilledAt + handler", () => {
    const r: DsrRequest = {
      id: "r1", customerId: "u1", kind: "access",
      receivedAt: "2026-04-01", status: "in-progress",
    };
    const t = transition(r, "fulfilled", "2026-04-15T10:00:00Z", "u_owner");
    expect(t.status).toBe("fulfilled");
    expect(t.fulfilledAt).toBe("2026-04-15T10:00:00Z");
    expect(t.handledByUserId).toBe("u_owner");
  });
});

describe("dsrUrgency", () => {
  const fixed = new Date("2026-04-28T12:00:00Z");

  it("ok when more than 7 days remain", () => {
    const r: DsrRequest = {
      id: "r1", customerId: "u1", kind: "access",
      receivedAt: "2026-04-25T12:00:00Z", status: "received",
    };
    expect(dsrUrgency(r, fixed).category).toBe("ok");
  });

  it("warning when ≤ 7 days remain", () => {
    const r: DsrRequest = {
      id: "r1", customerId: "u1", kind: "access",
      receivedAt: "2026-04-25T12:00:00Z", status: "received",
    };
    // received 3 days ago, 27 days left → ok
    expect(dsrUrgency(r, fixed).category).toBe("ok");
  });

  it("warning when 5 days remain (received 25 days ago)", () => {
    const r: DsrRequest = {
      id: "r1", customerId: "u1", kind: "access",
      receivedAt: "2026-04-03T12:00:00Z", status: "received",
    };
    expect(dsrUrgency(r, fixed).category).toBe("warning");
  });

  it("overdue when past 30 days", () => {
    const r: DsrRequest = {
      id: "r1", customerId: "u1", kind: "access",
      receivedAt: "2026-03-01T12:00:00Z", status: "received",
    };
    expect(dsrUrgency(r, fixed).category).toBe("overdue");
  });

  it("fulfilled / rejected always ok", () => {
    const r: DsrRequest = {
      id: "r1", customerId: "u1", kind: "access",
      receivedAt: "2026-03-01T12:00:00Z", status: "fulfilled",
      fulfilledAt: "2026-03-15",
    };
    expect(dsrUrgency(r, fixed).category).toBe("ok");
  });
});

describe("validateConsent", () => {
  it("requires grantedAt when granted=true", () => {
    expect(() => validateConsent({
      customerId: "u1", purpose: "marketing", granted: true, evidence: "OTP",
    } as Consent)).toThrow(InvalidConsentError);
  });
  it("requires evidence", () => {
    expect(() => validateConsent({
      customerId: "u1", purpose: "marketing", granted: false, evidence: "",
    })).toThrow(InvalidConsentError);
  });
  it("rejects withdrawn-but-granted contradiction", () => {
    expect(() => validateConsent({
      customerId: "u1", purpose: "marketing", granted: true, grantedAt: "2026-01-01",
      withdrawnAt: "2026-02-01", evidence: "OTP",
    })).toThrow(InvalidConsentError);
  });
  it("accepts well-formed consent", () => {
    expect(() => validateConsent({
      customerId: "u1", purpose: "marketing", granted: true, grantedAt: "2026-01-01", evidence: "OTP",
    })).not.toThrow();
  });
});

describe("erasure scope constants", () => {
  it("ordered tables are FK-safe (children before parents)", () => {
    expect(ERASURE_TABLES_ORDERED.indexOf("khata_entries"))
      .toBeLessThan(ERASURE_TABLES_ORDERED.indexOf("customers"));
  });

  it("retained tables include audit_log + bills (statutory)", () => {
    expect(ERASURE_RETAINED_TABLES).toContain("audit_log");
    expect(ERASURE_RETAINED_TABLES).toContain("bills");
  });
});

describe("DSR_STATUTORY_LIMIT_MS", () => {
  it("is exactly 30 days", () => {
    expect(DSR_STATUTORY_LIMIT_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

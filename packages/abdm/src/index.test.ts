import { describe, it, expect } from "vitest";
import {
  isValidAbhaFormat, normalizeAbha, isValidAbhaChecksum,
  canVerifyTransition, verifyTransition,
  buildMedicationDispense, nextRetryAfter, shouldRetry, MAX_RETRY_ATTEMPTS,
  InvalidAbhaError, InvalidVerificationTransitionError, InvalidDispenseInputError,
  type PushAttempt,
} from "./index.js";

describe("isValidAbhaFormat", () => {
  it("accepts hyphenated 14-digit", () => {
    expect(isValidAbhaFormat("12-3456-7890-1234")).toBe(true);
  });
  it("accepts plain 14-digit", () => {
    expect(isValidAbhaFormat("12345678901234")).toBe(true);
  });
  it("rejects too short", () => {
    expect(isValidAbhaFormat("123456")).toBe(false);
  });
  it("rejects letters", () => {
    expect(isValidAbhaFormat("12-3456-7890-12AB")).toBe(false);
  });
});

describe("normalizeAbha", () => {
  it("plain → hyphenated", () => {
    expect(normalizeAbha("12345678901234")).toBe("12-3456-7890-1234");
  });
  it("hyphenated → unchanged", () => {
    expect(normalizeAbha("12-3456-7890-1234")).toBe("12-3456-7890-1234");
  });
  it("invalid throws", () => {
    expect(() => normalizeAbha("not-abha")).toThrow(InvalidAbhaError);
  });
});

describe("isValidAbhaChecksum (Verhoeff)", () => {
  it("known valid Verhoeff number passes", () => {
    // "2363" Verhoeff valid → real ABHA-style requires a valid Verhoeff terminal digit.
    // Use a constructed valid example: digits "53589" — sample Verhoeff valid sequence.
    expect(isValidAbhaChecksum("12345678901230")).toBe(true);
  });
  it("invalid format → false (not just bad checksum)", () => {
    expect(isValidAbhaChecksum("garbage")).toBe(false);
  });
});

describe("verification state machine", () => {
  it("not-started → otp-sent allowed", () => {
    expect(canVerifyTransition("not-started", "otp-sent")).toBe(true);
  });
  it("not-started → verified NOT allowed (must go through OTP)", () => {
    expect(canVerifyTransition("not-started", "verified")).toBe(false);
  });
  it("consent-granted → verified", () => {
    expect(canVerifyTransition("consent-granted", "verified")).toBe(true);
  });
  it("consent-denied is terminal", () => {
    expect(canVerifyTransition("consent-denied", "verified")).toBe(false);
    expect(canVerifyTransition("consent-denied", "otp-sent")).toBe(false);
  });
  it("verified is terminal", () => {
    expect(canVerifyTransition("verified", "otp-sent")).toBe(false);
  });
  it("any state → failed allowed up to terminals", () => {
    expect(canVerifyTransition("not-started", "failed")).toBe(true);
    expect(canVerifyTransition("otp-sent", "failed")).toBe(true);
    expect(canVerifyTransition("consent-pending", "failed")).toBe(true);
  });
  it("verifyTransition throws on invalid", () => {
    expect(() => verifyTransition("verified", "otp-sent")).toThrow(InvalidVerificationTransitionError);
  });
});

describe("buildMedicationDispense", () => {
  const ok = {
    billId: "b1", billedAt: "2026-04-28T10:00:00Z",
    subjectAbhaNumber: "12-3456-7890-1234",
    performerShopGstin: "27ABCDE1234F1Z5",
    performerShopName: "Jagannath Pharmacy",
    products: [{ drugName: "Crocin", strength: "500mg", form: "tablet", qtyDispensed: 10, batchNo: "BN1" }],
  };

  it("emits valid FHIR R4 MedicationDispense", () => {
    const r = buildMedicationDispense(ok);
    expect(r.resourceType).toBe("MedicationDispense");
    expect(r.status).toBe("completed");
    expect(r.subject.identifier.system).toBe("https://healthid.ndhm.gov.in");
    expect(r.subject.identifier.value).toBe("12-3456-7890-1234");
    expect(r.performer[0]?.actor.identifier.value).toBe("27ABCDE1234F1Z5");
    expect(r.contained).toHaveLength(1);
  });

  it("normalizes ABHA on the way out (plain input → hyphenated)", () => {
    const r = buildMedicationDispense({ ...ok, subjectAbhaNumber: "12345678901234" });
    expect(r.subject.identifier.value).toBe("12-3456-7890-1234");
  });

  it("rejects invalid ABHA", () => {
    expect(() => buildMedicationDispense({ ...ok, subjectAbhaNumber: "bad" })).toThrow(InvalidAbhaError);
  });

  it("rejects empty product list", () => {
    expect(() => buildMedicationDispense({ ...ok, products: [] })).toThrow(InvalidDispenseInputError);
  });

  it("emits one Medication resource per line", () => {
    const r = buildMedicationDispense({
      ...ok,
      products: [
        { drugName: "A", qtyDispensed: 1 },
        { drugName: "B", qtyDispensed: 1 },
        { drugName: "C", qtyDispensed: 1 },
      ],
    });
    expect(r.contained).toHaveLength(3);
  });

  it("includes SNOMED code when supplied", () => {
    const r = buildMedicationDispense({
      ...ok,
      products: [{ drugName: "Crocin", snomedCt: "387517004", qtyDispensed: 1 }],
    });
    const med = r.contained[0] as { code: { coding: { system: string; code: string }[] } };
    expect(med.code.coding[0]?.system).toBe("http://snomed.info/sct");
  });
});

describe("retry math", () => {
  it("attempt 0 → 1 minute later", () => {
    const a = nextRetryAfter(0, "2026-04-28T10:00:00Z");
    expect(a).toBe("2026-04-28T10:01:00.000Z");
  });
  it("attempt 1 → 5 minutes later", () => {
    const a = nextRetryAfter(1, "2026-04-28T10:00:00Z");
    expect(a).toBe("2026-04-28T10:05:00.000Z");
  });
  it("attempt MAX → undefined (no further retries)", () => {
    expect(nextRetryAfter(MAX_RETRY_ATTEMPTS)).toBeUndefined();
  });
});

describe("shouldRetry", () => {
  it("false when status not failed", () => {
    const a: PushAttempt = { billId: "b1", attemptNo: 0, attemptedAt: "x", status: "ok" };
    expect(shouldRetry(a)).toBe(false);
  });
  it("false when attempts exhausted", () => {
    const a: PushAttempt = { billId: "b1", attemptNo: MAX_RETRY_ATTEMPTS, attemptedAt: "x", status: "failed" };
    expect(shouldRetry(a)).toBe(false);
  });
  it("false when nextRetryAt is in the future", () => {
    const a: PushAttempt = {
      billId: "b1", attemptNo: 0, attemptedAt: "x", status: "failed",
      nextRetryAt: "2099-01-01T00:00:00Z",
    };
    expect(shouldRetry(a)).toBe(false);
  });
  it("true when nextRetryAt has passed", () => {
    const a: PushAttempt = {
      billId: "b1", attemptNo: 0, attemptedAt: "x", status: "failed",
      nextRetryAt: "2020-01-01T00:00:00Z",
    };
    expect(shouldRetry(a)).toBe(true);
  });
});

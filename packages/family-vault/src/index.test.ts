import { describe, it, expect } from "vitest";
import {
  addMember, removeMember, updateMemberConsent, findMember,
  canPerform, assertCanPerform, buildConsolidatedLog,
  CircularRelationError, DuplicateMemberError, ConsentDeniedError,
  type Family, type FamilyMember, type MedicationLogEntry,
} from "./index.js";

const F: Family = {
  id: "fam_sharma", headOfFamilyCustomerId: "c_priya",
  displayName: "Sharma family",
  members: [],
  createdAt: "2026-01-01",
};

const member = (customerId: string, partial: Partial<FamilyMember> = {}): FamilyMember => ({
  customerId, relation: "child", addedAt: "2026-01-15",
  canViewMedicationHistory: false, canRequestRefillOnBehalf: false, canScheduleAppointments: false,
  ...partial,
});

describe("addMember / removeMember", () => {
  it("adds a member", () => {
    const next = addMember(F, member("c_arjun", { relation: "spouse" }));
    expect(next.members).toHaveLength(1);
  });
  it("rejects adding head as member", () => {
    expect(() => addMember(F, member("c_priya"))).toThrow(CircularRelationError);
  });
  it("rejects duplicate", () => {
    const f = addMember(F, member("c_arjun"));
    expect(() => addMember(f, member("c_arjun"))).toThrow(DuplicateMemberError);
  });
  it("removes a member", () => {
    const f = addMember(F, member("c_arjun"));
    const removed = removeMember(f, "c_arjun");
    expect(removed.members).toHaveLength(0);
  });
});

describe("updateMemberConsent", () => {
  it("updates a single flag", () => {
    const f = addMember(F, member("c_arjun"));
    const updated = updateMemberConsent(f, "c_arjun", { canViewMedicationHistory: true });
    expect(updated.members[0]?.canViewMedicationHistory).toBe(true);
    expect(updated.members[0]?.canRequestRefillOnBehalf).toBe(false);
  });
});

describe("canPerform", () => {
  const f = addMember(F, member("c_arjun", { canViewMedicationHistory: true, canRequestRefillOnBehalf: true }));
  const f2 = addMember(f, member("c_baby"));     // no consent

  it("head of family can do anything for any member", () => {
    expect(canPerform(f2, "c_priya", "c_arjun", "view_medication_history")).toBe(true);
    expect(canPerform(f2, "c_priya", "c_baby",  "request_refill")).toBe(true);
  });

  it("self always allowed", () => {
    expect(canPerform(f2, "c_arjun", "c_arjun", "request_refill")).toBe(true);
  });

  it("requires explicit per-member consent for cross-member action", () => {
    expect(canPerform(f2, "c_arjun", "c_baby", "view_medication_history")).toBe(false);
  });

  it("respects granted consent", () => {
    expect(canPerform(f2, "c_arjun", "c_arjun", "request_refill")).toBe(true);
    // arjun's own consent flags allow view-history when accessed *by anyone*
    const f3 = updateMemberConsent(f2, "c_baby", { canViewMedicationHistory: true });
    expect(canPerform(f3, "c_arjun", "c_baby", "view_medication_history")).toBe(true);
  });

  it("non-member cannot view", () => {
    expect(canPerform(f2, "c_stranger", "c_arjun", "view_medication_history")).toBe(false);
  });
});

describe("assertCanPerform", () => {
  it("throws ConsentDeniedError when blocked", () => {
    const f = addMember(F, member("c_arjun"));
    expect(() => assertCanPerform(f, "c_arjun", "c_priya", "view_medication_history")).toThrow();
    // wait — head of family is c_priya so view-of-priya by arjun → false → should throw
  });
});

describe("buildConsolidatedLog", () => {
  const f1 = addMember(F, member("c_arjun", { canViewMedicationHistory: true }));
  const f = addMember(f1, member("c_baby", { canViewMedicationHistory: false }));

  const log: MedicationLogEntry[] = [
    { customerId: "c_priya", billId: "b1", billedAt: "2026-04-25", drugName: "Crocin", schedule: "OTC", qty: 10 },
    { customerId: "c_arjun", billId: "b2", billedAt: "2026-04-26", drugName: "Amoxicillin", schedule: "H", qty: 21 },
    { customerId: "c_baby",  billId: "b3", billedAt: "2026-04-27", drugName: "Pediatric drops", schedule: "OTC", qty: 1 },
    { customerId: "c_stranger", billId: "b4", billedAt: "2026-04-28", drugName: "Other", schedule: "OTC", qty: 1 },
  ];

  it("head sees everyone in family (not stranger)", () => {
    const r = buildConsolidatedLog({ family: f, viewerCustomerId: "c_priya", rawLog: log });
    expect(r.map((x) => x.customerId).sort()).toEqual(["c_arjun", "c_baby", "c_priya"]);
  });

  it("non-head sees only consenting members + self", () => {
    const r = buildConsolidatedLog({ family: f, viewerCustomerId: "c_arjun", rawLog: log });
    // c_arjun sees self only (c_baby withholds consent; c_priya is head and not auto-shared)
    expect(r.find((x) => x.customerId === "c_baby")).toBeUndefined();
    expect(r.find((x) => x.customerId === "c_arjun")).toBeDefined();
  });

  it("results are sorted newest-first", () => {
    const r = buildConsolidatedLog({ family: f, viewerCustomerId: "c_priya", rawLog: log });
    for (let i = 1; i < r.length; i++) {
      expect(Date.parse(r[i - 1]!.billedAt)).toBeGreaterThanOrEqual(Date.parse(r[i]!.billedAt));
    }
  });

  it("excludes non-family members from log", () => {
    const r = buildConsolidatedLog({ family: f, viewerCustomerId: "c_priya", rawLog: log });
    expect(r.find((x) => x.customerId === "c_stranger")).toBeUndefined();
  });
});

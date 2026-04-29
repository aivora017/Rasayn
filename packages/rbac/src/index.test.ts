import { describe, it, expect } from "vitest";
import {
  can, canWithOverrides, requiresMfa, assertCan, assertCanWithOverrides,
  migrateLegacyRole, listPermissions, rolePermsDiff,
  PermissionDeniedError, ROLE_PERMS,
  type Role, type Permission, type PermissionOverride,
} from "./index.js";

describe("can — basic role checks", () => {
  it("owner can do everything in the matrix", () => {
    const ownerPerms = listPermissions("owner");
    for (const p of ownerPerms) expect(can("owner", p)).toBe(true);
  });

  it("cashier cannot void a bill", () => {
    expect(can("cashier", "bill.void")).toBe(false);
  });

  it("cashier can create a bill", () => {
    expect(can("cashier", "bill.create")).toBe(true);
  });

  it("technician cannot dispense Schedule X (licensed pharmacist required)", () => {
    expect(can("technician", "schedX.dispense")).toBe(false);
    expect(can("pharmacist", "schedX.dispense")).toBe(true);
  });

  it("manager cannot dispense Schedule X (licensed pharmacist required)", () => {
    expect(can("manager", "schedX.dispense")).toBe(false);
  });

  it("manager cannot edit RBAC (owner-only)", () => {
    expect(can("manager", "rbac.edit")).toBe(false);
    expect(can("owner", "rbac.edit")).toBe(true);
  });

  it("pharmacist cannot adjust stock (manager+)", () => {
    expect(can("pharmacist", "stock.adjust")).toBe(false);
    expect(can("manager", "stock.adjust")).toBe(true);
  });

  it("only owner can write off khata (manager can't)", () => {
    expect(can("manager", "khata.writeOff")).toBe(false);
    expect(can("owner", "khata.writeOff")).toBe(true);
  });

  it("only owner approves variance at shift close", () => {
    expect(can("manager", "shift.varianceApprove")).toBe(false);
    expect(can("owner", "shift.varianceApprove")).toBe(true);
  });
});

describe("canWithOverrides", () => {
  it("override grant elevates technician for one permission", () => {
    const ovr: readonly PermissionOverride[] = [
      { permission: "stock.adjust", granted: true },
    ];
    expect(canWithOverrides("technician", "stock.adjust", ovr)).toBe(true);
    expect(canWithOverrides("technician", "rbac.edit", ovr)).toBe(false);
  });

  it("override revoke disables a default-allowed permission", () => {
    const ovr: readonly PermissionOverride[] = [
      { permission: "bill.create", granted: false },
    ];
    expect(canWithOverrides("cashier", "bill.create", ovr)).toBe(false);
  });

  it("no overrides falls through to role default", () => {
    expect(canWithOverrides("manager", "bill.void", [])).toBe(true);
    expect(canWithOverrides("cashier", "bill.void", [])).toBe(false);
  });
});

describe("requiresMfa", () => {
  it("flags sensitive financial permissions", () => {
    expect(requiresMfa("bill.void")).toBe(true);
    expect(requiresMfa("tender.reverse")).toBe(true);
    expect(requiresMfa("khata.writeOff")).toBe(true);
  });

  it("flags compliance-override permissions", () => {
    expect(requiresMfa("expiry.override")).toBe(true);
    expect(requiresMfa("schedX.dispense")).toBe(true);
    expect(requiresMfa("nppa.override")).toBe(true);
  });

  it("flags admin permissions", () => {
    expect(requiresMfa("rbac.edit")).toBe(true);
    expect(requiresMfa("user.manage")).toBe(true);
    expect(requiresMfa("plugin.install")).toBe(true);
  });

  it("does not flag routine permissions", () => {
    expect(requiresMfa("bill.create")).toBe(false);
    expect(requiresMfa("report.view.financial")).toBe(false);
    expect(requiresMfa("copilot.ask")).toBe(false);
  });
});

describe("assertCan / assertCanWithOverrides", () => {
  it("assertCan throws PermissionDeniedError when denied", () => {
    expect(() => assertCan("cashier", "bill.void")).toThrow(PermissionDeniedError);
  });

  it("assertCan does not throw when allowed", () => {
    expect(() => assertCan("owner", "bill.void")).not.toThrow();
  });

  it("PermissionDeniedError carries role + perm + mfaRequired", () => {
    try {
      assertCan("cashier", "bill.void");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PermissionDeniedError);
      const pe = e as PermissionDeniedError;
      expect(pe.code).toBe("PERMISSION_DENIED");
      expect(pe.role).toBe("cashier");
      expect(pe.perm).toBe("bill.void");
      expect(pe.mfaRequired).toBe(true);
    }
  });

  it("assertCanWithOverrides honors a grant override", () => {
    const ovr: readonly PermissionOverride[] = [{ permission: "stock.adjust", granted: true }];
    expect(() => assertCanWithOverrides("technician", "stock.adjust", ovr)).not.toThrow();
  });
});

describe("migrateLegacyRole", () => {
  it("maps viewer → technician (matches migration 0025)", () => {
    expect(migrateLegacyRole("viewer")).toBe("technician");
  });
  it("preserves valid v1 roles", () => {
    expect(migrateLegacyRole("owner")).toBe("owner");
    expect(migrateLegacyRole("manager")).toBe("manager");
    expect(migrateLegacyRole("pharmacist")).toBe("pharmacist");
    expect(migrateLegacyRole("technician")).toBe("technician");
    expect(migrateLegacyRole("cashier")).toBe("cashier");
  });
  it("defaults unknown roles to technician (safe)", () => {
    expect(migrateLegacyRole("god-mode")).toBe("technician");
    expect(migrateLegacyRole("")).toBe("technician");
  });
});

describe("listPermissions / rolePermsDiff", () => {
  it("returns permission set for role, sorted", () => {
    const ps = listPermissions("cashier");
    const sorted = [...ps].sort();
    expect(ps).toEqual(sorted);
  });

  it("rolePermsDiff(owner, cashier) — owner has many extras, cashier has zero extras", () => {
    const { onlyA, onlyB } = rolePermsDiff("owner", "cashier");
    expect(onlyA.length).toBeGreaterThan(20);
    expect(onlyB.length).toBe(0);
  });

  it("rolePermsDiff(role, role) is empty", () => {
    expect(rolePermsDiff("manager", "manager")).toEqual({ onlyA: [], onlyB: [] });
  });

  it("manager has more than pharmacist (admin scope)", () => {
    const { onlyA, onlyB } = rolePermsDiff("manager", "pharmacist");
    expect(onlyA.length).toBeGreaterThan(0);
    expect(onlyB.length).toBeLessThanOrEqual(onlyA.length);
  });
});

describe("matrix completeness sanity", () => {
  it("every role has at least one permission", () => {
    for (const role of ["owner","manager","pharmacist","technician","cashier"] as Role[]) {
      expect(ROLE_PERMS[role].size).toBeGreaterThan(0);
    }
  });

  it("every defined permission is exercised by at least one role (no orphans)", () => {
    const allRolesUnion = new Set<Permission>();
    for (const r of Object.keys(ROLE_PERMS) as Role[]) {
      for (const p of ROLE_PERMS[r]) allRolesUnion.add(p);
    }
    // owner must hold every defined permission (super-set property)
    for (const p of allRolesUnion) {
      expect(ROLE_PERMS.owner.has(p)).toBe(true);
    }
  });
});

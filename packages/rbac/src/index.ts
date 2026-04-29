// @pharmacare/rbac
// Role-based access control. 5 roles · permission matrix · MFA gate on
// sensitive actions. ADR-0038.
//
// Used by every other feature. Pure synchronous logic — no DB calls — so
// callers (Tauri commands, React screens, plugins) can `can(role, perm)`
// in any layer without round-tripping. Role for the current user is loaded
// once on shop_local boot and cached in @pharmacare/desktop AuthContext.

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type Role = "owner" | "manager" | "pharmacist" | "technician" | "cashier";

export type Permission =
  // Billing
  | "bill.create"
  | "bill.void"
  | "bill.discount.over10pct"
  | "bill.applyManualPrice"
  // Returns / refunds
  | "return.partial"
  | "return.fullBill"
  | "tender.reverse"
  // Compliance overrides
  | "expiry.override"
  | "schedX.dispense"
  | "nppa.override"
  // Stock
  | "stock.adjust"
  | "stock.transfer.outbound"
  | "stock.transfer.inbound"
  // Settings + admin
  | "settings.edit"
  | "user.manage"
  | "rbac.edit"
  // Reports
  | "report.view.financial"
  | "report.view.compliance"
  | "report.export"
  // Khata
  | "khata.recordPayment"
  | "khata.writeOff"
  | "khata.changeLimit"
  // Cash shift
  | "shift.open"
  | "shift.close"
  | "shift.varianceApprove"
  // Plugins
  | "plugin.install"
  | "plugin.invoke"
  // AI / Copilot (separate scope so an owner can keep AI off but still get reports)
  | "copilot.ask"
  | "copilot.actionExecute"
  // Inspector mode
  | "inspector.report.generate"
  | "inspector.report.export";

// ────────────────────────────────────────────────────────────────────────
// The matrix. Add a row per role; permissions ARE additive (no inheritance).
// Owner gets everything; cashier the absolute minimum to ring up bills.
// ────────────────────────────────────────────────────────────────────────

export const ROLE_PERMS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set<Permission>([
    "bill.create", "bill.void", "bill.discount.over10pct", "bill.applyManualPrice",
    "return.partial", "return.fullBill", "tender.reverse",
    "expiry.override", "schedX.dispense", "nppa.override",
    "stock.adjust", "stock.transfer.outbound", "stock.transfer.inbound",
    "settings.edit", "user.manage", "rbac.edit",
    "report.view.financial", "report.view.compliance", "report.export",
    "khata.recordPayment", "khata.writeOff", "khata.changeLimit",
    "shift.open", "shift.close", "shift.varianceApprove",
    "plugin.install", "plugin.invoke",
    "copilot.ask", "copilot.actionExecute",
    "inspector.report.generate", "inspector.report.export",
  ]),
  manager: new Set<Permission>([
    "bill.create", "bill.void", "bill.discount.over10pct", "bill.applyManualPrice",
    "return.partial", "return.fullBill", "tender.reverse",
    "expiry.override",                 // manager allowed; schedX requires owner
    "stock.adjust", "stock.transfer.outbound", "stock.transfer.inbound",
    "report.view.financial", "report.view.compliance", "report.export",
    "khata.recordPayment", "khata.changeLimit",
    "shift.open", "shift.close",       // varianceApprove gated to owner
    "plugin.invoke",
    "copilot.ask",
    "inspector.report.generate",
  ]),
  pharmacist: new Set<Permission>([
    "bill.create",
    "return.partial",
    "schedX.dispense",                  // licensed pharmacist only
    "expiry.override",
    "report.view.compliance",
    "shift.open", "shift.close",
    "copilot.ask",
  ]),
  technician: new Set<Permission>([
    "bill.create",
    "report.view.compliance",
  ]),
  cashier: new Set<Permission>([
    "bill.create",
    "khata.recordPayment",
    "shift.open", "shift.close",
  ]),
};

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/** Default role permission check. Override grants/revocations are layered
 *  via {@link canWithOverrides}. */
export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMS[role].has(perm);
}

/** Per-user override — DB rows from `rbac_permission_overrides`. */
export interface PermissionOverride {
  readonly permission: Permission;
  /** true = grant beyond role default; false = revoke from role default */
  readonly granted: boolean;
}

/** Layered check: role default, then per-user override (if any) wins. */
export function canWithOverrides(
  role: Role,
  perm: Permission,
  overrides: readonly PermissionOverride[],
): boolean {
  const ovr = overrides.find((o) => o.permission === perm);
  if (ovr) return ovr.granted;
  return can(role, perm);
}

/** True iff this permission requires MFA confirmation at use-site
 *  (TOTP or WebAuthn). Sensitive financial / compliance actions only. */
export function requiresMfa(perm: Permission): boolean {
  switch (perm) {
    case "bill.void":
    case "tender.reverse":
    case "expiry.override":
    case "schedX.dispense":
    case "nppa.override":
    case "stock.adjust":
    case "stock.transfer.outbound":
    case "rbac.edit":
    case "user.manage":
    case "khata.writeOff":
    case "shift.varianceApprove":
    case "plugin.install":
    case "copilot.actionExecute":
      return true;
    default:
      return false;
  }
}

/** Error thrown by Tauri commands / IPC layer when the actor lacks a permission. */
export class PermissionDeniedError extends Error {
  public readonly code = "PERMISSION_DENIED" as const;
  public readonly role: Role;
  public readonly perm: Permission;
  public readonly mfaRequired: boolean;
  constructor(role: Role, perm: Permission) {
    super(
      `PERMISSION_DENIED: role=${role} cannot perform ${perm}` +
      (requiresMfa(perm) ? " (also requires MFA confirmation)" : ""),
    );
    this.role = role;
    this.perm = perm;
    this.mfaRequired = requiresMfa(perm);
  }
}

/** Throw {@link PermissionDeniedError} if the actor cannot perform `perm`.
 *  Convenience wrapper for the IPC permission-gate middleware. */
export function assertCan(role: Role, perm: Permission): void {
  if (!can(role, perm)) throw new PermissionDeniedError(role, perm);
}

/** Same as {@link assertCan} but also takes per-user overrides. */
export function assertCanWithOverrides(
  role: Role,
  perm: Permission,
  overrides: readonly PermissionOverride[],
): void {
  if (!canWithOverrides(role, perm, overrides)) throw new PermissionDeniedError(role, perm);
}

/** Map a legacy v0 role string to the v1 5-role model.
 *  - 'viewer' → 'technician' (matches migration 0025 normalisation). */
export function migrateLegacyRole(legacy: string): Role {
  switch (legacy) {
    case "owner":      return "owner";
    case "pharmacist": return "pharmacist";
    case "cashier":    return "cashier";
    case "viewer":     return "technician";
    case "manager":    return "manager";       // already v1
    case "technician": return "technician";    // already v1
    default:           return "technician";    // safe default
  }
}

/** All permissions for a role (handy for UI rendering "what can I do" pills). */
export function listPermissions(role: Role): readonly Permission[] {
  return [...ROLE_PERMS[role]].sort();
}

/** Diff helper: what does role A get that role B doesn't (and vice versa). */
export function rolePermsDiff(a: Role, b: Role): { onlyA: readonly Permission[]; onlyB: readonly Permission[] } {
  const A = ROLE_PERMS[a], B = ROLE_PERMS[b];
  const onlyA: Permission[] = [];
  const onlyB: Permission[] = [];
  for (const p of A) if (!B.has(p)) onlyA.push(p);
  for (const p of B) if (!A.has(p)) onlyB.push(p);
  return { onlyA: onlyA.sort(), onlyB: onlyB.sort() };
}

// @pharmacare/family-vault
// Household medication binder. ABHA-linked when ABDM is configured; works
// standalone when not. Per-member consent for sharing medication history.
// ADR-0060.

export type Relation = "self" | "spouse" | "child" | "parent" | "sibling" | "guardian" | "other";

export interface FamilyMember {
  readonly customerId: string;
  readonly relation: Relation;
  readonly addedAt: string;
  readonly canViewMedicationHistory: boolean;   // explicit consent
  readonly canRequestRefillOnBehalf: boolean;
  readonly canScheduleAppointments: boolean;
}

export interface Family {
  readonly id: string;
  readonly headOfFamilyCustomerId: string;
  readonly displayName: string;                 // "Sharma family"
  readonly members: readonly FamilyMember[];
  readonly createdAt: string;
}

export class CircularRelationError extends Error {
  public readonly code = "CIRCULAR_RELATION" as const;
  constructor(public readonly memberId: string) { super(`CIRCULAR_RELATION: cannot add ${memberId} to a family it already heads`); }
}

export class DuplicateMemberError extends Error {
  public readonly code = "DUPLICATE_MEMBER" as const;
  constructor(public readonly customerId: string, public readonly familyId: string) {
    super(`DUPLICATE_MEMBER: ${customerId} already in family ${familyId}`);
  }
}

export class ConsentDeniedError extends Error {
  public readonly code = "CONSENT_DENIED" as const;
  constructor(public readonly memberId: string, public readonly action: string) {
    super(`CONSENT_DENIED: ${memberId} has not granted permission to ${action}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Pure operations
// ────────────────────────────────────────────────────────────────────────

export function addMember(family: Family, m: FamilyMember): Family {
  if (m.customerId === family.headOfFamilyCustomerId) {
    throw new CircularRelationError(m.customerId);
  }
  if (family.members.some((x) => x.customerId === m.customerId)) {
    throw new DuplicateMemberError(m.customerId, family.id);
  }
  return { ...family, members: [...family.members, m] };
}

export function removeMember(family: Family, customerId: string): Family {
  return { ...family, members: family.members.filter((m) => m.customerId !== customerId) };
}

export function updateMemberConsent(family: Family, customerId: string, patch: Partial<Pick<FamilyMember, "canViewMedicationHistory" | "canRequestRefillOnBehalf" | "canScheduleAppointments">>): Family {
  return {
    ...family,
    members: family.members.map((m) => m.customerId === customerId ? { ...m, ...patch } : m),
  };
}

export function findMember(family: Family, customerId: string): FamilyMember | null {
  return family.members.find((m) => m.customerId === customerId) ?? null;
}

export type FamilyAction = "view_medication_history" | "request_refill" | "schedule_appointment";

export function canPerform(family: Family, actorCustomerId: string, targetCustomerId: string, action: FamilyAction): boolean {
  // Actor must be a member of THIS family (or the head). Strangers are excluded.
  const isHead = actorCustomerId === family.headOfFamilyCustomerId;
  const isMember = isHead || family.members.some((m) => m.customerId === actorCustomerId);
  if (!isMember) return false;

  // Head of family always has rights
  if (isHead) return true;
  // Self-action always allowed
  if (actorCustomerId === targetCustomerId) return true;

  // Cross-member: target must have granted consent on the requested action.
  const target = findMember(family, targetCustomerId);
  if (!target && targetCustomerId !== family.headOfFamilyCustomerId) return false;
  if (!target) return false;       // requesting head's data without being head — denied
  switch (action) {
    case "view_medication_history": return target.canViewMedicationHistory;
    case "request_refill":          return target.canRequestRefillOnBehalf;
    case "schedule_appointment":    return target.canScheduleAppointments;
  }
}

export function assertCanPerform(family: Family, actorCustomerId: string, targetCustomerId: string, action: FamilyAction): void {
  if (!canPerform(family, actorCustomerId, targetCustomerId, action)) {
    throw new ConsentDeniedError(targetCustomerId, action);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Consolidated medication log
// ────────────────────────────────────────────────────────────────────────

export interface MedicationLogEntry {
  readonly customerId: string;
  readonly billId: string;
  readonly billedAt: string;
  readonly drugName: string;
  readonly schedule: "OTC" | "H" | "H1" | "X";
  readonly qty: number;
  readonly doctorName?: string;
}

/** Build a consolidated log respecting per-member consent. Members who haven't
 *  consented to view-medication-history are filtered out. */
export function buildConsolidatedLog(args: {
  family: Family;
  viewerCustomerId: string;
  rawLog: readonly MedicationLogEntry[];
}): readonly MedicationLogEntry[] {
  const visibleMemberIds = new Set<string>([args.family.headOfFamilyCustomerId]);
  for (const m of args.family.members) {
    if (canPerform(args.family, args.viewerCustomerId, m.customerId, "view_medication_history")) {
      visibleMemberIds.add(m.customerId);
    }
  }
  return args.rawLog.filter((e) => visibleMemberIds.has(e.customerId))
    .sort((a, b) => Date.parse(b.billedAt) - Date.parse(a.billedAt));
}

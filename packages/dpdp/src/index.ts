// @pharmacare/dpdp
// Digital Personal Data Protection Act 2023 — consent registry + DSR queue.
// ADR-0053. Pure logic over preloaded consent + DSR rows; auto-respond
// drafting is handled by @pharmacare/ai-copilot.

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type ConsentPurpose =
  | "billing"
  | "compliance"
  | "marketing"
  | "abdm"
  | "loyalty"
  | "research-anon";

export type DsrKind = "access" | "erasure" | "correction" | "portability";
export type DsrStatus = "received" | "verifying" | "in-progress" | "fulfilled" | "rejected";

export interface Consent {
  readonly customerId: string;
  readonly purpose: ConsentPurpose;
  readonly granted: boolean;
  readonly grantedAt?: string;
  readonly withdrawnAt?: string;
  readonly evidence: string;
}

export interface DsrRequest {
  readonly id: string;
  readonly customerId: string;
  readonly kind: DsrKind;
  readonly receivedAt: string;
  readonly status: DsrStatus;
  readonly fulfilledAt?: string;
  readonly responsePayloadPath?: string;
  readonly handledByUserId?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Consent registry
// ────────────────────────────────────────────────────────────────────────

/** True iff the customer currently has effective (granted, not withdrawn) consent for the purpose. */
export function hasEffectiveConsent(
  consents: readonly Consent[],
  customerId: string,
  purpose: ConsentPurpose,
): boolean {
  const c = consents.find((x) => x.customerId === customerId && x.purpose === purpose);
  if (!c) return false;
  return c.granted === true && !c.withdrawnAt;
}

/** All currently-effective consents for a customer. */
export function effectiveConsents(consents: readonly Consent[], customerId: string): readonly ConsentPurpose[] {
  return consents
    .filter((c) => c.customerId === customerId && c.granted && !c.withdrawnAt)
    .map((c) => c.purpose);
}

// ────────────────────────────────────────────────────────────────────────
// DSR (Data-Subject-Rights) state machine
// ────────────────────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<DsrStatus, readonly DsrStatus[]> = {
  "received":     ["verifying", "rejected"],
  "verifying":    ["in-progress", "rejected"],
  "in-progress":  ["fulfilled", "rejected"],
  "fulfilled":    [],
  "rejected":     [],
};

export class InvalidDsrTransitionError extends Error {
  public readonly code = "INVALID_DSR_TRANSITION" as const;
  constructor(from: DsrStatus, to: DsrStatus) {
    super(`INVALID_DSR_TRANSITION: ${from} → ${to} not allowed`);
  }
}

export function canTransition(from: DsrStatus, to: DsrStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function transition(req: DsrRequest, to: DsrStatus, atIso: string, by?: string): DsrRequest {
  if (!canTransition(req.status, to)) throw new InvalidDsrTransitionError(req.status, to);
  if (to === "fulfilled" || to === "rejected") {
    return {
      ...req, status: to,
      fulfilledAt: atIso,
      ...(by !== undefined ? { handledByUserId: by } : {}),
    };
  }
  return {
    ...req, status: to,
    ...(by !== undefined ? { handledByUserId: by } : {}),
  };
}

// ────────────────────────────────────────────────────────────────────────
// DPDP statutory clock — 30 days to fulfil per Section 11.
// ────────────────────────────────────────────────────────────────────────

export const DSR_STATUTORY_LIMIT_MS = 30 * 24 * 60 * 60 * 1000;

export interface DsrUrgency {
  readonly id: string;
  readonly customerId: string;
  readonly kind: DsrKind;
  readonly hoursLeft: number;
  readonly category: "ok" | "warning" | "overdue";
}

export function dsrUrgency(req: DsrRequest, now: Date = new Date()): DsrUrgency {
  if (req.status === "fulfilled" || req.status === "rejected") {
    return { id: req.id, customerId: req.customerId, kind: req.kind, hoursLeft: Number.POSITIVE_INFINITY, category: "ok" };
  }
  const elapsedMs = now.getTime() - Date.parse(req.receivedAt);
  const remainingMs = DSR_STATUTORY_LIMIT_MS - elapsedMs;
  const hoursLeft = remainingMs / (60 * 60 * 1000);
  const category: DsrUrgency["category"] = hoursLeft <= 0 ? "overdue"
    : hoursLeft < 7 * 24 ? "warning"
    : "ok";
  return { id: req.id, customerId: req.customerId, kind: req.kind, hoursLeft, category };
}

// ────────────────────────────────────────────────────────────────────────
// Erasure scope — what tables to wipe for an erasure DSR.
// ────────────────────────────────────────────────────────────────────────

/** Tables we MUST scrub on a granted erasure DSR. Ordering matters
 *  (children → parents) for FK-safe DELETE. */
export const ERASURE_TABLES_ORDERED: readonly string[] = [
  "loyalty_cashback",
  "khata_entries",
  "khata_customer_limits",
  "abdm_dispensations",
  "abha_profiles",
  "customer_allergies",
  "prescriptions",
  "dpdp_consents",
  "customers",
];

/** Tables we MUST PRESERVE due to statutory retention even on erasure
 *  (drug register retention 2y+, GST audit 7y, etc). On erasure we
 *  pseudonymize identifiers in these rows rather than delete them. */
export const ERASURE_RETAINED_TABLES: readonly string[] = [
  "bills",
  "bill_lines",
  "audit_log",
  "expiry_override_audit",
  "irn_records",
];

// ────────────────────────────────────────────────────────────────────────
// Validation helpers
// ────────────────────────────────────────────────────────────────────────

export class InvalidConsentError extends Error {
  public readonly code = "INVALID_CONSENT" as const;
  constructor(reason: string) { super(`INVALID_CONSENT: ${reason}`); }
}

export function validateConsent(c: Consent): void {
  if (c.granted && !c.grantedAt) throw new InvalidConsentError("granted=true requires grantedAt");
  if (c.withdrawnAt && c.granted) throw new InvalidConsentError("withdrawn consent must have granted=false");
  if (!c.evidence || c.evidence.trim().length === 0) {
    throw new InvalidConsentError("evidence is required (signed-statement-ref / OTP-ref / paper-form-ref)");
  }
}

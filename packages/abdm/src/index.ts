// @pharmacare/abdm
// Ayushman Bharat Digital Mission. ABHA verification state machine
// + FHIR R4 MedicationDispense builder. ADR-0052.
// Live NHA gateway HTTP calls are deferred — this package has the
// types, validation, builder, and state machine to be unit-testable.

// ────────────────────────────────────────────────────────────────────────
// ABHA — Ayushman Bharat Health Account
// ────────────────────────────────────────────────────────────────────────

const ABHA_RE_14 = /^\d{2}-\d{4}-\d{4}-\d{4}$/;     // 14-digit hyphenated
const ABHA_RE_PLAIN = /^\d{14}$/;                    // 14-digit no hyphen

/** Validate ABHA number format (14 digits, with or without hyphens). */
export function isValidAbhaFormat(abha: string): boolean {
  return ABHA_RE_14.test(abha) || ABHA_RE_PLAIN.test(abha);
}

/** Normalize ABHA to canonical hyphenated form. */
export function normalizeAbha(abha: string): string {
  if (!isValidAbhaFormat(abha)) throw new InvalidAbhaError(abha);
  const digits = abha.replace(/[^\d]/g, "");
  return `${digits.slice(0,2)}-${digits.slice(2,6)}-${digits.slice(6,10)}-${digits.slice(10,14)}`;
}

/** Verhoeff checksum on the 14 digits (ABHA spec uses Verhoeff for last digit). */
export function isValidAbhaChecksum(abha: string): boolean {
  if (!isValidAbhaFormat(abha)) return false;
  const digits = abha.replace(/[^\d]/g, "");
  // Verhoeff multiplication & permutation tables
  const d: number[][] = [
    [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],
    [4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],
    [8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0],
  ];
  const p: number[][] = [
    [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
    [9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8],
  ];
  let c = 0;
  const reversed = digits.split("").reverse().map(Number);
  for (let i = 0; i < reversed.length; i++) {
    c = d[c]![p[i % 8]![reversed[i]!]!]!;
  }
  return c === 0;
}

export class InvalidAbhaError extends Error {
  public readonly code = "INVALID_ABHA" as const;
  constructor(abha: string) { super(`INVALID_ABHA: ${abha} — must be 14 digits (with or without hyphens)`); }
}

export interface AbhaProfile {
  readonly abhaNumber: string;        // canonical hyphenated
  readonly name: string;
  readonly dob?: string;              // YYYY-MM-DD
  readonly gender?: "M" | "F" | "O";
  readonly mobileE164?: string;
  readonly verifiedAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// Verification state machine
// ────────────────────────────────────────────────────────────────────────

export type VerificationStatus =
  | "not-started"
  | "otp-sent"
  | "otp-verified"
  | "consent-pending"
  | "consent-granted"
  | "consent-denied"
  | "verified"
  | "failed";

const VERIFY_TRANSITIONS: Record<VerificationStatus, readonly VerificationStatus[]> = {
  "not-started":     ["otp-sent", "failed"],
  "otp-sent":        ["otp-verified", "failed"],
  "otp-verified":    ["consent-pending", "verified", "failed"],
  "consent-pending": ["consent-granted", "consent-denied", "failed"],
  "consent-granted": ["verified"],
  "consent-denied":  [],
  "verified":        [],
  "failed":          [],
};

export class InvalidVerificationTransitionError extends Error {
  public readonly code = "INVALID_VERIFICATION_TRANSITION" as const;
  constructor(from: VerificationStatus, to: VerificationStatus) {
    super(`INVALID_VERIFICATION_TRANSITION: ${from} → ${to}`);
  }
}

export function canVerifyTransition(from: VerificationStatus, to: VerificationStatus): boolean {
  return VERIFY_TRANSITIONS[from].includes(to);
}

export function verifyTransition(from: VerificationStatus, to: VerificationStatus): VerificationStatus {
  if (!canVerifyTransition(from, to)) throw new InvalidVerificationTransitionError(from, to);
  return to;
}

// ────────────────────────────────────────────────────────────────────────
// FHIR R4 MedicationDispense builder
// ────────────────────────────────────────────────────────────────────────

export interface MedicationDispenseLine {
  readonly snomedCt?: string;          // optional clinical code
  readonly drugName: string;
  readonly strength?: string;
  readonly form?: string;
  readonly qtyDispensed: number;
  readonly batchNo?: string;
}

export interface MedicationDispenseInput {
  readonly billId: string;
  readonly billedAt: string;
  readonly subjectAbhaNumber: string;
  readonly performerShopGstin: string;
  readonly performerShopName: string;
  readonly products: readonly MedicationDispenseLine[];
}

export interface FhirMedicationDispense {
  readonly resourceType: "MedicationDispense";
  readonly id: string;
  readonly status: "completed";
  readonly subject: { readonly identifier: { readonly system: string; readonly value: string } };
  readonly performer: ReadonlyArray<{
    readonly actor: { readonly identifier: { readonly system: string; readonly value: string }; readonly display: string };
  }>;
  readonly authorizingPrescription?: ReadonlyArray<{ readonly identifier: { readonly value: string } }>;
  readonly contained: readonly unknown[];        // per-line Medication resources
  readonly whenHandedOver: string;
  readonly note?: ReadonlyArray<{ readonly text: string }>;
}

export function buildMedicationDispense(input: MedicationDispenseInput): FhirMedicationDispense {
  if (!isValidAbhaFormat(input.subjectAbhaNumber)) {
    throw new InvalidAbhaError(input.subjectAbhaNumber);
  }
  if (input.products.length === 0) {
    throw new InvalidDispenseInputError("at least one product line required");
  }
  const abha = normalizeAbha(input.subjectAbhaNumber);

  const contained = input.products.map((p, i) => ({
    resourceType: "Medication",
    id: `med-${i + 1}`,
    code: {
      coding: [
        ...(p.snomedCt ? [{ system: "http://snomed.info/sct", code: p.snomedCt }] : []),
      ],
      text: [p.drugName, p.strength, p.form].filter(Boolean).join(" "),
    },
    batch: p.batchNo ? { lotNumber: p.batchNo } : undefined,
    quantity: { value: p.qtyDispensed, unit: p.form ?? "unit" },
  }));

  return {
    resourceType: "MedicationDispense",
    id: input.billId,
    status: "completed",
    subject: {
      identifier: { system: "https://healthid.ndhm.gov.in", value: abha },
    },
    performer: [{
      actor: {
        identifier: { system: "https://gst.gov.in", value: input.performerShopGstin },
        display: input.performerShopName,
      },
    }],
    contained,
    whenHandedOver: input.billedAt,
  };
}

export class InvalidDispenseInputError extends Error {
  public readonly code = "INVALID_DISPENSE_INPUT" as const;
  constructor(reason: string) { super(`INVALID_DISPENSE_INPUT: ${reason}`); }
}

// ────────────────────────────────────────────────────────────────────────
// Push status + retry
// ────────────────────────────────────────────────────────────────────────

export type PushStatus = "pending" | "ok" | "failed";

export interface PushAttempt {
  readonly billId: string;
  readonly attemptNo: number;
  readonly attemptedAt: string;
  readonly status: PushStatus;
  readonly uhiEventId?: string;
  readonly errorReason?: string;
  readonly nextRetryAt?: string;       // ISO; populated when status=failed and retries remaining
}

export const MAX_RETRY_ATTEMPTS = 5;

/** Exponential backoff: 1m, 5m, 30m, 4h, 24h. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 4 * 60 * 60_000, 24 * 60 * 60_000] as const;

export function nextRetryAfter(attemptNo: number, fromIso: string = new Date().toISOString()): string | undefined {
  if (attemptNo >= MAX_RETRY_ATTEMPTS) return undefined;
  const ms = BACKOFF_MS[Math.min(attemptNo, BACKOFF_MS.length - 1)] ?? 24 * 60 * 60_000;
  return new Date(Date.parse(fromIso) + ms).toISOString();
}

export function shouldRetry(attempt: PushAttempt, now: Date = new Date()): boolean {
  if (attempt.status !== "failed") return false;
  if (attempt.attemptNo >= MAX_RETRY_ATTEMPTS) return false;
  if (!attempt.nextRetryAt) return false;
  return now.getTime() >= Date.parse(attempt.nextRetryAt);
}

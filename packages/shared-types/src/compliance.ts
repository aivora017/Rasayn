// India pharmacy compliance enums. See v2.0 Playbook \u00a78.8.

/** Drugs & Cosmetics Act 1940 schedules relevant to retail pharmacy. */
export type DrugSchedule =
  | "OTC"   // No Rx required
  | "G"     // Warning label, dispensed under medical supervision
  | "H"     // Rx required; record in H register
  | "H1"    // Antibiotics/habit-forming \u2014 2-year retention, stricter register
  | "X"     // Psychotropics \u2014 duplicate Rx, NDPS-adjacent
  | "NDPS"; // Narcotic Drugs & Psychotropic Substances Act \u2014 Form IV register

/** HSN codes for pharmaceutical retail (CBIC). */
export type HSN =
  | "3003" // Medicaments (not packed for retail)
  | "3004" // Medicaments (packed for retail sale)
  | "3005" // Wadding, gauze, bandages
  | "3006" // Pharmaceutical goods (diagnostic, contraceptives, etc.)
  | "9018" // Medical instruments
  | string; // escape hatch for non-pharma SKUs (FSSAI, cosmetics)

/** GST rate slabs applicable to pharma retail. */
export type GstRate = 0 | 5 | 12 | 18 | 28;

export type GstTreatment = "intra_state" | "inter_state" | "exempt" | "nil_rated";

/** State code (GSTIN first 2 digits). */
export type StateCode = string; // "27" = Maharashtra, etc.

/** FEFO dispensing policy. Enforced at sale time. */
export interface FefoPolicy {
  readonly blockExpired: true;            // HARD block \u2014 non-negotiable
  readonly warnDaysBeforeExpiry: number;  // default 60
  readonly preferNearestExpiry: true;     // FEFO, not FIFO
}

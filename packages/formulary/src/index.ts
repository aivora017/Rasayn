// @pharmacare/formulary
// DDI / allergy / dose-appropriateness check engine.
// ADR-0034. Pure logic over a preloaded formulary table set
// (FDA Orange Book + CIMS-India + BNF dose ranges, seeded via
// migration 0026_formulary.sql).
//
// At runtime callers pass in:
//   - the loaded formulary tables (or query helpers)
//   - the basket the cashier is about to bill
//   - the customer's recorded allergies + age + weight (if known)
//
// We return zero or more alerts (severity info / warn / block).

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export interface Ingredient {
  readonly id: string;
  readonly inn: string;
  readonly atcClass?: string;
  readonly isAllergenCommon: boolean;
}

export interface ProductIngredient {
  readonly productId: string;
  readonly ingredientId: string;
  readonly strengthMg?: number;
}

export type Severity = "info" | "warn" | "block";

export interface DdiPair {
  readonly ingredientA: string;          // canonical: a < b
  readonly ingredientB: string;
  readonly severity: Severity;
  readonly mechanism?: string;
  readonly clinicalEffect?: string;
  readonly references?: readonly string[];
}

export interface DoseRange {
  readonly ingredientId: string;
  readonly ageMinYears: number;
  readonly ageMaxYears: number;
  readonly dailyMinMg?: number;
  readonly dailyMaxMg?: number;
  readonly perDoseMaxMg?: number;
}

export interface CustomerAllergy {
  readonly customerId: string;
  readonly ingredientId: string;
  readonly severity: "warn" | "block";
}

// ────────────────────────────────────────────────────────────────────────
// Alerts
// ────────────────────────────────────────────────────────────────────────

export interface DDIAlert {
  readonly kind: "ddi";
  readonly severity: Severity;
  readonly productA: string;
  readonly productB: string;
  readonly ingredientA: string;
  readonly ingredientB: string;
  readonly mechanism?: string;
  readonly clinicalEffect?: string;
  readonly references?: readonly string[];
}

export interface AllergyAlert {
  readonly kind: "allergy";
  readonly severity: "warn" | "block";
  readonly product: string;
  readonly ingredientId: string;
  readonly customerId: string;
}

export interface DoseAlert {
  readonly kind: "dose";
  readonly severity: Severity;
  readonly product: string;
  readonly ingredientId: string;
  readonly reason: "exceeds_per_dose_max" | "exceeds_daily_max" | "below_daily_min" | "no_pediatric_data";
  readonly limitMg?: number;
  readonly observedMg?: number;
}

export type FormularyAlert = DDIAlert | AllergyAlert | DoseAlert;

// ────────────────────────────────────────────────────────────────────────
// Helpers — canonical pair ordering
// ────────────────────────────────────────────────────────────────────────

export function canonicalPair(a: string, b: string): readonly [string, string] {
  return a < b ? [a, b] : [b, a];
}

// ────────────────────────────────────────────────────────────────────────
// DDI check
// ────────────────────────────────────────────────────────────────────────

export interface DdiCheckArgs {
  readonly basket: ReadonlyArray<{ productId: string; ingredientIds: readonly string[] }>;
  readonly ddiTable: readonly DdiPair[];
}

export function checkDDI(args: DdiCheckArgs): readonly DDIAlert[] {
  // Index DDI pairs for O(1) lookup. Normalize each pair to canonical (a < b)
  // so callers don't have to pre-sort their formulary table.
  const ddiIdx = new Map<string, DdiPair>();
  for (const p of args.ddiTable) {
    const [k1, k2] = canonicalPair(p.ingredientA, p.ingredientB);
    ddiIdx.set(`${k1}|${k2}`, p);
  }

  const alerts: DDIAlert[] = [];
  const items = args.basket;

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!, b = items[j]!;
      for (const aIng of a.ingredientIds) {
        for (const bIng of b.ingredientIds) {
          if (aIng === bIng) continue;
          const [k1, k2] = canonicalPair(aIng, bIng);
          const hit = ddiIdx.get(`${k1}|${k2}`);
          if (hit) {
            alerts.push({
              kind: "ddi",
              severity: hit.severity,
              productA: a.productId, productB: b.productId,
              ingredientA: k1, ingredientB: k2,
              ...(hit.mechanism      !== undefined ? { mechanism: hit.mechanism } : {}),
              ...(hit.clinicalEffect !== undefined ? { clinicalEffect: hit.clinicalEffect } : {}),
              ...(hit.references     !== undefined ? { references: hit.references } : {}),
            });
          }
        }
      }
    }
  }
  return alerts;
}

// ────────────────────────────────────────────────────────────────────────
// Allergy check
// ────────────────────────────────────────────────────────────────────────

export interface AllergyCheckArgs {
  readonly customerId: string;
  readonly basket: ReadonlyArray<{ productId: string; ingredientIds: readonly string[] }>;
  readonly customerAllergies: readonly CustomerAllergy[];
}

export function checkAllergies(args: AllergyCheckArgs): readonly AllergyAlert[] {
  const allergyIdx = new Map<string, CustomerAllergy>();
  for (const a of args.customerAllergies) {
    if (a.customerId === args.customerId) {
      allergyIdx.set(a.ingredientId, a);
    }
  }
  const out: AllergyAlert[] = [];
  for (const item of args.basket) {
    for (const ing of item.ingredientIds) {
      const al = allergyIdx.get(ing);
      if (al) {
        out.push({
          kind: "allergy",
          severity: al.severity,
          product: item.productId,
          ingredientId: ing,
          customerId: args.customerId,
        });
      }
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Dose-appropriateness
// ────────────────────────────────────────────────────────────────────────

export interface DoseCheckArgs {
  readonly basket: ReadonlyArray<{
    productId: string;
    ingredientIds: readonly string[];
    perDoseMg?: number;
    dailyMg?: number;
  }>;
  readonly doseRanges: readonly DoseRange[];
  readonly patientAgeYears: number;
}

export function checkDoses(args: DoseCheckArgs): readonly DoseAlert[] {
  // Group dose ranges by ingredient
  const byIngredient = new Map<string, DoseRange[]>();
  for (const r of args.doseRanges) {
    const arr = byIngredient.get(r.ingredientId) ?? [];
    arr.push(r);
    byIngredient.set(r.ingredientId, arr);
  }
  const out: DoseAlert[] = [];

  for (const item of args.basket) {
    for (const ing of item.ingredientIds) {
      const ranges = byIngredient.get(ing);
      if (!ranges || ranges.length === 0) continue;
      const range = ranges.find((r) => args.patientAgeYears >= r.ageMinYears && args.patientAgeYears <= r.ageMaxYears);

      if (!range) {
        // No matching age band — possibly pediatric without data.
        if (args.patientAgeYears < 18) {
          out.push({
            kind: "dose", severity: "warn",
            product: item.productId, ingredientId: ing,
            reason: "no_pediatric_data",
          });
        }
        continue;
      }
      if (item.perDoseMg !== undefined && range.perDoseMaxMg !== undefined && item.perDoseMg > range.perDoseMaxMg) {
        out.push({
          kind: "dose", severity: "block",
          product: item.productId, ingredientId: ing,
          reason: "exceeds_per_dose_max",
          observedMg: item.perDoseMg, limitMg: range.perDoseMaxMg,
        });
      }
      if (item.dailyMg !== undefined && range.dailyMaxMg !== undefined && item.dailyMg > range.dailyMaxMg) {
        out.push({
          kind: "dose", severity: "block",
          product: item.productId, ingredientId: ing,
          reason: "exceeds_daily_max",
          observedMg: item.dailyMg, limitMg: range.dailyMaxMg,
        });
      }
      if (item.dailyMg !== undefined && range.dailyMinMg !== undefined && item.dailyMg < range.dailyMinMg) {
        out.push({
          kind: "dose", severity: "info",
          product: item.productId, ingredientId: ing,
          reason: "below_daily_min",
          observedMg: item.dailyMg, limitMg: range.dailyMinMg,
        });
      }
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Aggregator
// ────────────────────────────────────────────────────────────────────────

export interface ComprehensiveCheckArgs {
  readonly customerId: string;
  readonly patientAgeYears: number;
  readonly basket: ReadonlyArray<{
    readonly productId: string;
    readonly ingredientIds: readonly string[];
    readonly perDoseMg?: number;
    readonly dailyMg?: number;
  }>;
  readonly ddiTable: readonly DdiPair[];
  readonly customerAllergies: readonly CustomerAllergy[];
  readonly doseRanges: readonly DoseRange[];
}

export function checkAll(args: ComprehensiveCheckArgs): readonly FormularyAlert[] {
  return [
    ...checkDDI({ basket: args.basket, ddiTable: args.ddiTable }),
    ...checkAllergies({ customerId: args.customerId, basket: args.basket, customerAllergies: args.customerAllergies }),
    ...checkDoses({ basket: args.basket, doseRanges: args.doseRanges, patientAgeYears: args.patientAgeYears }),
  ];
}

/** True iff any alert has severity "block" — caller should refuse to save bill. */
export function hasBlocker(alerts: readonly FormularyAlert[]): boolean {
  return alerts.some((a) => a.severity === "block");
}

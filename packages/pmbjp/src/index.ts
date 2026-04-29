// @pharmacare/pmbjp
// Pradhan Mantri Bhartiya Janaushadhi Pariyojana — generic substitution
// suggester + price-controlled ceiling enforcer. ADR-0051.
//
// Live nightly scrape of pmbjp.gov.in catalog is deferred (network +
// scraping infra). This package ships:
//   * The molecule-match algorithm (pure logic).
//   * A 50-row sample seed catalog covering common molecules so the
//     suggestion engine works end-to-end during pilot.
//   * Confidence scoring + savings calculation.

import type { Paise } from "@pharmacare/shared-types";
import { paise } from "@pharmacare/shared-types";

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type DrugForm = "tablet" | "capsule" | "syrup" | "injection" | "ointment" | "drops" | "powder";

export interface JanAushadhiDrug {
  readonly drugCode: string;
  readonly molecule: string;          // canonical INN (lowercase)
  readonly strength: string;          // e.g. "500mg", "100mg/5ml"
  readonly form: DrugForm;
  readonly mrpPaise: Paise;
  readonly available: boolean;
}

export interface BrandedDrugQuery {
  readonly molecule: string;          // INN we extracted from the branded product
  readonly strength: string;
  readonly form: DrugForm;
  readonly brandedMrpPaise: Paise;
}

export interface GenericSuggestion {
  readonly originalQuery: BrandedDrugQuery;
  readonly suggested: JanAushadhiDrug;
  readonly savingsPaise: Paise;
  readonly savingsPct: number;        // 0..100
  readonly confidence: number;        // 0..1
  readonly reason: "exact_match" | "form_strength_match" | "molecule_match_only";
}

// ────────────────────────────────────────────────────────────────────────
// Sample catalog seed (50 most-prescribed Indian molecules)
// ────────────────────────────────────────────────────────────────────────

export const SAMPLE_CATALOG: readonly JanAushadhiDrug[] = [
  // Pain / fever
  { drugCode: "JA-PARA-500-T",  molecule: "paracetamol",  strength: "500mg",  form: "tablet", mrpPaise: paise(700),  available: true },
  { drugCode: "JA-PARA-650-T",  molecule: "paracetamol",  strength: "650mg",  form: "tablet", mrpPaise: paise(900),  available: true },
  { drugCode: "JA-IBU-400-T",   molecule: "ibuprofen",    strength: "400mg",  form: "tablet", mrpPaise: paise(900),  available: true },
  { drugCode: "JA-DICLO-50-T",  molecule: "diclofenac",   strength: "50mg",   form: "tablet", mrpPaise: paise(800),  available: true },
  { drugCode: "JA-ASP-75-T",    molecule: "aspirin",      strength: "75mg",   form: "tablet", mrpPaise: paise(500),  available: true },
  { drugCode: "JA-TRAM-50-T",   molecule: "tramadol",     strength: "50mg",   form: "tablet", mrpPaise: paise(2200), available: true },
  // Antibiotics
  { drugCode: "JA-AMOX-500-C",  molecule: "amoxicillin",  strength: "500mg",  form: "capsule", mrpPaise: paise(1200), available: true },
  { drugCode: "JA-AMOX-250-C",  molecule: "amoxicillin",  strength: "250mg",  form: "capsule", mrpPaise: paise(800),  available: true },
  { drugCode: "JA-AZ-500-T",    molecule: "azithromycin", strength: "500mg",  form: "tablet", mrpPaise: paise(2400), available: true },
  { drugCode: "JA-CIP-500-T",   molecule: "ciprofloxacin",strength: "500mg",  form: "tablet", mrpPaise: paise(1500), available: true },
  { drugCode: "JA-CEF-500-T",   molecule: "cefixime",     strength: "200mg",  form: "tablet", mrpPaise: paise(1800), available: true },
  { drugCode: "JA-METRO-400-T", molecule: "metronidazole",strength: "400mg",  form: "tablet", mrpPaise: paise(600),  available: true },
  // Diabetes
  { drugCode: "JA-METF-500-T",  molecule: "metformin",    strength: "500mg",  form: "tablet", mrpPaise: paise(700),  available: true },
  { drugCode: "JA-METF-1000-T", molecule: "metformin",    strength: "1000mg", form: "tablet", mrpPaise: paise(1100), available: true },
  { drugCode: "JA-GLIM-1-T",    molecule: "glimepiride",  strength: "1mg",    form: "tablet", mrpPaise: paise(1200), available: true },
  { drugCode: "JA-GLIM-2-T",    molecule: "glimepiride",  strength: "2mg",    form: "tablet", mrpPaise: paise(1500), available: true },
  // BP / heart
  { drugCode: "JA-AMLO-5-T",    molecule: "amlodipine",   strength: "5mg",    form: "tablet", mrpPaise: paise(800),  available: true },
  { drugCode: "JA-AMLO-10-T",   molecule: "amlodipine",   strength: "10mg",   form: "tablet", mrpPaise: paise(1100), available: true },
  { drugCode: "JA-ATEN-50-T",   molecule: "atenolol",     strength: "50mg",   form: "tablet", mrpPaise: paise(900),  available: true },
  { drugCode: "JA-LOSAR-50-T",  molecule: "losartan",     strength: "50mg",   form: "tablet", mrpPaise: paise(1200), available: true },
  { drugCode: "JA-TELM-40-T",   molecule: "telmisartan",  strength: "40mg",   form: "tablet", mrpPaise: paise(1400), available: true },
  { drugCode: "JA-ATOR-10-T",   molecule: "atorvastatin", strength: "10mg",   form: "tablet", mrpPaise: paise(1300), available: true },
  { drugCode: "JA-ATOR-20-T",   molecule: "atorvastatin", strength: "20mg",   form: "tablet", mrpPaise: paise(1700), available: true },
  // GI
  { drugCode: "JA-OMEP-20-C",   molecule: "omeprazole",   strength: "20mg",   form: "capsule",mrpPaise: paise(1100), available: true },
  { drugCode: "JA-PANT-40-T",   molecule: "pantoprazole", strength: "40mg",   form: "tablet", mrpPaise: paise(1300), available: true },
  { drugCode: "JA-RANI-150-T",  molecule: "ranitidine",   strength: "150mg",  form: "tablet", mrpPaise: paise(700),  available: true },
  { drugCode: "JA-DOMP-10-T",   molecule: "domperidone",  strength: "10mg",   form: "tablet", mrpPaise: paise(900),  available: true },
  { drugCode: "JA-ONDA-4-T",    molecule: "ondansetron",  strength: "4mg",    form: "tablet", mrpPaise: paise(1100), available: true },
  { drugCode: "JA-LOPER-2-T",   molecule: "loperamide",   strength: "2mg",    form: "tablet", mrpPaise: paise(800),  available: true },
  // Allergy / cold
  { drugCode: "JA-CETI-10-T",   molecule: "cetirizine",   strength: "10mg",   form: "tablet", mrpPaise: paise(600),  available: true },
  { drugCode: "JA-LEVO-5-T",    molecule: "levocetirizine",strength: "5mg",   form: "tablet", mrpPaise: paise(800),  available: true },
  { drugCode: "JA-MONT-10-T",   molecule: "montelukast",  strength: "10mg",   form: "tablet", mrpPaise: paise(1500), available: true },
  // Mental health
  { drugCode: "JA-SERT-50-T",   molecule: "sertraline",   strength: "50mg",   form: "tablet", mrpPaise: paise(1900), available: true },
  { drugCode: "JA-FLU-20-T",    molecule: "fluoxetine",   strength: "20mg",   form: "tablet", mrpPaise: paise(1200), available: true },
  { drugCode: "JA-AMITRY-10-T", molecule: "amitriptyline",strength: "10mg",   form: "tablet", mrpPaise: paise(700),  available: true },
  { drugCode: "JA-ALPRA-0.5-T", molecule: "alprazolam",   strength: "0.5mg",  form: "tablet", mrpPaise: paise(1100), available: true },
  // Thyroid / hormones
  { drugCode: "JA-THYR-50-T",   molecule: "levothyroxine",strength: "50mcg",  form: "tablet", mrpPaise: paise(1100), available: true },
  { drugCode: "JA-THYR-100-T",  molecule: "levothyroxine",strength: "100mcg", form: "tablet", mrpPaise: paise(1500), available: true },
  // Vitamins
  { drugCode: "JA-VITC-500-T",  molecule: "ascorbic_acid",strength: "500mg",  form: "tablet", mrpPaise: paise(800),  available: true },
  { drugCode: "JA-VITD-60K-C",  molecule: "cholecalciferol",strength: "60000IU",form: "capsule",mrpPaise: paise(900),  available: true },
  { drugCode: "JA-VITB12-1500", molecule: "methylcobalamin",strength: "1500mcg",form: "tablet",mrpPaise: paise(1500), available: true },
  // Iron / Anaemia
  { drugCode: "JA-IRON-100-T",  molecule: "ferrous_sulphate",strength:"100mg",form: "tablet", mrpPaise: paise(700),  available: true },
  // Asthma
  { drugCode: "JA-SALBU-100-INH",molecule: "salbutamol",  strength: "100mcg", form: "drops",  mrpPaise: paise(8000), available: true },
  // Inj
  { drugCode: "JA-INSU-100",    molecule: "insulin_human",strength: "100IU/ml",form: "injection",mrpPaise: paise(13500),available: true },
  // Topical
  { drugCode: "JA-DICLO-G",     molecule: "diclofenac",   strength: "1%",     form: "ointment",mrpPaise: paise(2200),available: true },
  // Cough syrups
  { drugCode: "JA-DEXT-100",    molecule: "dextromethorphan",strength:"15mg/5ml",form:"syrup",mrpPaise:paise(3500), available: true },
  // ENT
  { drugCode: "JA-XYLO-0.05",   molecule: "xylometazoline",strength:"0.05%",  form: "drops",  mrpPaise: paise(2500), available: true },
  // Antifungal
  { drugCode: "JA-FLU-150-T",   molecule: "fluconazole",  strength: "150mg",  form: "tablet", mrpPaise: paise(1500), available: true },
  // Eye drops
  { drugCode: "JA-MOXI-EYE",    molecule: "moxifloxacin", strength: "0.5%",   form: "drops",  mrpPaise: paise(3500), available: true },
  // Calcium
  { drugCode: "JA-CAL-500-T",   molecule: "calcium_carbonate",strength:"500mg",form:"tablet", mrpPaise: paise(900),  available: true },
];

// ────────────────────────────────────────────────────────────────────────
// Suggestion engine
// ────────────────────────────────────────────────────────────────────────

/** Normalize molecule name for matching (lowercase, strip whitespace + punctuation). */
export function normalizeMolecule(s: string): string {
  return s.toLowerCase().trim().replace(/[\s_.-]+/g, "_");
}

/** Normalize strength (lowercase, strip whitespace). */
export function normalizeStrength(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

/** Find Jan Aushadhi alternatives for a branded query. Sort by best confidence. */
export function suggestGenerics(
  query: BrandedDrugQuery,
  catalog: readonly JanAushadhiDrug[] = SAMPLE_CATALOG,
): readonly GenericSuggestion[] {
  const qMol = normalizeMolecule(query.molecule);
  const qStr = normalizeStrength(query.strength);

  const candidates = catalog.filter((d) => normalizeMolecule(d.molecule) === qMol && d.available);
  if (candidates.length === 0) return [];

  return candidates
    .map((d): GenericSuggestion => {
      const sameStrength = normalizeStrength(d.strength) === qStr;
      const sameForm = d.form === query.form;
      let confidence = 0.5;
      let reason: GenericSuggestion["reason"] = "molecule_match_only";
      if (sameStrength && sameForm) {
        confidence = 1.0;
        reason = "exact_match";
      } else if (sameStrength) {
        confidence = 0.85;
        reason = "form_strength_match";
      }
      const savings = Math.max(0, (query.brandedMrpPaise as number) - (d.mrpPaise as number));
      const pct = (query.brandedMrpPaise as number) > 0
        ? (savings / (query.brandedMrpPaise as number)) * 100
        : 0;
      return {
        originalQuery: query, suggested: d,
        savingsPaise: paise(savings),
        savingsPct: Math.round(pct),
        confidence, reason,
      };
    })
    .filter((s) => s.savingsPaise > 0)             // only show if savings actually positive
    .sort((a, b) => b.confidence - a.confidence || (b.savingsPaise as number) - (a.savingsPaise as number));
}

/** Best single suggestion (by confidence then savings). null if no improvement. */
export function bestGeneric(
  query: BrandedDrugQuery,
  catalog: readonly JanAushadhiDrug[] = SAMPLE_CATALOG,
): GenericSuggestion | null {
  const all = suggestGenerics(query, catalog);
  return all.length > 0 ? all[0]! : null;
}

/** True iff Jan Aushadhi can offer a genuine alternative — used to show a leaf icon in BillingScreen. */
export function hasGenericAlternative(
  query: BrandedDrugQuery,
  catalog: readonly JanAushadhiDrug[] = SAMPLE_CATALOG,
): boolean {
  return bestGeneric(query, catalog) !== null;
}

/** Aggregate possible savings for a basket. */
export function basketSavings(
  basket: readonly BrandedDrugQuery[],
  catalog: readonly JanAushadhiDrug[] = SAMPLE_CATALOG,
): { totalSavingsPaise: Paise; switchableCount: number; basketSize: number } {
  let total = 0, count = 0;
  for (const item of basket) {
    const best = bestGeneric(item, catalog);
    if (best) { total += best.savingsPaise as number; count++; }
  }
  return { totalSavingsPaise: paise(total), switchableCount: count, basketSize: basket.length };
}

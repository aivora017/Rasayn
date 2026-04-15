// @pharmacare/schedule-h
// Drugs & Cosmetics Rules 1945 — Schedule H / H1 / X classifier.
// v2.0 Playbook Principle #5 (compliance automatic, never manual) +
// module M-COMP (FR-COMP-05..08 Schedule register, separate H1/X books).
//
// Usage:
//   const s = classify("Alprazolam 0.25mg");            // "H1"
//   const s = classify("Paracetamol 500mg");            // "H" (default Rx)
//   const s = classifyIngredients(["Tramadol", "Paracetamol"]); // "H1"
//
// Rules:
//   1. If any ingredient is in Schedule X list → "X" (strictest wins).
//   2. Else if any ingredient is in Schedule H1 list → "H1".
//   3. Else if product is marked Rx → "H".
//   4. Else → "OTC".
//
// Matching is case-insensitive, whitespace-insensitive, and ignores salt
// suffixes (hydrochloride, sulphate, sodium, …) so the same molecule is
// classified consistently regardless of how the label spells it.

import { SCHEDULE_H1, SCHEDULE_X, SALT_SUFFIXES } from "./data.js";

export type DrugSchedule = "X" | "H1" | "H" | "OTC";

const H1_SET = new Set<string>(SCHEDULE_H1);
const X_SET = new Set<string>(SCHEDULE_X);

/** Normalise an ingredient string for set lookup. */
export function normaliseIngredient(raw: string): string {
  let s = raw.toLowerCase().trim();
  // Strip strength (numbers + units) and trailing dosage forms
  s = s.replace(/\d+(\.\d+)?\s*(mg|mcg|g|ml|iu|%)/g, " ");
  s = s.replace(/\b(tablet|tab|capsule|cap|syrup|injection|inj|cream|ointment|drops|suspension)\b/g, " ");
  // Collapse spaces
  s = s.replace(/\s+/g, " ").trim();
  // Strip trailing salt/form words
  for (const suffix of SALT_SUFFIXES) {
    const re = new RegExp(`\\b${suffix}\\b\\s*$`, "i");
    s = s.replace(re, "").trim();
  }
  return s;
}

/** Classify a single ingredient/molecule name. */
export function classify(ingredient: string, options?: { rx?: boolean }): DrugSchedule {
  const n = normaliseIngredient(ingredient);
  if (!n) return options?.rx ? "H" : "OTC";
  if (X_SET.has(n)) return "X";
  if (H1_SET.has(n)) return "H1";
  return options?.rx ? "H" : "OTC";
}

/** Classify a product from its full ingredient list. Strictest wins. */
export function classifyIngredients(ingredients: string[], options?: { rx?: boolean }): DrugSchedule {
  let result: DrugSchedule = options?.rx ? "H" : "OTC";
  for (const ing of ingredients) {
    const s = classify(ing, options);
    if (s === "X") return "X"; // short-circuit, strictest
    if (s === "H1") result = "H1";
  }
  return result;
}

/** True if the schedule mandates a separate register (H1 or X). */
export function requiresRegister(s: DrugSchedule): boolean {
  return s === "H1" || s === "X";
}

/** Rx retention in years per schedule. */
export function rxRetentionYears(s: DrugSchedule): number {
  switch (s) {
    case "X":
      return 2;
    case "H1":
      return 3;
    case "H":
      return 2;
    case "OTC":
      return 0;
  }
}

export { SCHEDULE_H1, SCHEDULE_X } from "./data.js";

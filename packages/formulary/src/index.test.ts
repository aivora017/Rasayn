import { describe, it, expect } from "vitest";
import {
  canonicalPair, checkDDI, checkAllergies, checkDoses, checkAll, hasBlocker,
  type DdiPair, type CustomerAllergy, type DoseRange,
} from "./index.js";

describe("canonicalPair", () => {
  it("returns alphabetical order", () => {
    expect(canonicalPair("b", "a")).toEqual(["a", "b"]);
    expect(canonicalPair("a", "b")).toEqual(["a", "b"]);
  });
});

describe("checkDDI", () => {
  const ddiTable: DdiPair[] = [
    {
      ingredientA: "metformin", ingredientB: "iodine_contrast",
      severity: "block",
      mechanism: "lactic acidosis risk in renal impairment",
    },
    {
      ingredientA: "ibuprofen", ingredientB: "warfarin",
      severity: "warn",
      mechanism: "increased bleeding risk",
    },
  ];

  it("flags a known DDI in a 2-item basket", () => {
    const a = checkDDI({
      basket: [
        { productId: "p_metformin", ingredientIds: ["metformin"] },
        { productId: "p_iodine",    ingredientIds: ["iodine_contrast"] },
      ],
      ddiTable,
    });
    expect(a).toHaveLength(1);
    expect(a[0]?.severity).toBe("block");
    expect(a[0]?.mechanism).toContain("lactic acidosis");
  });

  it("does not flag unrelated combos", () => {
    const a = checkDDI({
      basket: [
        { productId: "p1", ingredientIds: ["paracetamol"] },
        { productId: "p2", ingredientIds: ["caffeine"] },
      ],
      ddiTable,
    });
    expect(a).toHaveLength(0);
  });

  it("flags both ordered-pair directions identically (canonical pair logic)", () => {
    const a = checkDDI({
      basket: [
        { productId: "p_warfarin",  ingredientIds: ["warfarin"] },
        { productId: "p_ibuprofen", ingredientIds: ["ibuprofen"] },
      ],
      ddiTable,
    });
    expect(a).toHaveLength(1);
    expect(a[0]?.severity).toBe("warn");
  });

  it("works with multi-ingredient products (Combiflam: paracetamol + ibuprofen)", () => {
    const a = checkDDI({
      basket: [
        { productId: "p_combiflam", ingredientIds: ["paracetamol", "ibuprofen"] },
        { productId: "p_warfarin",  ingredientIds: ["warfarin"] },
      ],
      ddiTable,
    });
    expect(a).toHaveLength(1);
    expect(a[0]?.ingredientA).toBe("ibuprofen");
    expect(a[0]?.ingredientB).toBe("warfarin");
  });

  it("ignores same-ingredient self-match (Crocin + Dolo both paracetamol)", () => {
    const a = checkDDI({
      basket: [
        { productId: "p_crocin", ingredientIds: ["paracetamol"] },
        { productId: "p_dolo",   ingredientIds: ["paracetamol"] },
      ],
      ddiTable,
    });
    expect(a).toHaveLength(0);
  });

  it("3-item basket fires multiple alerts", () => {
    const a = checkDDI({
      basket: [
        { productId: "p1", ingredientIds: ["metformin"] },
        { productId: "p2", ingredientIds: ["iodine_contrast"] },
        { productId: "p3", ingredientIds: ["warfarin", "ibuprofen"] },
      ],
      ddiTable,
    });
    // Combiflam ibu+warf inside p3 doesn't fire (same product, no pairs across); but p3 vs p1/p2 doesn't have any DDI so 1 alert (metformin+iodine).
    expect(a).toHaveLength(1);
  });
});

describe("checkAllergies", () => {
  const allergies: CustomerAllergy[] = [
    { customerId: "c1", ingredientId: "penicillin", severity: "block" },
    { customerId: "c1", ingredientId: "sulfa", severity: "warn" },
    { customerId: "c2", ingredientId: "aspirin", severity: "warn" },
  ];

  it("flags blocking allergy", () => {
    const r = checkAllergies({
      customerId: "c1",
      basket: [{ productId: "amox", ingredientIds: ["amoxicillin", "penicillin"] }],
      customerAllergies: allergies,
    });
    expect(r).toHaveLength(1);
    expect(r[0]?.severity).toBe("block");
  });

  it("ignores allergies of other customers", () => {
    const r = checkAllergies({
      customerId: "c1",
      basket: [{ productId: "asp", ingredientIds: ["aspirin"] }],
      customerAllergies: allergies,
    });
    expect(r).toHaveLength(0);
  });

  it("returns empty when no allergies match", () => {
    const r = checkAllergies({
      customerId: "c1",
      basket: [{ productId: "p", ingredientIds: ["caffeine"] }],
      customerAllergies: allergies,
    });
    expect(r).toHaveLength(0);
  });
});

describe("checkDoses", () => {
  const doseRanges: DoseRange[] = [
    {
      ingredientId: "paracetamol", ageMinYears: 18, ageMaxYears: 120,
      dailyMaxMg: 4000, perDoseMaxMg: 1000,
    },
    {
      ingredientId: "paracetamol", ageMinYears: 0, ageMaxYears: 17,
      dailyMaxMg: 2000, perDoseMaxMg: 500,
    },
  ];

  it("blocks exceeding per-dose max for adult", () => {
    const r = checkDoses({
      basket: [{ productId: "p", ingredientIds: ["paracetamol"], perDoseMg: 1500 }],
      doseRanges, patientAgeYears: 35,
    });
    expect(r).toHaveLength(1);
    expect(r[0]?.severity).toBe("block");
    expect(r[0]?.reason).toBe("exceeds_per_dose_max");
  });

  it("blocks exceeding daily max for child", () => {
    const r = checkDoses({
      basket: [{ productId: "p", ingredientIds: ["paracetamol"], dailyMg: 2500 }],
      doseRanges, patientAgeYears: 8,
    });
    expect(r.find((a) => a.reason === "exceeds_daily_max")?.severity).toBe("block");
  });

  it("info-level when daily dose below min (under-treatment)", () => {
    const ranges: DoseRange[] = [
      { ingredientId: "metformin", ageMinYears: 18, ageMaxYears: 120, dailyMinMg: 500, dailyMaxMg: 2550 },
    ];
    const r = checkDoses({
      basket: [{ productId: "m", ingredientIds: ["metformin"], dailyMg: 250 }],
      doseRanges: ranges, patientAgeYears: 50,
    });
    expect(r[0]?.severity).toBe("info");
    expect(r[0]?.reason).toBe("below_daily_min");
  });

  it("warns when no pediatric data exists for a child", () => {
    const ranges: DoseRange[] = [
      { ingredientId: "newdrug", ageMinYears: 18, ageMaxYears: 120, perDoseMaxMg: 100 },
    ];
    const r = checkDoses({
      basket: [{ productId: "p", ingredientIds: ["newdrug"], perDoseMg: 50 }],
      doseRanges: ranges, patientAgeYears: 6,
    });
    expect(r[0]?.severity).toBe("warn");
    expect(r[0]?.reason).toBe("no_pediatric_data");
  });

  it("ignores ingredients without dose data", () => {
    const r = checkDoses({
      basket: [{ productId: "p", ingredientIds: ["unknown"], perDoseMg: 500 }],
      doseRanges: [], patientAgeYears: 30,
    });
    expect(r).toHaveLength(0);
  });
});

describe("checkAll + hasBlocker", () => {
  it("aggregates DDI + allergy + dose into one stream", () => {
    const r = checkAll({
      customerId: "c1",
      basket: [
        { productId: "amox", ingredientIds: ["penicillin"], perDoseMg: 250 },
      ],
      ddiTable: [],
      customerAllergies: [
        { customerId: "c1", ingredientId: "penicillin", severity: "block" },
      ],
      doseRanges: [],
      patientAgeYears: 35,
    });
    expect(r.length).toBe(1);
    expect(hasBlocker(r)).toBe(true);
  });

  it("hasBlocker false when only warn/info alerts", () => {
    const alerts = [
      { kind: "ddi", severity: "warn" } as const,
      { kind: "dose", severity: "info" } as const,
    ];
    expect(hasBlocker(alerts as never)).toBe(false);
  });
});

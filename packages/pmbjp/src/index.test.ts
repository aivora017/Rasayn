import { describe, it, expect } from "vitest";
import {
  normalizeMolecule, normalizeStrength, suggestGenerics,
  bestGeneric, hasGenericAlternative, basketSavings,
  SAMPLE_CATALOG,
} from "./index.js";
import { paise } from "@pharmacare/shared-types";

describe("normalizers", () => {
  it("normalizeMolecule lowercases + collapses ws/punctuation", () => {
    expect(normalizeMolecule("Paracetamol")).toBe("paracetamol");
    expect(normalizeMolecule(" Methyl-cobalamin ")).toBe("methyl_cobalamin");
    expect(normalizeMolecule("ferrous sulphate")).toBe("ferrous_sulphate");
  });
  it("normalizeStrength lowercases + strips spaces", () => {
    expect(normalizeStrength("500 mg")).toBe("500mg");
    expect(normalizeStrength(" 100mcg")).toBe("100mcg");
  });
});

describe("suggestGenerics — exact match path", () => {
  it("finds exact match for a common molecule", () => {
    const r = suggestGenerics({
      molecule: "paracetamol", strength: "500mg", form: "tablet",
      brandedMrpPaise: paise(2000),     // branded ₹20
    });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]?.reason).toBe("exact_match");
    expect(r[0]?.confidence).toBe(1);
    expect(r[0]?.suggested.drugCode).toBe("JA-PARA-500-T");
  });
  it("computes savings + percent correctly", () => {
    // JA-PARA-500-T has mrp=700 (₹7); branded ₹20 → savings ₹13 (1300 paise) = 65%
    const r = suggestGenerics({
      molecule: "paracetamol", strength: "500mg", form: "tablet",
      brandedMrpPaise: paise(2000),
    });
    expect(r[0]?.savingsPaise).toBe(paise(1300));
    expect(r[0]?.savingsPct).toBe(65);
  });
});

describe("suggestGenerics — partial match paths", () => {
  it("strength matches but form differs → form_strength_match (lower conf)", () => {
    const r = suggestGenerics({
      molecule: "paracetamol", strength: "500mg", form: "syrup",
      brandedMrpPaise: paise(3500),
    });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]?.confidence).toBeLessThan(1);
    expect(r[0]?.reason).toBe("form_strength_match");
  });

  it("only molecule matches (different strength) → molecule_match_only (lowest conf)", () => {
    const r = suggestGenerics({
      molecule: "paracetamol", strength: "999mg", form: "tablet",
      brandedMrpPaise: paise(3000),
    });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]?.reason).toBe("molecule_match_only");
    expect(r[0]?.confidence).toBe(0.5);
  });
});

describe("suggestGenerics — empty/no-match", () => {
  it("returns empty when molecule unknown", () => {
    const r = suggestGenerics({
      molecule: "unobtainium", strength: "1mg", form: "tablet",
      brandedMrpPaise: paise(1000),
    });
    expect(r).toHaveLength(0);
  });

  it("filters out negative-savings (generic costs MORE)", () => {
    const r = suggestGenerics({
      molecule: "paracetamol", strength: "500mg", form: "tablet",
      brandedMrpPaise: paise(100),       // branded ₹1, generic ₹7
    });
    expect(r).toHaveLength(0);
  });
});

describe("bestGeneric + hasGenericAlternative", () => {
  it("bestGeneric returns the highest-confidence", () => {
    const r = bestGeneric({
      molecule: "metformin", strength: "500mg", form: "tablet",
      brandedMrpPaise: paise(2500),
    });
    expect(r?.suggested.drugCode).toBe("JA-METF-500-T");
    expect(r?.confidence).toBe(1);
  });
  it("hasGenericAlternative true when a switch saves money", () => {
    expect(hasGenericAlternative({
      molecule: "amoxicillin", strength: "500mg", form: "capsule", brandedMrpPaise: paise(2500),
    })).toBe(true);
  });
  it("hasGenericAlternative false when generic is more expensive", () => {
    expect(hasGenericAlternative({
      molecule: "amoxicillin", strength: "500mg", form: "capsule", brandedMrpPaise: paise(500),
    })).toBe(false);
  });
});

describe("basketSavings", () => {
  it("aggregates savings across multiple items", () => {
    const r = basketSavings([
      { molecule: "paracetamol", strength: "500mg", form: "tablet", brandedMrpPaise: paise(2000) },
      { molecule: "metformin",   strength: "500mg", form: "tablet", brandedMrpPaise: paise(2500) },
      { molecule: "unknown",     strength: "1mg",   form: "tablet", brandedMrpPaise: paise(100)  },
    ]);
    expect(r.basketSize).toBe(3);
    expect(r.switchableCount).toBe(2);
    expect(r.totalSavingsPaise).toBeGreaterThan(0);
  });
});

describe("SAMPLE_CATALOG sanity", () => {
  it("has at least 30 rows", () => {
    expect(SAMPLE_CATALOG.length).toBeGreaterThanOrEqual(30);
  });
  it("all rows have drugCode JA- prefix", () => {
    expect(SAMPLE_CATALOG.every((d) => d.drugCode.startsWith("JA-"))).toBe(true);
  });
  it("all molecules are normalized lowercase", () => {
    expect(SAMPLE_CATALOG.every((d) => d.molecule === d.molecule.toLowerCase())).toBe(true);
  });
});

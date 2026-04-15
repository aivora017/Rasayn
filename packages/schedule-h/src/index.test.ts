import { describe, it, expect } from "vitest";
import {
  classify,
  classifyIngredients,
  normaliseIngredient,
  requiresRegister,
  rxRetentionYears,
} from "./index.js";

describe("normaliseIngredient", () => {
  it("lowercases, strips strengths, trims salts", () => {
    expect(normaliseIngredient("Tramadol Hydrochloride 50mg")).toBe("tramadol");
    expect(normaliseIngredient("CEFIXIME 200 mg tablet")).toBe("cefixime");
    expect(normaliseIngredient("  Alprazolam 0.25mg  ")).toBe("alprazolam");
    expect(normaliseIngredient("Paracetamol 500mg Tablet")).toBe("paracetamol");
  });

  it("handles sodium/potassium/sulphate forms", () => {
    expect(normaliseIngredient("Diclofenac Sodium")).toBe("diclofenac");
    expect(normaliseIngredient("Amoxicillin trihydrate")).toBe("amoxicillin");
  });
});

describe("classify (single ingredient)", () => {
  it("detects H1 molecules", () => {
    expect(classify("Alprazolam 0.25mg")).toBe("H1");
    expect(classify("Tramadol HCl")).toBe("H1");
    expect(classify("Ceftriaxone sodium")).toBe("H1");
    expect(classify("Isoniazid 300mg")).toBe("H1");
  });

  it("detects X molecules", () => {
    expect(classify("Methylphenidate 10mg")).toBe("X");
    expect(classify("Pentazocine")).toBe("X"); // X wins over H1
    expect(classify("Phenobarbital")).toBe("OTC"); // not in list → not X
    expect(classify("Amphetamine")).toBe("X");
  });

  it("defaults to H when rx flag set, OTC otherwise", () => {
    expect(classify("Paracetamol", { rx: true })).toBe("H");
    expect(classify("Paracetamol")).toBe("OTC");
  });
});

describe("classifyIngredients (product with multiple molecules)", () => {
  it("X beats H1 beats H beats OTC", () => {
    expect(classifyIngredients(["Tramadol", "Paracetamol"])).toBe("H1");
    expect(classifyIngredients(["Methylphenidate", "Tramadol"])).toBe("X");
    expect(classifyIngredients(["Paracetamol", "Caffeine"], { rx: true })).toBe("H");
    expect(classifyIngredients(["Paracetamol"])).toBe("OTC");
  });
});

describe("register + retention helpers", () => {
  it("H1 and X require separate registers", () => {
    expect(requiresRegister("X")).toBe(true);
    expect(requiresRegister("H1")).toBe(true);
    expect(requiresRegister("H")).toBe(false);
    expect(requiresRegister("OTC")).toBe(false);
  });

  it("rx retention years per schedule", () => {
    expect(rxRetentionYears("X")).toBe(2);
    expect(rxRetentionYears("H1")).toBe(3);
    expect(rxRetentionYears("H")).toBe(2);
    expect(rxRetentionYears("OTC")).toBe(0);
  });
});

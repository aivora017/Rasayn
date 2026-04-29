import { describe, it, expect } from "vitest";
import {
  validateRxLine,
  validateRxScan,
  isAcceptable,
  normalizeDrugName,
  parseDoseInstruction,
  matchToFormulary,
  scanAndEnrich,
  setRxScanTransport,
  type RxLine,
  type RxScanResult,
  type FormularyEntry,
} from "./index.js";

describe("validateRxLine", () => {
  const base: RxLine = { drugName: "Paracetamol", qty: 10, confidence: 0.9 };

  it("ok for high confidence + valid qty", () => {
    expect(validateRxLine(base).severity).toBe("ok");
  });
  it("warn for confidence 0.7", () => {
    expect(validateRxLine({ ...base, confidence: 0.7 }).severity).toBe("warn");
  });
  it("reject for confidence 0.4", () => {
    expect(validateRxLine({ ...base, confidence: 0.4 }).severity).toBe("reject");
  });
  it("reject for empty drug name", () => {
    expect(validateRxLine({ ...base, drugName: "" }).severity).toBe("reject");
  });
  it("reject for qty 0", () => {
    expect(validateRxLine({ ...base, qty: 0 }).severity).toBe("reject");
  });
  it("warn for qty > 200 (sanity)", () => {
    expect(validateRxLine({ ...base, qty: 500 }).severity).toBe("warn");
  });
});

describe("isAcceptable", () => {
  it("true when all lines ok or warn", () => {
    const v = validateRxScan({
      lines: [
        { drugName: "Paracetamol", qty: 10, confidence: 0.9 },
        { drugName: "Crocin", qty: 5, confidence: 0.7 },
      ],
      overallConfidence: 0.8,
      modelUsed: "manual",
    });
    expect(isAcceptable(v)).toBe(true);
  });
  it("false when any line rejected", () => {
    const v = validateRxScan({
      lines: [
        { drugName: "", qty: 10, confidence: 0.9 },
      ],
      overallConfidence: 0.8,
      modelUsed: "manual",
    });
    expect(isAcceptable(v)).toBe(false);
  });
  it("false on empty result", () => {
    expect(isAcceptable([])).toBe(false);
  });
});

describe("normalizeDrugName", () => {
  it("strips Tab. prefix", () => {
    expect(normalizeDrugName("Tab. Paracetamol 500mg")).toBe("paracetamol");
  });
  it("strips Cap. prefix", () => {
    expect(normalizeDrugName("Cap. Amoxicillin 250mg")).toBe("amoxicillin");
  });
  it("strips bracket strength", () => {
    expect(normalizeDrugName("Crocin (500mg)")).toBe("crocin");
  });
  it("collapses spaces", () => {
    expect(normalizeDrugName("Tab.  Crocin   Advance")).toBe("crocin advance");
  });
});

describe("parseDoseInstruction", () => {
  it("parses 1-0-1 grid as twice daily", () => {
    const d = parseDoseInstruction("1-0-1");
    expect(d.perDay).toBe(2);
    expect(d.slots).toEqual(["morning", "night"]);
  });
  it("parses 1-1-1 as thrice daily", () => {
    const d = parseDoseInstruction("1-1-1 after food");
    expect(d.perDay).toBe(3);
    expect(d.mealRelation).toBe("after");
  });
  it("parses BD keyword", () => {
    const d = parseDoseInstruction("Tab BD");
    expect(d.perDay).toBe(2);
    expect(d.slots).toEqual(["morning", "night"]);
  });
  it("parses TDS keyword", () => {
    const d = parseDoseInstruction("TDS pc");
    expect(d.perDay).toBe(3);
    expect(d.mealRelation).toBe("after");
  });
  it("parses HS as bedtime", () => {
    const d = parseDoseInstruction("hs");
    expect(d.slots).toEqual(["night"]);
  });
  it("parses 'twice daily'", () => {
    const d = parseDoseInstruction("twice daily before meals");
    expect(d.perDay).toBe(2);
    expect(d.mealRelation).toBe("before");
  });
  it("falls back to morning OD on unknown text", () => {
    const d = parseDoseInstruction("unintelligible scribble");
    expect(d.perDay).toBe(1);
    expect(d.slots).toEqual(["morning"]);
  });
});

describe("matchToFormulary", () => {
  const formulary: FormularyEntry[] = [
    { id: "p1", genericName: "Paracetamol", aliases: ["Crocin", "Calpol", "Dolo"] },
    { id: "a1", genericName: "Amoxicillin", aliases: ["Mox", "Novamox"] },
    { id: "i1", genericName: "Ibuprofen", aliases: ["Brufen", "Advil"] },
  ];

  it("exact match returns score 1.0", () => {
    const r = matchToFormulary("Paracetamol", formulary);
    expect(r.matched?.id).toBe("p1");
    expect(r.score).toBe(1);
  });
  it("matches alias", () => {
    const r = matchToFormulary("Crocin", formulary);
    expect(r.matched?.id).toBe("p1");
  });
  it("fuzzy-matches typo", () => {
    const r = matchToFormulary("Parecetamol", formulary);
    expect(r.matched?.id).toBe("p1");
    expect(r.score).toBeGreaterThan(0.8);
  });
  it("rejects too-distant strings", () => {
    const r = matchToFormulary("Xyzzy", formulary);
    expect(r.matched).toBeNull();
  });
  it("strips Tab. prefix before matching", () => {
    const r = matchToFormulary("Tab. Paracetamol 500mg", formulary);
    expect(r.matched?.id).toBe("p1");
  });
});

describe("scanAndEnrich", () => {
  const formulary: FormularyEntry[] = [
    { id: "p1", genericName: "Paracetamol", aliases: ["Crocin"] },
  ];

  it("scans + validates + matches in one call", async () => {
    setRxScanTransport({
      scan: async () => ({
        lines: [{ drugName: "Tab Crocin 500mg", qty: 10, confidence: 0.9 }],
        overallConfidence: 0.9,
        modelUsed: "trocr-printed",
      } as RxScanResult),
    });
    const out = await scanAndEnrich(new Uint8Array([1, 2, 3]), formulary);
    expect(out.acceptable).toBe(true);
    expect(out.matches[0]?.matched?.id).toBe("p1");
    expect(out.validations[0]?.severity).toBe("ok");
  });

  it("flags unacceptable when low confidence", async () => {
    setRxScanTransport({
      scan: async () => ({
        lines: [{ drugName: "Tab Crocin", qty: 10, confidence: 0.3 }],
        overallConfidence: 0.3,
        modelUsed: "trocr-printed",
      } as RxScanResult),
    });
    const out = await scanAndEnrich(new Uint8Array([1, 2, 3]), formulary);
    expect(out.acceptable).toBe(false);
  });
});

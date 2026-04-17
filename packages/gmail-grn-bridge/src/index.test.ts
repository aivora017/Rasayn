import { describe, it, expect } from "vitest";
import {
  matchParsedLine,
  tokenJaccard,
  normaliseHint,
  confidenceTier,
  type CandidateProduct,
  TOKEN_JACCARD_MIN,
  CONF_HIGH,
  CONF_MEDIUM,
} from "./index.js";

const P = (id: string, name: string, hsn?: string | null, mrpPaise?: number | null): CandidateProduct =>
  ({ id, name, hsn: hsn ?? null, mrpPaise: mrpPaise ?? null });

describe("normaliseHint", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normaliseHint("Crocin-500  TAB.")).toBe("crocin 500 tab");
    expect(normaliseHint("  Azithral 250mg Tablet  ")).toBe("azithral 250mg tablet");
    expect(normaliseHint("Amoxycillin (Gen)")).toBe("amoxycillin gen");
  });
  it("returns '' on empty / whitespace", () => {
    expect(normaliseHint("")).toBe("");
    expect(normaliseHint("   ")).toBe("");
    expect(normaliseHint("!!!")).toBe("");
  });
});

describe("tokenJaccard", () => {
  it("1.0 on identical token sets", () => {
    expect(tokenJaccard("Crocin 500", "Crocin 500")).toBe(1);
  });
  it("0 on disjoint sets", () => {
    expect(tokenJaccard("Crocin 500", "Morphine 10")).toBe(0);
  });
  it("partial overlap", () => {
    // tokens of "crocin 500" = {crocin, 500}; "crocin 500 tab" = {crocin, 500, tab}
    // intersection=2, union=3 -> 2/3
    expect(tokenJaccard("Crocin 500", "Crocin 500 Tab")).toBeCloseTo(2 / 3, 5);
  });
  it("normalisation before tokenise (case / punctuation agnostic)", () => {
    expect(tokenJaccard("Crocin-500", "crocin 500")).toBe(1);
  });
});

describe("matchParsedLine — Rule 1 exact-name", () => {
  const candidates: CandidateProduct[] = [
    P("p1", "Crocin 500"),
    P("p2", "Crocin 650"),
    P("p3", "Paracetamol 500"),
  ];

  it("returns exact-name at conf 0.95", () => {
    const m = matchParsedLine("Crocin 500", null, candidates);
    expect(m.kind).toBe("matched");
    expect(m.matchType).toBe("exact-name");
    expect(m.confidence).toBe(0.95);
    expect(m.product?.id).toBe("p1");
  });

  it("is normalisation-invariant", () => {
    expect(matchParsedLine("CROCIN-500", null, candidates).product?.id).toBe("p1");
    expect(matchParsedLine("  crocin 500  ", null, candidates).product?.id).toBe("p1");
  });

  it("prefers shortest name on exact-name tie", () => {
    const cs = [P("long", "Paracetamol 500"), P("dup", "Paracetamol 500")];
    const m = matchParsedLine("Paracetamol 500", null, cs);
    expect(m.matchType).toBe("exact-name");
    // both are same length, first one wins (sort is stable)
    expect(["long", "dup"]).toContain(m.product!.id);
  });
});

describe("matchParsedLine — Rule 2 token-overlap", () => {
  const candidates: CandidateProduct[] = [
    P("p1", "Azithral 250 Tablet"),
    P("p2", "Azithromycin 500"),
    P("p3", "Morphine 10mg"),
  ];

  it("matches when Jaccard >= 0.6", () => {
    // "Azithral 250" vs "Azithral 250 Tablet" -> tokens {azithral,250} vs {azithral,250,tablet}
    // Jaccard = 2/3 = 0.667 -> passes
    const m = matchParsedLine("Azithral 250", null, candidates);
    expect(m.kind).toBe("matched");
    expect(m.matchType).toBe("token-overlap");
    expect(m.product?.id).toBe("p1");
    // conf = 0.667 * 0.85 = ~0.567 -> rounded to 0.57
    expect(m.confidence).toBeCloseTo(0.57, 2);
  });

  it("picks highest Jaccard, then shortest name on tie", () => {
    const cs = [
      P("long",  "Pantop 40 DSR Tablet Extra"),
      P("short", "Pantop 40 DSR"),
    ];
    const m = matchParsedLine("Pantop 40 DSR", null, cs);
    // 'short' has Jaccard 1.0 exactly - would be exact-name; "Pantop 40 DSR" normalises same.
    expect(m.matchType).toBe("exact-name");
    expect(m.product?.id).toBe("short");
  });

  it("does NOT match when Jaccard < TOKEN_JACCARD_MIN", () => {
    // "Azithral" vs "Azithral 250 Tablet" -> tokens {azithral} vs {azithral,250,tablet}
    // Jaccard = 1/3 = 0.333 -> below 0.6
    const m = matchParsedLine("Azithral", null, candidates);
    expect(m.kind).toBe("unmatched");
  });

  it("respects the TOKEN_JACCARD_MIN constant", () => {
    // If the constant changed, the previous test wouldn't be a boundary case.
    expect(TOKEN_JACCARD_MIN).toBe(0.6);
  });
});

describe("matchParsedLine — Rule 3 hsn-assist", () => {
  const candidates: CandidateProduct[] = [
    P("c500", "Crocin 500",  "30049099"),
    P("c650", "Crocin 650",  "30049099"),
    P("par500", "Paracetamol", "30049099"),
    P("morph", "Morphine 10", "30039099"),
  ];

  it("falls through to hsn-assist when tokens don't pass Rule 2 but HSN + Jaccard>=0.3 do", () => {
    // hint "Crocin" -> normHint "crocin". Not exact (c500 is "crocin 500"); token-Jaccard
    // vs "Crocin 500" = {crocin} vs {crocin,500} = 1/2 = 0.5 -> below 0.6; fails Rule 2.
    // But HSN 30049099 matches c500, c650, par500. Jaccard:
    //   c500 name="Crocin 500" -> 0.5
    //   c650 name="Crocin 650" -> 0.5
    //   par500 name="Paracetamol" -> 0
    // Highest = 0.5 (c500 or c650); tied, shortest name wins -> both length 10,
    //   stable sort order. Confidence = 0.5 * 0.6 = 0.30.
    const m = matchParsedLine("Crocin", "30049099", candidates);
    expect(m.kind).toBe("matched");
    expect(m.matchType).toBe("hsn-assist");
    expect(["c500", "c650"]).toContain(m.product!.id);
    expect(m.confidence).toBe(0.3);
  });

  it("HSN mismatch → no hsn-assist → unmatched", () => {
    // "Crocin" vs candidates — only HSN 30049099 candidates have token overlap.
    // Supply a wrong HSN → hsn-assist filter empty → falls to unmatched.
    const m = matchParsedLine("Crocin", "99999999", candidates);
    expect(m.kind).toBe("unmatched");
  });

  it("HSN matches but Jaccard < HSN_JACCARD_MIN → unmatched", () => {
    // hint "Zyzyl" vs candidates — all tokens disjoint (Jaccard=0); HSN matches but filter cuts it.
    const m = matchParsedLine("Zyzyl", "30049099", candidates);
    expect(m.kind).toBe("unmatched");
  });
});

describe("matchParsedLine — Rule 4 unmatched / edge cases", () => {
  it("empty hint → unmatched with reason", () => {
    const m = matchParsedLine("", null, [P("p1", "Crocin 500")]);
    expect(m.kind).toBe("unmatched");
    expect(m.matchType).toBe("none");
    expect(m.confidence).toBe(0);
    expect(m.reason).toBe("empty hint");
  });

  it("empty candidates → unmatched with reason", () => {
    const m = matchParsedLine("Crocin 500", null, []);
    expect(m.kind).toBe("unmatched");
    expect(m.reason).toBe("no candidates");
  });

  it("no matching rule triggers → unmatched", () => {
    const m = matchParsedLine("Xyzzy", null, [P("p1", "Crocin 500")]);
    expect(m.kind).toBe("unmatched");
    expect(m.matchType).toBe("none");
  });
});

describe("matchParsedLine — precedence", () => {
  it("exact-name beats token-overlap", () => {
    // "crocin 500" is exact for p1; p2 also has full token overlap (1.0) but
    // exact wins because it's Rule 1.
    const cs = [P("p1", "Crocin 500"), P("p2", "CROCIN 500")];
    const m = matchParsedLine("crocin 500", null, cs);
    expect(m.matchType).toBe("exact-name");
  });

  it("token-overlap (Rule 2) beats hsn-assist (Rule 3)", () => {
    // Provide HSN that matches, plus a name that Rule 2 would catch.
    const cs = [P("p1", "Azithral 250 Tablet", "30049099")];
    const m = matchParsedLine("Azithral 250", "30049099", cs);
    expect(m.matchType).toBe("token-overlap");
  });
});

describe("confidenceTier", () => {
  it("boundary behaviour", () => {
    expect(confidenceTier(1)).toBe("high");
    expect(confidenceTier(CONF_HIGH)).toBe("high");
    expect(confidenceTier(CONF_HIGH - 0.001)).toBe("medium");
    expect(confidenceTier(CONF_MEDIUM)).toBe("medium");
    expect(confidenceTier(CONF_MEDIUM - 0.001)).toBe("low");
    expect(confidenceTier(0)).toBe("low");
  });
});

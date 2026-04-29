import { describe, it, expect } from "vitest";
import {
  classifyIntent, detectPeriod,
  draftCounselingScript, classifyHsnFallback,
  MockLlmGateway, MockSemanticLayer, ask,
  type CopilotQuery,
} from "./index.js";

describe("classifyIntent", () => {
  it("trend keywords", () => {
    expect(classifyIntent("are my sales going up?")).toBe("trend");
    expect(classifyIntent("show me trend over time")).toBe("trend");
  });
  it("compare keywords", () => {
    expect(classifyIntent("this month vs last month")).toBe("compare");
  });
  it("explain (why) keywords", () => {
    expect(classifyIntent("why is paracetamol stock low?")).toBe("explain");
  });
  it("counseling keywords", () => {
    expect(classifyIntent("draft counseling for Crocin")).toBe("counseling");
  });
  it("report keywords", () => {
    expect(classifyIntent("show me sales last week")).toBe("report");
    expect(classifyIntent("how many bills today")).toBe("report");
  });
  it("action keywords", () => {
    expect(classifyIntent("open settings")).toBe("action");
  });
  it("unknown when no pattern matches", () => {
    expect(classifyIntent("hello world")).toBe("unknown");
  });
});

describe("detectPeriod", () => {
  const fixed = new Date("2026-04-28T12:00:00Z");
  it("today", () => {
    const p = detectPeriod("show me today's sales", fixed);
    expect(p?.kind).toBe("today");
  });
  it("yesterday", () => {
    expect(detectPeriod("yesterday", fixed)?.kind).toBe("yesterday");
  });
  it("last week", () => {
    expect(detectPeriod("last week sales", fixed)?.kind).toBe("last_week");
  });
  it("last month", () => {
    expect(detectPeriod("how was last month", fixed)?.kind).toBe("last_month");
  });
  it("this month", () => {
    expect(detectPeriod("this month so far", fixed)?.kind).toBe("this_month");
  });
  it("returns null when no period mention", () => {
    expect(detectPeriod("show me sales", fixed)).toBe(null);
  });
});

describe("classifyHsnFallback", () => {
  it("antibiotics → 30032000", () => {
    expect(classifyHsnFallback("Amoxicillin 500mg capsule").hsn).toBe("30032000");
  });
  it("vaccine → 30021400", () => {
    expect(classifyHsnFallback("Covaxin vaccine 0.5ml").hsn).toBe("30021400");
  });
  it("ayurvedic → 30049011", () => {
    expect(classifyHsnFallback("Chyawanprash ayurvedic tonic").hsn).toBe("30049011");
  });
  it("generic tablet falls back to 30049099", () => {
    expect(classifyHsnFallback("paracetamol tablet").hsn).toBe("30049099");
  });
  it("unknown → low confidence default", () => {
    const r = classifyHsnFallback("unobtainium");
    expect(r.hsn).toBe("30049099");
    expect(r.confidence).toBeLessThan(0.5);
  });
});

describe("draftCounselingScript — multi-locale", () => {
  it("en-IN antibiotic includes 'full course'", () => {
    const s = draftCounselingScript({ drugName: "Amoxicillin", drugClass: "antibiotic", locale: "en-IN" });
    expect(s).toContain("FULL course");
  });
  it("hi-IN antibiotic includes Hindi text", () => {
    const s = draftCounselingScript({ drugName: "Amoxicillin", drugClass: "antibiotic", locale: "hi-IN" });
    expect(s).toContain("कोर्स");
  });
  it("mr-IN antihypertensive includes Marathi text", () => {
    const s = draftCounselingScript({ drugName: "Telmisartan", drugClass: "antihypertensive", locale: "mr-IN" });
    expect(s).toContain("बीपी");
  });
  it("gu-IN antidiabetic includes Gujarati text", () => {
    const s = draftCounselingScript({ drugName: "Metformin", drugClass: "antidiabetic", locale: "gu-IN" });
    expect(s).toContain("શુગર");
  });
  it("ta-IN analgesic includes Tamil text", () => {
    const s = draftCounselingScript({ drugName: "Diclofenac", drugClass: "analgesic", locale: "ta-IN" });
    expect(s).toContain("மணி");
  });
  it("unknown class falls back gracefully", () => {
    const s = draftCounselingScript({ drugName: "Unknown", locale: "en-IN" });
    expect(s).toContain("doctor");
  });
});

describe("ask — orchestration", () => {
  const llm = new MockLlmGateway();
  const semantic = new MockSemanticLayer();

  it("counseling intent → returns counseling script", async () => {
    const q: CopilotQuery = {
      userText: "draft counseling for Crocin",
      shopId: "s1", userRole: "owner", locale: "en-IN",
    };
    const r = await ask(q, { llm, semantic });
    expect(r.narrative).toContain("Counselling for");
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("sales question → returns narrative + chart", async () => {
    const q: CopilotQuery = {
      userText: "show me sales today",
      shopId: "s1", userRole: "owner", locale: "en-IN",
    };
    const r = await ask(q, { llm, semantic });
    expect(r.narrative).toBeTruthy();
    expect(r.chart?.kind).toBe("line");
    expect(r.chart?.data.length).toBeGreaterThan(0);
  });

  it("unknown intent → low confidence + fallback narrative", async () => {
    const q: CopilotQuery = {
      userText: "hello world",
      shopId: "s1", userRole: "owner", locale: "en-IN",
    };
    const r = await ask(q, { llm, semantic });
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.narrative).toContain("not sure");
  });
});

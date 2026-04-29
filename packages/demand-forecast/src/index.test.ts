import { describe, it, expect } from "vitest";
import {
  holtWintersForecast, forecastProduct, trainForShop,
  DEFAULT_PARAMS,
  type DailySalesPoint,
} from "./index.js";
import { paise } from "@pharmacare/shared-types";

const days = (n: number, val: (i: number) => number, startIso = "2026-04-01"): DailySalesPoint[] => {
  const start = new Date(startIso);
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(start.getTime() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    qty: val(i),
  }));
};

describe("holtWintersForecast", () => {
  it("flat series → flat forecast", () => {
    const r = holtWintersForecast(new Array(28).fill(10), 7);
    for (const v of r.forecast) expect(v).toBeCloseTo(10, 0);
  });

  it("upward-trending series → upward forecast", () => {
    const series = Array.from({ length: 28 }, (_, i) => 10 + i);     // 10..37
    const r = holtWintersForecast(series, 7);
    expect(r.forecast[6]!).toBeGreaterThan(r.forecast[0]!);
  });

  it("weekly seasonality (Mon spike) → forecast retains pattern", () => {
    // 4 weeks of: Sun=5, Mon=20, Tue=10, Wed=10, Thu=10, Fri=10, Sat=5
    const pattern = [5, 20, 10, 10, 10, 10, 5];
    const series = Array.from({ length: 28 }, (_, i) => pattern[i % 7]!);
    const r = holtWintersForecast(series, 14);
    // Forecast for next "Mon" should be highest
    const mondays = [r.forecast[1], r.forecast[8]];
    const sundays = [r.forecast[0], r.forecast[7]];
    expect(mondays[0]!).toBeGreaterThan(sundays[0]!);
  });

  it("falls back to simple exp smoothing when < 2*period data", () => {
    const r = holtWintersForecast([5, 6, 7, 8], 3);
    expect(r.forecast.length).toBe(3);
    expect(r.forecast.every((v) => v >= 0)).toBe(true);
  });

  it("never produces negative forecasts", () => {
    const series = Array.from({ length: 28 }, (_, i) => Math.max(0, 5 - i));   // declining to 0
    const r = holtWintersForecast(series, 14);
    expect(r.forecast.every((v) => v >= 0)).toBe(true);
  });

  it("residual stdev is non-negative", () => {
    const r = holtWintersForecast(new Array(28).fill(10), 7);
    expect(r.residualStdev).toBeGreaterThanOrEqual(0);
  });
});

describe("forecastProduct", () => {
  it("emits N forecast points for horizon=N", () => {
    const r = forecastProduct({
      productId: "p1",
      history: days(28, () => 10),
      horizonDays: 14,
      currentStockQty: 50,
    });
    expect(r.forecast.length).toBe(14);
    expect(r.forecast[0]?.date).toBeTruthy();
  });

  it("p90 ≥ expected ≥ p10 for every point", () => {
    const r = forecastProduct({
      productId: "p1",
      history: days(28, (i) => Math.floor(10 + 3 * Math.sin(i * 0.7))),
      horizonDays: 30,
      currentStockQty: 200,
    });
    for (const p of r.forecast) {
      expect(p.p90Qty).toBeGreaterThanOrEqual(p.expectedQty);
      expect(p.p10Qty).toBeLessThanOrEqual(p.expectedQty);
      expect(p.p10Qty).toBeGreaterThanOrEqual(0);
    }
  });

  it("safetyStock + reorderPoint reflect service level + lead time", () => {
    const r = forecastProduct({
      productId: "p1",
      history: days(28, (i) => 10 + (i % 7 === 1 ? 10 : 0)),    // Mon spikes
      horizonDays: 30,
      currentStockQty: 30,
      leadTimeDays: 5,
      serviceLevel: 0.95,
    });
    expect(r.safetyStockQty).toBeGreaterThanOrEqual(0);
    expect(r.reorderPointQty).toBeGreaterThanOrEqual(r.safetyStockQty);
  });

  it("orderQty = max(0, targetStock - currentStock)", () => {
    const overstocked = forecastProduct({
      productId: "p1",
      history: days(28, () => 5),
      horizonDays: 30,
      currentStockQty: 9999,        // way more than needed
    });
    expect(overstocked.orderQty).toBe(0);

    const understocked = forecastProduct({
      productId: "p2",
      history: days(28, () => 20),
      horizonDays: 30,
      currentStockQty: 5,
    });
    expect(understocked.orderQty).toBeGreaterThan(0);
  });

  it("daysOfCoverLeft proportional to stock / avg daily demand", () => {
    const r = forecastProduct({
      productId: "p1",
      history: days(28, () => 10),
      horizonDays: 30,
      currentStockQty: 100,
    });
    // ~10/day → ~10 days cover
    expect(r.daysOfCoverLeft).toBeGreaterThanOrEqual(8);
    expect(r.daysOfCoverLeft).toBeLessThanOrEqual(12);
  });

  it("estCostPaise = orderQty * perUnitCost", () => {
    const r = forecastProduct({
      productId: "p1",
      history: days(28, () => 20),
      horizonDays: 30,
      currentStockQty: 0,
      perUnitCostPaise: paise(500),         // ₹5/unit
    });
    expect(r.estCostPaise).toBe(paise(r.orderQty * 500));
  });
});

describe("trainForShop", () => {
  it("returns one recommendation per product", () => {
    const r = trainForShop({
      products: [
        { productId: "p1", history: days(28, () => 10), currentStockQty: 30 },
        { productId: "p2", history: days(28, () => 5),  currentStockQty: 100 },
      ],
      horizonDays: 14,
    });
    expect(r.trained).toBe(2);
    expect(r.recommendations).toHaveLength(2);
  });
  it("skips products with no history", () => {
    const r = trainForShop({
      products: [
        { productId: "p1", history: [], currentStockQty: 0 },
        { productId: "p2", history: days(28, () => 10), currentStockQty: 50 },
      ],
    });
    expect(r.trained).toBe(1);
  });
  it("durationMs is non-negative", () => {
    const r = trainForShop({ products: [], horizonDays: 14 });
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("DEFAULT_PARAMS", () => {
  it("alpha + beta + gamma in 0..1", () => {
    expect(DEFAULT_PARAMS.alpha).toBeGreaterThan(0);
    expect(DEFAULT_PARAMS.alpha).toBeLessThan(1);
    expect(DEFAULT_PARAMS.gamma).toBeGreaterThan(0);
  });
  it("seasonalPeriod = 7 (weekly)", () => {
    expect(DEFAULT_PARAMS.seasonalPeriod).toBe(7);
  });
});
